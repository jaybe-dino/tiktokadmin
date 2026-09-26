// Zoom 서버 간(Server-to-Server OAuth) API 클라이언트.
//   기존 환경변수(ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET)를 그대로 쓴다.
//   미설정이면 모든 호출이 { ok:false, reason:"미설정" } 로 조용히 실패한다 — 화면은 "연동 안 됨"으로 표시.
//
//   쓰는 곳: 전사 파일 내려받기(웹훅 download_token 만료 시) · 녹화 목록 조회(재처리·과거 가져오기).
//   필요 스코프(계정 관리자 승인 필요): cloud_recording:read:list_account_recordings:admin
//     (구 표기 recording:read:admin) — 승인 전에는 목록/다운로드가 401 로 실패하고 화면에 그대로 표시된다.
import { env } from "./env";

const TOKEN_URL = "https://zoom.us/oauth/token";
const API_BASE = "https://api.zoom.us/v2";

export function zoomApiConfigured(): boolean {
  return Boolean(env.zoom.accountId && env.zoom.clientId && env.zoom.clientSecret);
}

// 액세스 토큰은 1시간짜리 — 메모리에 캐시하고 만료 1분 전에 갱신한다.
let cached: { token: string; expiresAt: number } | null = null;

export async function zoomAccessToken(): Promise<string | null> {
  if (!zoomApiConfigured()) return null;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${env.zoom.clientId}:${env.zoom.clientSecret}`).toString("base64");
  const res = await fetch(`${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(env.zoom.accountId!)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => null);
  if (!res || !res.ok) { cached = null; return null; }
  const j = await res.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!j?.access_token) return null;
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** 테스트·재설정용 — 캐시된 토큰 폐기. */
export function resetZoomToken(): void { cached = null; }

/**
 * 회의 UUID 는 `/` 나 `//` 를 포함할 수 있고, 그때는 URL 인코딩을 두 번 해야 한다(Zoom 규칙).
 * 그대로 넣으면 경로가 깨져 404 가 난다.
 */
export function encodeMeetingUuid(uuid: string): string {
  const once = encodeURIComponent(uuid);
  return uuid.startsWith("/") || uuid.includes("//") ? encodeURIComponent(once) : once;
}

export interface ZoomRecordingFile {
  id?: string; file_type?: string; file_extension?: string; recording_type?: string;
  download_url?: string; play_url?: string; file_size?: number;
  recording_start?: string; recording_end?: string; status?: string;
}
export interface ZoomRecordingSet {
  uuid?: string; id?: number | string; topic?: string; host_email?: string;
  start_time?: string; duration?: number; share_url?: string;
  recording_files?: ZoomRecordingFile[];
}

/** 회의 인스턴스의 녹화·전사 목록. 실패 사유를 그대로 돌려준다(화면 표시용). */
export async function getMeetingRecordings(uuid: string): Promise<{ ok: boolean; data?: ZoomRecordingSet; error?: string }> {
  const token = await zoomAccessToken();
  if (!token) return { ok: false, error: zoomApiConfigured() ? "Zoom 토큰 발급 실패(자격정보·스코프 확인)" : "Zoom API 미설정" };
  const res = await fetch(`${API_BASE}/meetings/${encodeMeetingUuid(uuid)}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return { ok: false, error: "Zoom 연결 실패" };
  if (res.status === 404) return { ok: false, error: "녹화 없음(404) — 삭제됐거나 아직 생성 전" };
  if (!res.ok) return { ok: false, error: `Zoom API ${res.status}${res.status === 401 ? " — 스코프 승인 필요" : ""}` };
  return { ok: true, data: (await res.json().catch(() => null)) as ZoomRecordingSet };
}

/** 호스트의 기간별 녹화 목록(과거 가져오기 미리보기용). */
export async function listUserRecordings(userId: string, from: string, to: string, pageSize = 30):
  Promise<{ ok: boolean; meetings?: ZoomRecordingSet[]; error?: string }> {
  const token = await zoomAccessToken();
  if (!token) return { ok: false, error: zoomApiConfigured() ? "Zoom 토큰 발급 실패(자격정보·스코프 확인)" : "Zoom API 미설정" };
  const qs = new URLSearchParams({ from, to, page_size: String(pageSize) });
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/recordings?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return { ok: false, error: "Zoom 연결 실패" };
  if (!res.ok) return { ok: false, error: `Zoom API ${res.status}${res.status === 401 ? " — 스코프 승인 필요" : ""}` };
  const j = (await res.json().catch(() => null)) as { meetings?: ZoomRecordingSet[] } | null;
  return { ok: true, meetings: j?.meetings ?? [] };
}

/**
 * 녹화·전사 파일 내려받기.
 *   1순위 웹훅이 준 download_token(약 24시간 유효), 2순위 S2S 액세스 토큰.
 *   토큰은 항상 Authorization 헤더로만 보낸다 — URL 쿼리에 넣으면 로그·리퍼러에 남는다.
 */
export async function downloadZoomFile(downloadUrl: string, downloadToken?: string | null):
  Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!/^https:\/\/[^/]*\.zoom\.us\//i.test(downloadUrl)) return { ok: false, error: "허용되지 않은 다운로드 주소" };
  const tokens = [downloadToken, await zoomAccessToken()].filter(Boolean) as string[];
  if (tokens.length === 0) return { ok: false, error: "다운로드 토큰 없음(Zoom API 미설정 · 웹훅 토큰 만료)" };
  let lastErr = "";
  for (const t of tokens) {
    const res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${t}` }, redirect: "follow" }).catch(() => null);
    if (res?.ok) return { ok: true, text: await res.text() };
    lastErr = res ? `다운로드 실패 ${res.status}${res.status === 401 ? " — 토큰 만료·스코프 확인" : ""}` : "다운로드 연결 실패";
  }
  return { ok: false, error: lastErr };
}

/**
 * 실제 호출까지 되는지 확인 — "환경변수 입력됨"과 "API 동작함"을 구분하기 위한 검증.
 *   1) 토큰 발급(자격정보 확인)  2) 녹화 목록 1건 조회(스코프 승인 확인)
 *   버튼을 눌렀을 때만 호출한다(상태 카드 로딩마다 외부 호출하지 않기 위해).
 *   비밀값은 반환하지 않는다 — 단계와 사유만 돌려준다.
 */
export interface ZoomVerifyResult {
  ok: boolean;
  /** 어디까지 됐는지: none(미설정) → token(자격정보 OK) → scope(녹화 조회 OK) */
  stage: "none" | "token" | "scope";
  error?: string;
  /** 스코프 승인이 필요한 상태(계정 관리자 승인 대기)인지 — 설정 완료와 구분해 표시한다. */
  needsApproval?: boolean;
}

export async function verifyZoomApi(host?: string): Promise<ZoomVerifyResult> {
  if (!zoomApiConfigured()) {
    return { ok: false, stage: "none", error: "환경변수 미설정(ZOOM_ACCOUNT_ID·ZOOM_CLIENT_ID·ZOOM_CLIENT_SECRET)" };
  }
  resetZoomToken();   // 캐시된 옛 토큰이 아니라 지금 자격정보로 확인한다.
  const token = await zoomAccessToken();
  if (!token) return { ok: false, stage: "none", error: "토큰 발급 실패 — 자격정보(Account/Client) 확인 필요" };

  // 스코프 확인 — 오늘 하루 범위, 1건만. 저장·수집은 하지 않는다.
  const day = new Date().toISOString().slice(0, 10);
  const r = await listUserRecordings((host ?? "me").trim() || "me", day, day, 1);
  if (!r.ok) {
    const needsApproval = /\b401\b|스코프/.test(r.error ?? "");
    return { ok: false, stage: "token", error: r.error ?? "녹화 목록 조회 실패", needsApproval };
  }
  return { ok: true, stage: "scope" };
}
