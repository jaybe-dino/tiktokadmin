import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "@/lib/db";
import { env } from "@/lib/env";
import { seedDemo } from "@/lib/demo-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 원클릭 부트스트랩: 마이그레이션 전체 적용 → 더미데이터 시드.
//   GET /api/admin/bootstrap?token=<CRON_SECRET>[&seed=0][&force=1]
//   token 미설정(CRON_SECRET 없음)이면 거부.
function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("token") === secret;
}

async function runMigrations() {
  const dir = path.join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await getPool().connect();
  const applied: string[] = [], skipped: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) { skipped.push(file); continue; }
      const sql = readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return { applied, skipped };
}

// 허용 이메일(env)을 exec 관리자로 시드 + 초기 비밀번호(ADMIN_BOOTSTRAP_PASSWORD) 설정.
//   비밀번호 미설정 계정에만 초기 비번을 넣어 최초 로그인 가능하게 함(기존 비번은 보존).
async function ensureAdmins() {
  const emails = env.allowedEmails;
  const initPw = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
  const { query, queryOne } = await import("@/lib/db");
  const { setPassword } = await import("@/lib/auth");
  const seeded: string[] = [], pwset: string[] = [];
  for (const email of emails) {
    await query(
      `INSERT INTO admin_users (id, name, role, active) VALUES ($1,$2,'exec',true)
       ON CONFLICT (id) DO NOTHING`, [email, email.split("@")[0]]).catch(() => {});
    seeded.push(email);
    if (initPw.length >= 6) {
      const u = await queryOne<{ password_hash: string | null }>(
        "SELECT password_hash FROM admin_users WHERE id=$1", [email]).catch(() => null);
      if (u && !u.password_hash) { await setPassword(email, initPw); pwset.push(email); }
    }
  }
  return { seeded, passwordsSet: pwset, note: initPw ? undefined : "ADMIN_BOOTSTRAP_PASSWORD 미설정 — 비번은 /settings 에서 지정" };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized — CRON_SECRET 확인(Vercel 환경변수)" }, { status: 401 });
  }
  try {
    const migrate = await runMigrations();
    const admins = await ensureAdmins();
    let seed: unknown = { skipped: true };
    if (req.nextUrl.searchParams.get("seed") !== "0") {
      seed = await seedDemo(req.nextUrl.searchParams.get("force") === "1");
    }
    return NextResponse.json({ ok: true, migrate, admins, seed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
export const POST = GET;
