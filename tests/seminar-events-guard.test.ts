// 세미나 모집 허브 — 배선 감사(DB 없이).
//   "브랜드 원장·자동발송과 분리", "외부 공유 기본 OFF", "초안은 공개되지 않음" 같은
//   약속이 코드에 실제로 박혀 있는지 본다.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** 설명 주석을 걷어낸 실제 코드만 남긴다(주석에 쓴 단어로 감사가 틀리지 않게). */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
/** SQL 주석(--)을 걷어낸다. */
const sql = (p: string) =>
  read(p).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

const MIGRATION = "../migrations/0109_seminar_events.sql";
const LIB = "../lib/seminar-events.ts";
const SHARE = "../lib/seminar-event-share.ts";
const MODEL = "../lib/seminar-events-model.ts";
const ADMIN_ACTIONS = "../app/(dash)/seminar-events/actions.ts";
const APPLY_ACTIONS = "../app/events/[slug]/apply/actions.ts";
const PANEL = "../components/SevAdminPanel.tsx";
const ROSTER_PAGE = "../app/roster/[token]/page.tsx";
const ROSTER_EXPORT = "../app/api/roster/[token]/export/route.ts";
const POSTER_ROUTE = "../app/api/events/poster/[id]/route.ts";
const POSTER_UPLOAD = "../app/api/events/poster-upload/route.ts";
const MIDDLEWARE = "../middleware.ts";

/** 세미나 코드가 건드리면 안 되는 표 이름. admin_users 는 담당자 확인용으로 허용한다. */
const FORBIDDEN_TABLES = [
  "brands", "brand_sources", "brand_contacts", "brand_intro_docs", "stage_history",
  "intake_channels", "intake_sources", "lead_sequence", "lead_sends",
  "weekly_onb_applications", "weekly_onb_events",
  "seminar_config", "seminar_templates", "seminar_targets", "seminar_sends", "seminar_sessions",
  "onb_applications", "onb_files", "onb_customers", "pm_kpis", "pm_tasks",
];
/**
 * 발송·수집 경로로 이어지는 모듈. 세미나 코드에서 import 하면 안 된다.
 *   따옴표까지 포함한 "정확한" 지정자로 본다 — lib/seminar 로 느슨하게 보면
 *   정상 모듈인 lib/seminar-events 까지 걸린다.
 */
const FORBIDDEN_IMPORTS = [
  ...["sms", "mailer", "ingest", "lead-sequence", "bulk-send", "seminar", "seminar-test",
    "weekly-onboarding", "notifications", "slack"]
    .flatMap((m) => [`"@/lib/${m}"`, `"./${m}"`]),
];

describe("마이그레이션 0109 — 추가만", () => {
  const body = sql(MIGRATION);
  // ON DELETE CASCADE 의 DELETE 는 파괴적 구문이 아니다 — 비교 전에 걷어낸다.
  const noCascade = body.replace(/ON DELETE CASCADE/gi, "");

  it("기존 데이터를 지우거나 되돌리는 구문이 없다", () => {
    expect(noCascade).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(noCascade).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(noCascade).not.toMatch(/\bTRUNCATE\b/i);
    expect(noCascade).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(noCascade).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(noCascade).not.toMatch(/\bALTER\s+TABLE\s+(?!sev_)/i);
  });
  it("만드는 표는 모두 sev_ 로 시작한다", () => {
    const created = [...body.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)].map((m) => m[1]);
    expect(created.length).toBeGreaterThanOrEqual(7);
    for (const t of created) expect(t.startsWith("sev_")).toBe(true);
  });
  it("기존 브랜드·리드·발송 표를 건드리지 않는다", () => {
    for (const t of FORBIDDEN_TABLES) {
      expect(new RegExp(`\\b${t}\\b`).test(body)).toBe(false);
    }
  });
  it("INSERT 는 sev_events 초기 초안뿐이다", () => {
    const inserts = [...body.matchAll(/INSERT INTO (\w+)/gi)].map((m) => m[1]);
    expect(inserts).toEqual(["sev_events"]);
  });
  it("초기 행사는 전부 초안·비공개·접수닫힘이다", () => {
    const seed = body.slice(body.indexOf("INSERT INTO sev_events"));
    const rows = [...seed.matchAll(/'draft', (\w+), (\w+), 'seed:0109'/g)];
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r[1]).toBe("false"); // publish
      expect(r[2]).toBe("false"); // apply_open
    }
    expect(seed).not.toMatch(/'open'|'upcoming'/);
  });
  it("같은 slug 를 두 번 적용해도 덮어쓰지 않는다", () => {
    expect(body).toMatch(/ON CONFLICT \(slug\) DO NOTHING/i);
  });
  it("확정되지 않은 일정은 시간 미정으로 들어간다", () => {
    const seed = body.slice(body.indexOf("INSERT INTO sev_events"));
    expect(seed).toContain("시간 · 장소 미확인");
    expect(seed).toContain("시간 · 장소 미정");
    expect(seed).toContain("제안 단계 · 대관 미확정");
  });
  it("초기 행사에 참가 링크를 임의로 넣지 않는다", () => {
    const seed = body.slice(body.indexOf("INSERT INTO sev_events"));
    expect(seed).not.toMatch(/https?:\/\//);
  });
  it("외부 공유는 기본 꺼짐이고 비밀번호 기본값이 없다", () => {
    const shares = body.slice(body.indexOf("CREATE TABLE IF NOT EXISTS sev_shares"));
    expect(shares).toMatch(/enabled boolean NOT NULL DEFAULT false/);
    expect(shares).toMatch(/allow_download boolean NOT NULL DEFAULT false/);
    // password_hash 에 DEFAULT 가 붙어 있으면 임의 비밀번호가 생기는 셈이다.
    expect(shares).toMatch(/password_hash text,/);
    expect(shares).not.toMatch(/password_hash[^\n]*DEFAULT/);
  });
  it("기본 노출 항목은 회사·브랜드·상태뿐이다", () => {
    expect(body).toMatch(/ARRAY\['company','brand','status'\]/);
  });
  it("같은 행사 중복은 막고 다른 행사는 허용하는 키를 쓴다", () => {
    expect(body).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS sev_reg_dedupe_uniq\s+ON sev_registrations \(event_id, dedupe_key\)/);
  });
});

describe("DB 계층 — 분리", () => {
  const lib = code(LIB);
  const share = code(SHARE);

  it("세미나 표와 admin_users 밖의 표를 읽거나 쓰지 않는다", () => {
    for (const t of FORBIDDEN_TABLES) {
      expect(new RegExp(`\\b${t}\\b`).test(lib), `${t} in seminar-events.ts`).toBe(false);
      expect(new RegExp(`\\b${t}\\b`).test(share), `${t} in seminar-event-share.ts`).toBe(false);
    }
  });
  it("SQL 이 건드리는 표는 sev_ 와 admin_users 뿐이다", () => {
    const names = [...(lib + share).matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1].toLowerCase())
      // DO UPDATE SET 의 SET 과 information_schema 조회는 표 이름이 아니다.
      .filter((n) => !["information_schema", "columns", "tables", "set"].includes(n));
    for (const n of new Set(names)) {
      expect(n === "admin_users" || n.startsWith("sev_"), `unexpected table: ${n}`).toBe(true);
    }
  });
  it("문자·메일·자동발송 모듈을 import 하지 않는다", () => {
    for (const m of FORBIDDEN_IMPORTS) {
      expect(lib.includes(m), `${m} in seminar-events.ts`).toBe(false);
      expect(share.includes(m), `${m} in seminar-event-share.ts`).toBe(false);
    }
  });
  it("신청 저장 경로가 행사 상태를 자동으로 바꾸지 않는다", () => {
    const fn = lib.slice(lib.indexOf("export async function submitRegistration"), lib.indexOf("export async function eventTaken"));
    expect(fn).not.toMatch(/UPDATE sev_events/);
    expect(fn).toMatch(/FOR UPDATE/);        // 정원 검사를 위해 행사 행을 잠근다
    expect(fn).toMatch(/applyBlockers/);     // 마감·정원·취소를 서버에서 다시 본다
  });
  it("공개 목록·공개 상세 각각이 게시된 행사만 돌려준다", () => {
    // 두 함수를 따로 본다 — 한쪽에서 조건이 빠져도 다른 쪽 조건에 가려지지 않게.
    const list = lib.slice(lib.indexOf("export async function listPublicEvents"),
      lib.indexOf("export async function getPublicEvent"));
    const one = lib.slice(lib.indexOf("export async function getPublicEvent"),
      lib.indexOf("export async function listAllEvents"));
    for (const [name, seg] of [["listPublicEvents", list], ["getPublicEvent", one]] as const) {
      expect(seg.length, name).toBeGreaterThan(50);
      expect(seg, name).toMatch(/publish = true/);
      expect(seg, name).toMatch(/status <> 'draft'/);
    }
  });
  it("공개 포스터 조회도 게시된 행사로 제한한다", () => {
    const fn = lib.slice(lib.indexOf("getPublicPoster"), lib.indexOf("getAdminPoster"));
    expect(fn).toMatch(/e\.publish = true/);
    expect(fn).toMatch(/status <> 'draft'/);
  });
  it("검수용 데이터는 is_test 로만 들어간다", () => {
    const fn = lib.slice(lib.indexOf("addTestRegistration"), lib.indexOf("검수용 합성 데이터(TEST)만"));
    expect(fn).toMatch(/\[TEST\]/);
    expect(fn).toMatch(/example\.invalid/); // 실제 도달 가능한 주소를 쓰지 않는다
  });
  it("TEST 삭제 경로는 is_test = true 만 지운다", () => {
    const fn = lib.slice(lib.indexOf("export async function deleteSevTestRegs"));
    const deletes = [...fn.matchAll(/DELETE FROM sev_registrations WHERE ([^\n]*)/g)].map((m) => m[1]);
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) expect(d).toMatch(/is_test = true/);
  });
});

describe("외부 공유 — 비밀·격리", () => {
  const share = code(SHARE);

  it("관리자 목록에 비밀번호 해시를 내보내지 않는다", () => {
    const cols = share.slice(share.indexOf("const SHARE_COLS"), share.indexOf("export async function listShares"));
    expect(cols).toMatch(/password_hash IS NOT NULL\) AS has_password/);
    expect(cols).not.toMatch(/s\.password_hash\s*,/);
    expect(cols).not.toMatch(/s\.password_hash AS/);
  });
  it("비밀번호는 해시로만 저장한다(평문 컬럼 없음)", () => {
    expect(share).toMatch(/hashPassword\(pw\)/);
    expect(share).toMatch(/verifyPassword\(/);
    expect(share).not.toMatch(/password\s*=\s*\$/);
  });
  it("열람 세션은 링크 토큰과 짝이 맞아야 통과한다(IDOR 차단)", () => {
    const fn = share.slice(share.indexOf("export async function shareViewForSession"));
    expect(fn).toMatch(/ss\.token = \$1 AND s\.token = \$2/);
    expect(fn).toMatch(/ss\.revoked_at IS NULL/);
    expect(fn).toMatch(/ss\.expires_at > now\(\)/);
    expect(fn).toMatch(/shareLive\(/); // 세션이 살아도 링크가 꺼지면 막는다
  });
  it("외부 조회는 세션이 가리키는 행사만 읽는다(행사 id 를 인자로 받지 않는다)", () => {
    const fn = share.slice(share.indexOf("export async function readRoster"));
    expect(fn).toMatch(/WHERE event_id = \$1::uuid/);
    expect(fn).toMatch(/view\.eventId/);
    expect(fn).not.toMatch(/admin_note/);
    expect(fn).not.toMatch(/owner_admin_id/);
    expect(fn).toMatch(/is_test = false/);
    expect(fn).toMatch(/status <> 'cancelled'/);
  });
  it("외부 조회는 연락처를 마스킹해서만 내보낸다", () => {
    const fn = share.slice(share.indexOf("export async function readRoster"));
    expect(fn).toMatch(/maskPhone\(r\.phone\)/);
    expect(fn).toMatch(/maskEmail\(r\.email\)/);
    // 원문을 그대로 돌려주는 분기가 없어야 한다.
    expect(fn).not.toMatch(/return r\.phone/);
    expect(fn).not.toMatch(/return r\.email/);
  });
  it("비밀번호 시도는 기록하되 입력값·IP 는 남기지 않는다", () => {
    expect(share).toMatch(/INSERT INTO sev_share_attempts \(share_id, ok\)/);
    expect(share).not.toMatch(/ip|user_agent/i);
  });
  it("시도 횟수 제한이 걸려 있다", () => {
    const fn = share.slice(share.indexOf("export async function loginShare"), share.indexOf("export interface ShareView"));
    expect(fn).toMatch(/SHARE_ATTEMPT_MAX/);
    expect(fn).toMatch(/ok = false AND at > now\(\)/);
  });
  it("없는 링크·꺼진 링크·틀린 비밀번호를 같은 문구로 돌려준다", () => {
    const fn = share.slice(share.indexOf("export async function loginShare"), share.indexOf("export interface ShareView"));
    const denies = [...fn.matchAll(/return \{ ok: false, error: DENY \}/g)];
    expect(denies.length).toBeGreaterThanOrEqual(3);
  });
  it("비밀번호 변경·회전·철회는 기존 열람 세션을 끊는다", () => {
    for (const name of ["setSharePassword", "rotateShareToken", "revokeShare"]) {
      const i = share.indexOf(`export async function ${name}`);
      const seg = share.slice(i, i + 1200);
      expect(/revokeShareSessions|sev_share_sessions SET revoked_at/.test(seg), name).toBe(true);
    }
  });
  it("공유를 켤 때 비밀번호·노출항목을 다시 확인한다", () => {
    const fn = share.slice(share.indexOf("export async function setShareEnabled"), share.indexOf("export async function rotateShareToken"));
    expect(fn).toMatch(/shareEnableBlockers/);
  });
});

describe("공개 경로 — 발송·검수값 유입 차단", () => {
  it("공개 신청 액션은 is_test 를 받지 않는다", () => {
    const a = code(APPLY_ACTIONS);
    expect(a).not.toMatch(/isTest|is_test/);
  });
  it("공개 신청 액션은 발송 모듈을 쓰지 않는다", () => {
    const a = code(APPLY_ACTIONS);
    for (const m of FORBIDDEN_IMPORTS) expect(a.includes(m)).toBe(false);
  });
  it("공개·외부 화면이 DB 를 직접 열지 않는다", () => {
    for (const f of walk("../app/events").concat(walk("../app/roster"))) {
      const c = code(f);
      expect(c.includes('from "@/lib/db"'), f).toBe(false);
      expect(c.includes('from "pg"'), f).toBe(false);
    }
  });
  it("클라이언트 컴포넌트는 순수 모델 모듈만 가져온다", () => {
    const clients = walk("../app/events").concat(walk("../app/roster"), [PANEL])
      .filter((f) => /^"use client"|^'use client'/.test(read(f).trim()));
    expect(clients.length).toBeGreaterThanOrEqual(3);
    for (const f of clients) {
      const c = code(f);
      expect(c.includes("@/lib/seminar-events\""), f).toBe(false);
      expect(c.includes("@/lib/seminar-event-share"), f).toBe(false);
    }
  });
});

describe("포스터 서빙·업로드", () => {
  it("업로드는 관리자만, 이미지 내용까지 확인한다", () => {
    const c = code(POSTER_UPLOAD);
    expect(c).toMatch(/currentUser\(\)/);
    expect(c).toMatch(/ADMIN_ROLES\.has\(u\.role\)/);
    expect(c).toMatch(/posterError\(/);
    expect(c).toMatch(/sniffImageMime\(/);
  });
  it("서빙도 내용을 다시 확인하고 이미지가 아니면 거절한다", () => {
    const c = code(POSTER_ROUTE);
    expect(c).toMatch(/sniffImageMime\(/);
    expect(c).toMatch(/415/);
    expect(c).toMatch(/nosniff/);
  });
  it("초안 포스터는 관리자 세션이 있어야 보인다", () => {
    const c = code(POSTER_ROUTE);
    expect(c).toMatch(/getPublicPoster/);
    expect(c).toMatch(/currentUser\(\)/);
    expect(c).toMatch(/getAdminPoster/);
  });
});

describe("외부 열람 화면 — 수집·캐시 차단", () => {
  it("페이지는 noindex 이고 관리자 화면으로 가는 링크가 없다", () => {
    const c = read(ROSTER_PAGE);
    expect(c).toMatch(/robots:\s*\{[^}]*index:\s*false/);
    // 관리자 경로·브랜드 원장으로 가는 링크 문자열이 없어야 한다
    //   (lib/seminar-events-model import 는 경로 링크가 아니다).
    expect(code(ROSTER_PAGE)).not.toMatch(/["'`]\/(seminar-events|brand|brand360|weekly-onboarding)/);
  });
  it("외부 CSV 는 허용 설정이 켜져 있을 때만 내려간다", () => {
    const c = code(ROSTER_EXPORT);
    expect(c).toMatch(/if \(!view\) return .*401/);
    expect(c).toMatch(/if \(!view\.allowDownload\)/);
    expect(c).toMatch(/no-store/);
  });
  it("미들웨어가 /roster 응답에 캐시·수집 차단 헤더를 붙인다", () => {
    const c = code(MIDDLEWARE);
    const seg = c.slice(c.indexOf('pathname.startsWith("/roster/")'));
    expect(seg).toMatch(/no-store/);
    expect(seg).toMatch(/noindex/);
    expect(seg).toMatch(/no-referrer/);
  });
  it("공개 허브만 열고 관리 화면(/seminar-events)은 로그인 뒤에 둔다", () => {
    const c = code(MIDDLEWARE);
    expect(c).toMatch(/pathname === "\/events" \|\| pathname\.startsWith\("\/events\/"\)/);
    // startsWith("/events") 만 쓰면 /events-admin 같은 경로까지 열린다.
    expect(c).not.toMatch(/startsWith\("\/events"\)/);
    // 관리 화면 경로를 공개 허용 목록에 넣지 않았는지(문자열로) 본다.
    expect(c).not.toMatch(/["'`]\/seminar-events/);
  });
});

describe("관리자 액션 권한", () => {
  const a = code(ADMIN_ACTIONS);
  it("외부 공유 설정은 대표만 할 수 있다", () => {
    expect(a).toMatch(/const SHARE_ROLES = new Set\(\["exec"\]\)/);
    for (const fn of ["sevCreateShareAction", "sevSetSharePasswordAction", "sevSetShareFieldsAction",
      "sevSetShareEnabledAction", "sevSetShareExpiryAction", "sevRotateShareAction",
      "sevRevokeShareAction", "sevRevokeShareSessionsAction"]) {
      const i = a.indexOf(`export async function ${fn}`);
      expect(i, fn).toBeGreaterThan(0);
      expect(a.slice(i, i + 400), fn).toMatch(/await sharer\(\)/);
    }
  });
  it("행사 수정·검수 데이터는 대표·파트장만", () => {
    expect(a).toMatch(/const EDIT_ROLES = new Set\(\["exec", "lead"\]\)/);
    for (const fn of ["sevSaveEventAction", "sevSetFlagsAction", "sevClearPosterAction",
      "sevAddTestRegAction", "sevClearTestAction"]) {
      const i = a.indexOf(`export async function ${fn}`);
      expect(a.slice(i, i + 300), fn).toMatch(/await editor\(\)/);
    }
  });
  it("모든 액션이 세션을 먼저 확인한다", () => {
    const fns = [...a.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(fns.length).toBeGreaterThanOrEqual(15);
    for (const fn of fns) {
      const i = a.indexOf(`export async function ${fn}`);
      expect(a.slice(i, i + 400), fn).toMatch(/await (me|editor|sharer)\(\)/);
    }
  });
  it("관리자 액션도 브랜드 원장·발송을 건드리지 않는다", () => {
    for (const t of FORBIDDEN_TABLES) expect(new RegExp(`\\b${t}\\b`).test(a), t).toBe(false);
    for (const m of FORBIDDEN_IMPORTS) expect(a.includes(m), m).toBe(false);
  });
});

describe("새 권한·비밀키를 임의로 만들지 않는다", () => {
  it("세미나 코드가 새 환경변수를 요구하지 않는다", () => {
    const files = [LIB, SHARE, MODEL, ADMIN_ACTIONS, APPLY_ACTIONS, POSTER_ROUTE, POSTER_UPLOAD, ROSTER_EXPORT];
    for (const f of files) {
      const envs = [...code(f).matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]);
      for (const e of envs) expect(e, `${f}: ${e}`).toBe("NODE_ENV");
    }
  });
});

/** 디렉터리 안의 .ts/.tsx 를 모두 모은다. */
function walk(rel: string): string[] {
  const base = new URL(rel + "/", import.meta.url);
  const out: string[] = [];
  const rec = (dir: URL, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = new URL(name, dir);
      if (statSync(full).isDirectory()) rec(new URL(name + "/", dir), `${prefix}${name}/`);
      else if (/\.tsx?$/.test(name)) out.push(`${rel}/${prefix}${name}`);
    }
  };
  rec(base, "");
  return out;
}
