// Aligo SMS 발송 (smartsms.aligo.in) — 09-C 발송 센터의 문자 채널.
//   ⚠️ 시크릿(키)은 env 만. 코드/로그/커밋 금지. 발신번호는 Aligo 사전등록 필수.
import { env } from "./env";

const SEND_URL = "https://apis.aligo.in/send/";       // 단건/동일메시지 대량
const MASS_URL = "https://apis.aligo.in/send_mass/";  // 개인화 대량(수신자별 다른 메시지)
const REMAIN_URL = "https://apis.aligo.in/remain/";   // 잔여건수

/**
 * ALIGO 는 국내번호(010…)만 수신한다. 메타 리드광고 등은 국제표기(+82·82·0082,
 * 앞자리 0 제거)로 전달하므로 국내 0 접두 형식으로 교정한다.
 *   "821046871461" → "01046871461",  "+82 10-4687-1461" → "01046871461"
 * 이미 국내형식(0…)이면 숫자만 남겨 그대로 반환.
 */
export function toKoreanLocalPhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0082")) d = d.slice(4);
  else if (d.startsWith("82") && !d.startsWith("820")) d = d.slice(2);
  else return d; // 이미 국내(0…) 또는 국가코드 없음
  return d.startsWith("0") ? d : "0" + d;
}

/** 콤마 구분 수신자 목록 각각을 국내형식으로 교정. */
function normalizeReceivers(csv: string): string {
  return csv.split(",").map((s) => toKoreanLocalPhone(s)).filter(Boolean).join(",");
}

/** EUC-KR 기준 바이트 수(한글 2, ASCII 1) — SMS/LMS 판정용. */
export function byteLen(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.codePointAt(0)! > 0x7f ? 2 : 1;
  return n;
}

/** 90바이트 이하 SMS(단문), 초과 LMS(장문). 이미지가 있으면 MMS. */
export function smsType(msg: string, hasImage = false): "SMS" | "LMS" | "MMS" {
  if (hasImage) return "MMS";
  return byteLen(msg) <= 90 ? "SMS" : "LMS";
}

export interface SmsResult {
  ok: boolean;
  /**
   * 제공자 응답을 확인하지 못함(연결 실패·시간초과).
   *   ALIGO 가 code 를 돌려준 "명시적 거절"과 구분한다 — 접수됐을 수도 있다.
   */
  indeterminate?: boolean;
  msgId?: string;
  type?: string;
  successCnt?: number;
  errorCnt?: number;
  code?: number;
  message: string;
}

export function aligoConfigured(): boolean {
  return Boolean(env.aligo.apiKey && env.aligo.userId && env.aligo.sender);
}

/**
 * 네트워크 실패의 진짜 원인 — Node 의 fetch 는 무슨 일이 있어도 "fetch failed" 만 던지고,
 * 실제 사유는 error.cause 에 들어 있다. 그걸 꺼내지 않으면 원인을 알 수 없다.
 * 비밀값은 담기지 않는다(주소·코드·사유만).
 */
export function netReason(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const code = err?.cause?.code ?? "";
  // 빈 문자열도 "없음"으로 본다 — ?? 만 쓰면 빈 cause 메시지에서 사유가 통째로 사라진다.
  const raw = (err?.cause?.message || err?.message || String(e) || "원인 미상").trim();
  const hint =
    code === "ENOTFOUND" ? "주소를 찾지 못함(DNS)"
    : code === "EAI_AGAIN" ? "DNS 일시 실패"
    : code === "ECONNREFUSED" ? "연결 거부"
    : code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" ? "연결 시간 초과"
    : code === "ECONNRESET" || code === "UND_ERR_SOCKET" ? "연결이 끊김"
    : code === "CERT_HAS_EXPIRED" ? "TLS 인증서 만료"
    : /certificate|self-signed/i.test(raw) ? "TLS 인증서 문제"
    : /407/.test(raw) ? "프록시 인증 실패(407)"
    : "";
  return ([code, hint, raw].filter(Boolean).join(" · ") || "원인 미상").slice(0, 220);
}

// 고정 IP 프록시(ALIGO_PROXY_URL) 설정 시 그 프록시로 발송 → Aligo 발송IP 고정.
//   미설정이면 일반 fetch(Vercel 동적 IP).
async function aligoFetch(url: string, init: RequestInit): Promise<Response> {
  const proxy = env.aligo.proxyUrl;
  if (!proxy) {
    try { return await fetch(url, init); }
    catch (e) { throw new Error(`ALIGO 접속 실패(apis.aligo.in) — ${netReason(e)}`); }
  }

  let dispatcher: unknown;
  let proxyHost = "";
  try {
    const { ProxyAgent } = await import("undici");
    // Fixie/QuotaGuard 등은 URL 에 아이디:비번이 포함됨 → basic auth 를 명시 전달
    //   (undici 버전에 따라 userinfo 자동인식이 안 되면 407 발생하므로 token 직접 세팅)
    const u = new URL(proxy);
    proxyHost = u.host;
    const uri = `${u.protocol}//${u.host}`;
    const auth = u.username || u.password
      ? "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")
      : undefined;
    dispatcher = new ProxyAgent(auth ? { uri, token: auth } : { uri });
  } catch (e) {
    // 프록시 "설정"을 못 읽은 경우만 직접 발송으로 넘어간다(주소 형식 오류·undici 없음 등).
    console.error("[aligo] 프록시 설정을 읽지 못했습니다 — 직접 발송으로 폴백:", (e as Error).message);
    try { return await fetch(url, init); }
    catch (e2) { throw new Error(`ALIGO 접속 실패(프록시 설정 오류 후 직접 발송) — ${netReason(e2)}`); }
  }

  try {
    return await fetch(url, { ...init, dispatcher } as RequestInit);
  } catch (e) {
    // 프록시 경유 실패를 조용히 직접 발송으로 넘기지 않는다 —
    //   직접 발송은 Vercel 유동 IP 라 ALIGO 가 "인증오류-IP" 로 거절해 원인이 더 흐려진다.
    //   여기서는 프록시가 문제라는 사실을 그대로 알린다.
    throw new Error(`ALIGO 고정IP 프록시 연결 실패(${proxyHost}) — ${netReason(e)}`);
  }
}

/**
 * 단건/동일 메시지 발송. receiver 는 콤마 구분(최대 1,000).
 *   testmode 는 인자 > env(ALIGO_TEST_MODE) 순. 미설정 시 실발송.
 */
export async function sendSms(input: {
  receiver: string;            // "01012345678" 또는 "010...,010..."
  msg: string;
  title?: string;              // LMS/MMS 제목(최대 44바이트)
  senderOverride?: string;
  rdate?: string;              // 예약일 YYYYMMDD
  rtime?: string;              // 예약시간 HHMM
  testmode?: boolean;
}): Promise<SmsResult> {
  if (!aligoConfigured()) {
    return { ok: false, message: "ALIGO 환경변수(ALIGO_API_KEY·ALIGO_USER_ID·ALIGO_SENDER) 미설정" };
  }
  const type = smsType(input.msg);
  const test = input.testmode ?? env.aligo.testMode;
  const body = new URLSearchParams({
    key: env.aligo.apiKey,
    user_id: env.aligo.userId,
    sender: input.senderOverride || env.aligo.sender,
    receiver: normalizeReceivers(input.receiver),
    msg: input.msg,
    msg_type: type,
    testmode_yn: test ? "Y" : "N",
  });
  if (type !== "SMS" && input.title) body.set("title", input.title.slice(0, 40));
  if (input.rdate) body.set("rdate", input.rdate);
  if (input.rtime) body.set("rtime", input.rtime);

  return postAligo(SEND_URL, body, type);
}

/**
 * 개인화 대량 발송(수신자별 다른 메시지 — 발송 센터 {브랜드명} 치환).
 *   targets: [{receiver, msg}] 최대 500건/요청.
 */
export async function sendMass(input: {
  targets: { receiver: string; msg: string }[];
  title?: string;
  senderOverride?: string;
  testmode?: boolean;
}): Promise<SmsResult> {
  if (!aligoConfigured()) return { ok: false, message: "ALIGO 환경변수 미설정" };
  if (input.targets.length === 0) return { ok: false, message: "수신 대상 없음" };
  const type = smsType(input.targets[0].msg);
  const test = input.testmode ?? env.aligo.testMode;
  const body = new URLSearchParams({
    key: env.aligo.apiKey,
    user_id: env.aligo.userId,
    sender: input.senderOverride || env.aligo.sender,
    msg_type: type,
    cnt: String(input.targets.length),
    testmode_yn: test ? "Y" : "N",
  });
  if (type !== "SMS" && input.title) body.set("title", input.title.slice(0, 40));
  input.targets.forEach((t, i) => {
    const n = i + 1;
    body.set(`rec_${n}`, toKoreanLocalPhone(t.receiver));
    body.set(`msg_${n}`, t.msg);
  });
  return postAligo(MASS_URL, body, type);
}

/** 잔여 발송 가능 건수. */
export async function smsRemain(): Promise<{ ok: boolean; sms?: number; lms?: number; mms?: number; message: string }> {
  if (!aligoConfigured()) return { ok: false, message: "ALIGO 환경변수 미설정" };
  const body = new URLSearchParams({ key: env.aligo.apiKey, user_id: env.aligo.userId });
  try {
    const res = await aligoFetch(REMAIN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
    });
    const data = await res.json();
    if (Number(data.result_code) === 1 || data.SMS_CNT != null) {
      return { ok: true, sms: Number(data.SMS_CNT ?? 0), lms: Number(data.LMS_CNT ?? 0), mms: Number(data.MMS_CNT ?? 0), message: data.message ?? "" };
    }
    return { ok: false, message: data.message ?? "조회 실패" };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, message: /^ALIGO /.test(msg) ? msg : `잔여 건수 조회 실패 — ${netReason(e)}` };
  }
}

async function postAligo(url: string, body: URLSearchParams, type: string): Promise<SmsResult> {
  try {
    // ⚠ 반드시 aligoFetch(프록시 경유) — 일반 fetch 는 Vercel 유동 IP → ALIGO "인증오류-IP"
    const res = await aligoFetch(url, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
    });
    const data = await res.json();
    const code = Number(data.result_code);
    // Aligo: result_code 1 = 성공(접수), 음수 = 실패.
    if (code === 1) {
      return {
        ok: true, msgId: String(data.msg_id ?? ""), type,
        successCnt: Number(data.success_cnt ?? 0), errorCnt: Number(data.error_cnt ?? 0),
        code, message: data.message ?? "접수 완료",
      };
    }
    return { ok: false, code, message: data.message ?? `발송 실패(code ${code})` };
  } catch (e) {
    // "fetch failed" 한 줄로 끝내지 않는다 — 무엇 때문에 못 붙었는지 남긴다.
    const msg = (e as Error).message;
    return {
      ok: false, indeterminate: true,
      message: /^ALIGO /.test(msg) ? msg : `문자 발송 실패 — ${netReason(e)}`,
    };
  }
}

// ── 연동 점검 ────────────────────────────────────────────────
export interface SmsCheck {
  envOk: boolean;
  missing: string[];
  /** 고정 IP 프록시 사용 여부·호스트(아이디·비번은 담지 않는다). */
  proxySet: boolean;
  proxyHost: string;
  proxyFrom: string;
  testMode: boolean;
  /** 실제 호출(잔여 건수) 결과 — 문자를 보내지 않는다. */
  reachable: boolean;
  note: string;
  remain?: { sms: number; lms: number; mms: number };
}

/**
 * 문자 연동 점검 — 문자를 보내지 않고 잔여 건수 조회로 접속·인증만 확인한다.
 *   "fetch failed" 가 났을 때 키 문제인지 프록시 문제인지 네트워크 문제인지 가른다.
 *   비밀값(키·프록시 비번)은 반환하지 않는다.
 */
export async function checkSms(): Promise<SmsCheck> {
  const missing = [
    !env.aligo.apiKey && "ALIGO_API_KEY",
    !env.aligo.userId && "ALIGO_USER_ID",
    !env.aligo.sender && "ALIGO_SENDER",
  ].filter(Boolean) as string[];

  const proxy = env.aligo.proxyUrl;
  let proxyHost = "";
  if (proxy) { try { proxyHost = new URL(proxy).host; } catch { proxyHost = "(주소 형식 오류)"; } }

  const base: SmsCheck = {
    envOk: missing.length === 0, missing,
    proxySet: Boolean(proxy), proxyHost,
    proxyFrom: process.env.ALIGO_PROXY_URL ? "ALIGO_PROXY_URL" : process.env.FIXIE_URL ? "FIXIE_URL" : "",
    testMode: env.aligo.testMode,
    reachable: false, note: "",
  };
  if (missing.length) return { ...base, note: `환경변수 미설정: ${missing.join(", ")}` };

  const r = await smsRemain();
  if (r.ok) {
    return {
      ...base, reachable: true,
      note: proxy ? `정상 — 고정 IP 프록시(${proxyHost}) 경유로 접속됩니다` : "정상 — 직접 접속됩니다",
      remain: { sms: r.sms ?? 0, lms: r.lms ?? 0, mms: r.mms ?? 0 },
    };
  }
  return { ...base, note: r.message };
}
