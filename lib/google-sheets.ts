// Google Sheets 쓰기 — 기존 서비스계정(GOOGLE_SA_KEY_JSON)을 그대로 재사용한다.
//
//   어떤 권한을 쓰는가 (최소권한)
//     기본은 서비스계정 "자기 자신"으로 토큰을 받는다(iss=서비스계정, sub 없음).
//     그리고 이 스프레드시트 한 개에만 그 서비스계정을 편집자로 공유한다.
//     그러면 권한 범위가 이 파일 하나로 끝난다.
//
//     도메인 전체 위임(domain-wide delegation)에 spreadsheets 스코프를 새로
//     추가하는 길은 쓰지 않는다. 그건 "조직의 모든 사용자의 모든 스프레드시트를
//     대신 열 수 있는 권한"이어서, 시트 한 개 공유보다 훨씬 넓다.
//     이미 위임 목록에 spreadsheets 가 있다고 확인된 경우에만,
//     SHEETS_SYNC_SUBJECT 를 설정해 대행(impersonation) 경로를 쓸 수 있다.
//     설정하지 않으면 그 경로는 아예 시도하지 않는다.
//
//     서비스계정 이메일은 비밀값이 아니다(공유 대상으로 알려줘야 한다).
//     비밀키는 어디에도 싣지 않는다.
//
//   권한이 없으면 전부 fail closed 로 멈춘다 — 조용히 건너뛰지 않는다.
import crypto from "node:crypto";
import { env } from "./env";

/** 시트 읽기·쓰기. 드라이브 전체 권한은 요구하지 않는다(필요 최소). */
export const SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

interface SaKey { client_email: string; private_key: string }

function loadSaKey(): SaKey | null {
  const raw = env.sheets.saKeyJson;
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as SaKey;
    return k.client_email && k.private_key ? k : null;
  } catch {
    return null;
  }
}

export interface SheetsAuthState {
  ready: boolean;
  /** 사람이 읽는 사유. 비밀값·주소 원문을 담지 않는다. */
  reason: string;
  /** 설정 여부만(값은 절대 담지 않는다). */
  hasServiceAccount: boolean;
  hasSpreadsheetId: boolean;
  /** 'self' = 서비스계정 자기 자신(기본). 'impersonated' = 도메인 위임 대행. */
  mode: "self" | "impersonated";
  /**
   * 서비스계정 이메일 — 이 시트에 편집자로 공유할 대상.
   *   비밀값이 아니므로 사용자에게 보여 준다. 키가 없으면 빈 문자열.
   */
  clientEmail: string;
}

/** 설정 상태 점검 — 비밀값은 돌려주지 않고 "있다/없다"만 말한다. */
export function sheetsAuthState(): SheetsAuthState {
  const sa = loadSaKey();
  const subject = (env.sheets.subject ?? "").trim();
  const hasSpreadsheetId = Boolean((env.sheets.ledgerSpreadsheetId ?? "").trim());
  const missing: string[] = [];
  if (!sa) missing.push("GOOGLE_SA_KEY_JSON");
  if (!hasSpreadsheetId) missing.push("SHEETS_LEDGER_SPREADSHEET_ID");
  return {
    ready: missing.length === 0,
    reason: missing.length === 0 ? "" : `설정이 없습니다: ${missing.join(", ")}`,
    hasServiceAccount: Boolean(sa),
    hasSpreadsheetId,
    mode: subject ? "impersonated" : "self",
    clientEmail: sa?.client_email ?? "",
  };
}

/**
 * 액세스 토큰.
 *   기본은 서비스계정 자기 자신(sub 없음) — 이 시트에 편집자로 공유되어 있으면 된다.
 *   SHEETS_SYNC_SUBJECT 가 있을 때만 그 사용자를 대행한다(기존 도메인 위임 재사용).
 *   실패 사유에 응답 본문을 싣지 않는다(토큰·주소가 섞일 수 있다).
 */
async function accessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const sa = loadSaKey();
  if (!sa) return { ok: false, error: "서비스계정 키가 없습니다(GOOGLE_SA_KEY_JSON)." };
  const sub = (env.sheets.subject ?? "").trim();

  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: string) => Buffer.from(v).toString("base64url");
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({
    iss: sa.client_email,
    // sub 는 도메인 위임을 쓸 때만 넣는다. 없으면 서비스계정 자신으로 동작한다.
    ...(sub ? { sub } : {}),
    scope: SCOPE_SHEETS, aud: TOKEN_URI, iat: now, exp: now + 3600,
  }));
  const input = `${header}.${claim}`;
  let jwt: string;
  try {
    const sig = crypto.createSign("RSA-SHA256").update(input).sign(sa.private_key);
    jwt = `${input}.${Buffer.from(sig).toString("base64url")}`;
  } catch {
    return { ok: false, error: "서비스계정 키로 서명하지 못했습니다(키 형식 확인)." };
  }

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Google 토큰 서버에 연결하지 못했습니다." };
  if (!res.ok) {
    const denied = res.status === 401 || res.status === 403;
    return {
      ok: false,
      error: denied
        ? (sub
          ? `위임 권한이 없습니다(HTTP ${res.status}) — SHEETS_SYNC_SUBJECT 대행에는 위임 스코프에 spreadsheets 가 필요합니다. 설정을 비우면 서비스계정 자기 자신으로 동작합니다.`
          : `토큰 발급이 거부되었습니다(HTTP ${res.status}) — 서비스계정 키·시간 설정을 확인하세요.`)
        : `토큰 발급 실패(HTTP ${res.status}).`,
    };
  }
  const data = await res.json().catch(() => null) as { access_token?: string } | null;
  return data?.access_token
    ? { ok: true, token: data.access_token }
    : { ok: false, error: "토큰 응답에 access_token 이 없습니다." };
}

async function call<T>(
  token: string, path: string, init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  }).catch(() => null);
  if (!res) return { ok: false, error: "Sheets API 에 연결하지 못했습니다.", status: 0 };
  if (!res.ok) {
    // 응답 본문에 시트 내용이 섞일 수 있어 상태 코드만 남긴다.
    return {
      ok: false, status: res.status,
      error: res.status === 403
        ? "시트 접근 권한이 없습니다(HTTP 403) — 이 스프레드시트에 서비스계정을 편집자로 공유해야 합니다."
        : res.status === 404 ? "시트를 찾지 못했습니다(HTTP 404)."
          : `Sheets API 오류(HTTP ${res.status}).`,
    };
  }
  return { ok: true, data: (await res.json().catch(() => ({}))) as T };
}

export interface SheetsClient {
  /**
   * 범위를 읽는다. 서식이 적용된 글자가 아니라 저장된 값 그대로 받는다
   * (UNFORMATTED_VALUE) — 날짜 시리얼을 숫자로 비교해야 하기 때문이다.
   */
  getValues(range: string): Promise<unknown[][]>;
  /** 여러 범위를 한 번에 쓴다. 전부 RAW — 수식으로 해석되지 않는다. */
  batchUpdate(updates: { range: string; values: unknown[][] }[]): Promise<number>;
  /** 행을 덧붙인다(기존 행을 건드리지 않는다). */
  append(range: string, values: unknown[][]): Promise<number>;
}

export type SheetsConnect =
  | { ok: true; client: SheetsClient }
  | { ok: false; error: string };

/** 토큰을 받아 클라이언트를 만든다. 실패하면 사유만 돌려주고 아무것도 쓰지 않는다. */
export async function connectSheets(spreadsheetId: string): Promise<SheetsConnect> {
  const auth = await accessToken();
  if (!auth.ok) return { ok: false, error: auth.error };
  const token = auth.token;
  const id = encodeURIComponent(spreadsheetId);

  return {
    ok: true,
    client: {
      async getValues(range) {
        const r = await call<{ values?: unknown[][] }>(
          token,
          `/${id}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
        if (!r.ok) throw new Error(r.error);
        return r.data.values ?? [];
      },
      async batchUpdate(updates) {
        if (updates.length === 0) return 0;
        const r = await call<{ totalUpdatedCells?: number }>(
          token, `/${id}/values:batchUpdate`, {
            method: "POST",
            body: JSON.stringify({
              // RAW — 보내는 값을 그대로 저장한다. "=..." 로 시작해도 수식이 되지 않는다.
              valueInputOption: "RAW",
              data: updates.map((u) => ({ range: u.range, values: u.values })),
            }),
          });
        if (!r.ok) throw new Error(r.error);
        return r.data.totalUpdatedCells ?? 0;
      },
      async append(range, values) {
        if (values.length === 0) return 0;
        const q = "valueInputOption=RAW&insertDataOption=INSERT_ROWS";
        const r = await call<{ updates?: { updatedRows?: number } }>(
          token, `/${id}/values/${encodeURIComponent(range)}:append?${q}`, {
            method: "POST",
            body: JSON.stringify({ values }),
          });
        if (!r.ok) throw new Error(r.error);
        return r.data.updates?.updatedRows ?? 0;
      },
    },
  };
}
