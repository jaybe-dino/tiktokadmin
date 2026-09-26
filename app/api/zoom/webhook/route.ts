import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { env } from "@/lib/env";
import { query } from "@/lib/db";
import { matchMeetingBrand, matchHostAdmin, type ZoomParticipant } from "@/lib/meetings";
import { enqueueZoomEvent, runZoomIngest, type ZoomEventPayload } from "@/lib/zoom-ingest";
import { verifyZoomWebhook, urlValidationAnswer } from "@/lib/zoom-webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Zoom 웹훅 — URL 검증 + HMAC 서명검증 + 재전송(replay) 방어 + 빠른 200.
//   녹화·전사 이벤트는 원장(zoom_webhook_events)에 넣기만 하고 즉시 응답한다.
//   실제 처리(브랜드 매핑·전사 내려받기)는 응답 뒤(after) 또는 크론 워커에서 한다.
//   → Zoom 의 3초 응답 제한을 넘기지 않고, 실패해도 같은 이벤트를 안전하게 다시 처리할 수 있다.

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = env.zoom.webhookSecret;

  let body: ZoomEventPayload;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  // 시크릿이 없으면 어떤 요청도 받지 않는다(fail closed).
  //   ※ 운영에 ZOOM_WEBHOOK_SECRET 이 설정돼 있어야 웹훅이 동작한다.
  //     /meetings 의 Zoom 카드 ① 에서 입력 여부를 바로 확인할 수 있다.
  if (!secret) {
    console.error("[zoom] ZOOM_WEBHOOK_SECRET 미설정 — 웹훅 요청을 거부했습니다(서명 검증 불가).");
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  // URL 검증 챌린지 (endpoint.url_validation) — 시크릿으로 서명해 응답한다.
  if (body.event === "endpoint.url_validation" && body.payload?.plainToken) {
    const plainToken = body.payload.plainToken;
    const encryptedToken = urlValidationAnswer(secret, plainToken);
    if (!encryptedToken) return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
    return NextResponse.json({ plainToken, encryptedToken });
  }

  // 서명 검증 (x-zm-signature: v0=HMAC(secret, "v0:"+ts+":"+body)) + 재전송 방어.
  const auth = verifyZoomWebhook({
    secret,
    ts: req.headers.get("x-zm-request-timestamp"),
    sig: req.headers.get("x-zm-signature"),
    raw,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 녹화·전사 — 원장에 접수만 하고 바로 응답. 중복 전송은 여기서 걸러진다.
  if (body.event === "recording.completed" || body.event === "recording.transcript_completed") {
    // 접수 실패를 200 으로 삼키면 Zoom 이 재전송하지 않아 그 회의가 영구히 사라진다.
    //   5xx 로 답해 재전송을 받는다(중복은 dedupe_key 로 걸러진다).
    let q: { queued: boolean; duplicate?: boolean };
    try { q = await enqueueZoomEvent(body); }
    catch (e) {
      console.error("[zoom] 웹훅 접수 실패:", (e as Error).message);
      return NextResponse.json({ error: "enqueue failed" }, { status: 503 });
    }
    // 응답을 보낸 뒤 처리 — 실패하면 크론이 다시 집어간다.
    if (q.queued) after(async () => { await runZoomIngest(3).catch((e) => { console.error("[zoom] 후처리 실패:", (e as Error).message); }); });
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
