import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { KAKAO_SECRET_ENV, kakaoSchemaState, ingestKakaoMessages, verifyKakaoMessages } from "@/lib/kakao-rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 카카오톡 수집기(PC) → 서버. 받아서 저장만 한다 — 이 경로로 고객에게 나가는 것은 없다.
//
//   인증: 헤더 x-kakao-secret (또는 Authorization: Bearer) 가 환경변수와 정확히 일치해야 한다.
//         환경변수가 설정돼 있지 않으면 어떤 요청도 받지 않는다(fail closed).
//         ※ 비밀키는 코드에 두지 않는다. 담당자가 직접 만들어 Vercel 환경변수에 넣어야 한다.
//
//   본문: { room_key, room_name?, agent?, messages: [{ external_id, at, author?, text }] }
//     · 처음 보는 방은 확인 대기(pending)로만 등록하고 메시지는 저장하지 않는다.
//     · 같은 external_id 는 다시 보내도 한 번만 저장된다.
function readSecret(req: NextRequest): string | null {
  const direct = req.headers.get("x-kakao-secret");
  if (direct) return direct;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return bearer || null;
}

function secretOk(provided: string | null): boolean {
  const expected = process.env[KAKAO_SECRET_ENV] ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!process.env[KAKAO_SECRET_ENV]) {
    // 수집 비밀키가 없으면 "연결됐다"고 말하지 않고 그대로 거부한다.
    return NextResponse.json(
      { ok: false, error: "collector_not_configured", hint: `${KAKAO_SECRET_ENV} 환경변수가 설정되지 않았습니다.` },
      { status: 503 });
  }
  const header = readSecret(req);
  if (!secretOk(header)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const schema = await kakaoSchemaState();
  if (!schema.ready) {
    return NextResponse.json(
      { ok: false, error: "migration_pending", missing: schema.missing }, { status: 503 });
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 2_000_000) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const body = parsed as {
    operation?: string; external_ids?: string[];
    room_key?: string; room_name?: string; agent?: string;
    messages?: { external_id?: string; at?: string; author?: string; text?: string }[];
  } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (body.operation === "verify") {
    if (typeof body.room_key !== "string" || !body.room_key.trim() ||
        !Array.isArray(body.external_ids) || body.external_ids.length > 500 ||
        body.external_ids.some((id) => typeof id !== "string" || !id.trim())) {
      return NextResponse.json({ ok: false, error: "bad_verification_request" }, { status: 400 });
    }
    return NextResponse.json(await verifyKakaoMessages(body.room_key.trim(), body.external_ids));
  }
  if (body.operation && body.operation !== "ingest") {
    return NextResponse.json({ ok: false, error: "unknown_operation" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length > 500) {
    return NextResponse.json({ ok: false, error: "invalid_batch_size" }, { status: 400 });
  }

  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(0, 500).map((m) => ({
    externalId: String(m?.external_id ?? ""),
    at: String(m?.at ?? ""),
    author: String(m?.author ?? ""),
    text: String(m?.text ?? ""),
  }));

  const r = await ingestKakaoMessages({
    roomKey: String(body.room_key ?? ""),
    roomName: String(body.room_name ?? ""),
    agent: String(body.agent ?? ""),
    messages,
  });
  // 저장하지 않은 경우에도 왜 그런지 그대로 돌려준다(수집기가 상태를 알 수 있게).
  return NextResponse.json(r, { status: r.status === "rejected" ? 400 : 200 });
}

// 수집기 상태 점검용 — 비밀키가 맞을 때만 설정 상태를 알려준다.
export async function GET(req: NextRequest) {
  if (!process.env[KAKAO_SECRET_ENV]) {
    return NextResponse.json({ ok: false, error: "collector_not_configured" }, { status: 503 });
  }
  const header = readSecret(req);
  if (!secretOk(header)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const schema = await kakaoSchemaState();
  return NextResponse.json({ ok: schema.ready, migration: schema.missing });
}
