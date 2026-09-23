import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { query } from "@/lib/db";
import { matchMeetingBrand, matchHostAdmin, type ZoomParticipant } from "@/lib/meetings";
import { enqueueZoomEvent, runZoomIngest, type ZoomEventPayload } from "@/lib/zoom-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Zoom 웹훅 — URL 검증 + HMAC 서명검증 + 재전송(replay) 방어 + 빠른 200.
//   녹화·전사 이벤트는 원장(zoom_webhook_events)에 넣기만 하고 즉시 응답한다.
//   실제 처리(브랜드 매핑·전사 내려받기)는 응답 뒤(after) 또는 크론 워커에서 한다.
//   → Zoom 의 3초 응답 제한을 넘기지 않고, 실패해도 같은 이벤트를 안전하게 다시 처리할 수 있다.

/** 서명 타임스탬프 허용 오차(초) — 오래된 요청 재전송 차단. */
const REPLAY_WINDOW_SEC = 300;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = env.zoom.webhookSecret;

  let body: ZoomEventPayload;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  // URL 검증 챌린지 (endpoint.url_validation)
  if (body.event === "endpoint.url_validation" && body.payload?.plainToken) {
    const plainToken = body.payload.plainToken;
    const encryptedToken = secret
      ? crypto.createHmac("sha256", secret).update(plainToken).digest("hex")
      : plainToken;
    return NextResponse.json({ plainToken, encryptedToken });
  }

  // 서명 검증 (x-zm-signature: v0=HMAC(secret, "v0:"+ts+":"+body))
  if (secret) {
    const ts = req.headers.get("x-zm-request-timestamp") ?? "";
    const sig = req.headers.get("x-zm-signature") ?? "";
    // 오래된 타임스탬프는 거절 — 가로챈 요청을 나중에 그대로 다시 보내는 것을 막는다.
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > REPLAY_WINDOW_SEC) {
      return NextResponse.json({ error: "stale timestamp" }, { status: 401 });
    }
    const expected = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
    if (!timingSafeEq(sig, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 녹화·전사 — 원장에 접수만 하고 바로 응답. 중복 전송은 여기서 걸러진다.
  if (body.event === "recording.completed" || body.event === "recording.transcript_completed") {
    const q = await enqueueZoomEvent(body).catch(() => ({ queued: false, duplicate: false }));
    // 응답을 보낸 뒤 처리 — 실패하면 크론이 다시 집어간다.
    if (q.queued) after(async () => { await runZoomIngest(3).catch(() => null); });
    return NextResponse.json({ ok: true, queued: q.queued, duplicate: Boolean(q.duplicate) });
  }

  // 일정 이벤트(예약·변경·취소)는 가볍고 순서가 중요해 그대로 즉시 처리한다.
  try { await handleScheduleEvent(body); }
  catch (e) { console.error("[zoom] schedule handler:", (e as Error).message); }
  return NextResponse.json({ ok: true });
}

async function handleScheduleEvent(body: ZoomEventPayload) {
  const obj = body.payload?.object;
  const zoomUuid = obj?.uuid;
  if (!obj || !zoomUuid) return;

  const participants: ZoomParticipant[] =
    (obj.participants as ZoomParticipant[] | undefined) ??
    (obj.registrant_email ? [{ email: obj.registrant_email }] : []);

  switch (body.event) {
    case "meeting.created": {
      const exists = await query("SELECT 1 FROM meetings WHERE zoom_uuid=$1", [zoomUuid]).catch(() => []);
      if (exists.length) return;
      const brandId = await matchMeetingBrand(participants, obj.host_email ?? null, obj.topic ?? "");
      const hostAdmin = await matchHostAdmin(obj.host_email ?? null);
      await query(
        `INSERT INTO meetings (brand_id, zoom_meeting_id, zoom_uuid, topic, host_email, participants,
           scheduled_at, host_admin_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'zoom-webhook')`,
        [brandId, String(obj.id ?? ""), zoomUuid, obj.topic ?? "", obj.host_email ?? null,
         JSON.stringify(participants), obj.start_time ?? null, hostAdmin,
         brandId ? "scheduled" : "unmatched"]).catch(() => {});
      break;
    }
    case "meeting.updated":
      await query("UPDATE meetings SET scheduled_at=COALESCE($2,scheduled_at) WHERE zoom_uuid=$1",
        [zoomUuid, obj.start_time ?? null]).catch(() => {});
      break;
    case "meeting.deleted":
      // 이미 녹화가 들어온 회의는 취소로 되돌리지 않는다(이벤트 역순 도착 방어).
      await query("UPDATE meetings SET status='canceled' WHERE zoom_uuid=$1 AND status='scheduled'", [zoomUuid]).catch(() => {});
      break;
    default:
      break;
  }
}

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
