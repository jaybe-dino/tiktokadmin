import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { linkEmail, type IncomingEmail } from "@/lib/email-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 담당자 자동전달/BCC → 어드민 수신. 참여 이메일로 고객 매칭해 카드에 기록.
//   POST /api/email/inbound  (헤더 X-Ingest-Secret)
//   body: { from, to, cc?, subject, text, message_id?, date? }
//   Resend Inbound / 커스텀 포워더 모두 이 형태로 보내면 됨.

function secretOk(provided: string | null): boolean {
  const expected = env.ingestSecret;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretOk(req.headers.get("x-ingest-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Resend/일반 포워더 필드 정규화
  const e: IncomingEmail = {
    from: (body.from ?? body.sender) as string | undefined,
    to: (body.to ?? body.recipient ?? body.recipients) as string | string[] | undefined,
    cc: body.cc as string | string[] | undefined,
    subject: body.subject as string | undefined,
    text: (body.text ?? body.body ?? body.plain) as string | undefined,
    message_id: (body.message_id ?? body.messageId ?? body["message-id"]) as string | undefined,
    date: (body.date ?? body.timestamp) as string | undefined,
  };

  const res = await linkEmail(e, "inbound");
  return NextResponse.json(res);
}
