import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

// timestamp/timestamptz/date 를 JS Date 가 아닌 "문자열 그대로" 받는다.
// (UI 가 문자열로 다루고 new Date()로 파싱하는 전제 — Date 객체면 .slice 등에서 크래시)
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1114, (v) => v); // timestamp
types.setTypeParser(1184, (v) => v); // timestamptz

// ─────────────────────────────────────────────────────────────
// 공유 Postgres 커넥션.
//   · pool     — 어드민 CRM 테이블 읽기/쓰기 + glovek 테이블 읽기
//   · roPool   — glovek 읽기전용 (GLOVEK_DB_URL_RO 있으면 분리)
// 마이그레이션은 파일(scripts/migrate.mjs)로 관리. ORM 없음(glovek과 동일 raw SQL).
// ─────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __glovekPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __glovekRoPool: Pool | undefined;
}

function needsSsl(connectionString: string): boolean {
  if (/sslmode=disable/i.test(connectionString)) return false;
  if (/sslmode=require/i.test(connectionString)) return true;
  if (process.env.PGSSLMODE === "require") return true;
  // 매니지드 DB(Neon/Vercel Postgres/Supabase 등) — 원격 호스트면 SSL.
  const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString);
  return !isLocal && process.env.NODE_ENV === "production";
}

function makePool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    // 서버리스에서 인스턴스마다 풀 생성 → 커넥션 한도 압박. 작게 유지.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // 매니지드 Postgres 는 SSL 필수. 대부분 유효 인증서지만 provider 별 self-signed 대응.
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("error", (err) => console.error("[pg] idle client error", err.message));
  return pool;
}

export function getPool(): Pool {
  if (!globalThis.__glovekPool) globalThis.__glovekPool = makePool(env.databaseUrl);
  return globalThis.__glovekPool;
}

export function getRoPool(): Pool {
  if (!globalThis.__glovekRoPool) globalThis.__glovekRoPool = makePool(env.glovekReadUrl);
  return globalThis.__glovekRoPool;
}

// ─────────────────────────────────────────────────────────────
// glovek 기존 테이블 쓰기 금지 가드 (01 소유권 규칙).
// 어드민 코드가 실수로 glovek 테이블에 write 하는 것을 코드 레벨에서 차단.
// ─────────────────────────────────────────────────────────────
const GLOVEK_READONLY_TABLES = [
  "users", "orders", "payments", "subscriptions", "mall_subscriptions",
  "onboarding_applications", "onboarding_files", "consult_requests",
  "consult_progress", "inquiries", "referrers", "utm_events",
  "brand_stats", "brand_shop_stats", "products", "videos", "creators",
];

function assertNotGlovekWrite(sql: string) {
  const lower = sql.toLowerCase();
  const isWrite = /^\s*(insert\s+into|update|delete\s+from)\b/.test(lower);
  if (!isWrite) return;
  for (const t of GLOVEK_READONLY_TABLES) {
    // "insert into users" / "update users" / "delete from users" 형태 탐지
    const re = new RegExp(`\\b(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\b`);
    if (re.test(lower)) {
      throw new Error(
        `[db-guard] glovek 읽기전용 테이블 '${t}' 에 쓰기 시도 차단. ` +
          `ingest 이벤트 또는 glovek 기능 요청으로 우회하세요.`,
      );
    }
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertNotGlovekWrite(sql);
  const res = await getPool().query<T>(sql, params as never[]);
  return res.rows;
}

/** 단일 행 (없으면 null) */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** glovek 읽기전용 조회 (roPool 사용) */
export async function queryRo<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getRoPool().query<T>(sql, params as never[]);
  return res.rows;
}

/** 트랜잭션 헬퍼. 콜백이 던지면 롤백. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export { GLOVEK_READONLY_TABLES };
