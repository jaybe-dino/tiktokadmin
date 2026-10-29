// Google Sheets 쓰기 — 기존 서비스계정(GOOGLE_SA_KEY_JSON)을 그대로 재사용한다.
//
//   왜 새 서비스계정을 만들지 않는가
//     이미 도메인 위임(domain-wide delegation)으로 특정 직원을 impersonate 하는
//     구조가 lib/gmail-client.ts 에 있다. 같은 키로 시트 소유자(jay)를 대신해
//     접근하면, 민감한 원장이 담긴 비공개 시트의 공유 범위를 넓히지 않아도 된다.
//     새 서비스계정을 만들어 시트를 공유하면 "그 계정을 가진 사람 모두"로
//     열람 범위가 넓어진다 — 그건 이번 작업의 승인 범위를 벗어난다.
//
//   그래서 남는 단 한 단계는 Workspace 관리자가 이 서비스계정의 위임 스코프
//   목록에 spreadsheets 를 추가하는 것뿐이다(아래 SCOPE_SHEETS).
//   그 전까지 이 모듈은 전부 fail closed 로 멈춘다 — 조용히 건너뛰지 않는다.
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
  hasSubject: boolean;
  hasSpreadsheetId: boolean;
}

/** 설정 상태 점검 — 값을 돌려주지 않고 "있다/없다"만 말한다. */
export function sheetsAuthState(): SheetsAuthState {
  const hasServiceAccount = Boolean(loadSaKey());
  const hasSubject = Boolean((env.sheets.subject ?? "").trim());
  const hasSpreadsheetId = Boolean((env.sheets.ledgerSpreadsheetId ?? "").trim());
  const missing: string[] = [];
  if (!hasServiceAccount) missing.push("GOOGLE_SA_KEY_JSON");
  if (!hasSubject) missing.push("SHEETS_SYNC_SUBJECT");
  if (!hasSpreadsheetId) missing.push("SHEETS_LEDGER_SPREADSHEET_ID");
  return {
    ready: missing.length === 0,
    reason: missing.length === 0 ? "" : `설정이 없습니다: ${missing.join(", ")}`,
    hasServiceAccount, hasSubject, hasSpreadsheetId,
  };
}

/**
 * 시트 소유자를 impersonate 한 액세스 토큰.
 *   위임 스코프에 spreadsheets 가 없으면 Google 이 401/403 을 준다 —
 *   그 본문을 그대로 남기지 않고(토큰·주소가 섞일 수 있다) 사유만 올린다.
 */
async function accessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const sa = loadSaKey();
  if (!sa) return { ok: false, error: "서비스계정 키가 없습니다(GOOGLE_SA_KEY_JSON)." };
  const sub = (env.sheets.subject ?? "").trim();
  if (!sub) return { ok: false, error: "대행할 사용자 계정이 없습니다(SHEETS_SYNC_SUBJECT)." };

  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: string) => Buffer.from(v).toString("base64url");
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({
    iss: sa.client_email, sub, scope: SCOPE_SHEETS, aud: TOKEN_URI, iat: now, exp: now + 3600,
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
    // 본문에 스코프 미허용 사유가 담기지만 토큰·계정 주소가 섞일 수 있어 그대로 싣지 않는다.
    return {
      ok: false,
      error: res.status === 401 || res.status === 403
        ? `위임 권한이 없습니다(HTTP ${res.status}) — 서비스계정의 도메인 위임 스코프에 spreadsheets 가 필요합니다.`
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
      error: res.status === 403 ? "시트 접근 권한이 없습니다(HTTP 403)."
        : res.status === 404 ? "시트를 찾지 못했습니다(HTTP 404)."
          : `Sheets API 오류(HTTP ${res.status}).`,
    };
  }
  return { ok: true, data: (await res.json().catch(() => ({}))) as T };
}

export interface SheetsClient {
  /** 범위를 읽는다. 값이 없는 칸은 빈 문자열로 채워 길이를 맞춘다. */
  getValues(range: string): Promise<string[][]>;
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
        const r = await call<{ values?: string[][] }>(
          token, `/${id}/values/${encodeURIComponent(range)}`);
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
