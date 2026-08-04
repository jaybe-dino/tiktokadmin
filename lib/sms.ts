// Aligo SMS 발송 (smartsms.aligo.in) — 09-C 발송 센터의 문자 채널.
//   ⚠️ 시크릿(키)은 env 만. 코드/로그/커밋 금지. 발신번호는 Aligo 사전등록 필수.
import { env } from "./env";

const SEND_URL = "https://apis.aligo.in/send/";       // 단건/동일메시지 대량
const MASS_URL = "https://apis.aligo.in/send_mass/";  // 개인화 대량(수신자별 다른 메시지)
const REMAIN_URL = "https://apis.aligo.in/remain/";   // 잔여건수

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

// 고정 IP 프록시(ALIGO_PROXY_URL) 설정 시 그 프록시로 발송 → Aligo 발송IP 고정.
//   미설정이면 일반 fetch(Vercel 동적 IP). undici 없으면 조용히 일반 fetch 폴백.
async function aligoFetch(url: string, init: RequestInit): Promise<Response> {
  const proxy = env.aligo.proxyUrl;
  if (!proxy) return fetch(url, init);
  try {
    const { ProxyAgent } = await import("undici");
    // Fixie/QuotaGuard 등은 URL 에 아이디:비번이 포함됨 → basic auth 를 명시 전달
    //   (undici 버전에 따라 userinfo 자동인식이 안 되면 407 발생하므로 token 직접 세팅)
    const u = new URL(proxy);
    const uri = `${u.protocol}//${u.host}`;
    const auth = u.username || u.password
      ? "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")
      : undefined;
    const dispatcher = new ProxyAgent(auth ? { uri, token: auth } : { uri });
    return fetch(url, { ...init, dispatcher } as RequestInit);
  } catch (e) {
    console.error("[aligo] proxy fetch 실패, 직접 발송 폴백:", (e as Error).message);
    return fetch(url, init);
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
    receiver: input.receiver.replace(/[^0-9,]/g, ""),
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
    body.set(`rec_${n}`, t.receiver.replace(/[^0-9]/g, ""));
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
    return { ok: false, message: (e as Error).message };
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
    return { ok: false, message: (e as Error).message };
  }
}
