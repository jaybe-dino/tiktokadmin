import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { query, queryOne } from "@/lib/db";
import { matchMeetingBrand, matchHostAdmin, type ZoomParticipant } from "@/lib/meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Zoom 웹훅 (08 §3) — URL validation + HMAC 서명검증 + 멱등 미팅 저장.
//   전사·요약은 별도 워커(/api/cron/meeting-process)에서 처리(외부 API 키 필요).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = env.zoom.webhookSecret;

  let body: ZoomEvent;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

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
    const msg = `v0:${ts}:${raw}`;
    const expected = "v0=" + crypto.createHmac("sha256", secret).update(msg).digest("hex");
    if (!timingSafeEq(sig, expected)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    await handleEvent(body);
  } catch (e) {
    console.error("[zoom] handler error:", (e as Error).message);
    // 200 을 돌려 Zoom 재시도 폭주를 막고, 오류는 meetings.error 에 남는다.
  }
  return NextResponse.json({ ok: true });
}

async function handleEvent(body: ZoomEvent) {
  const obj = body.payload?.object;
  if (!obj) return;
  const zoomUuid = obj.uuid;
  if (!zoomUuid) return;

  const participants: ZoomParticipant[] =
    (obj.participants as ZoomParticipant[] | undefined) ??
    (obj.registrant_email ? [{ email: obj.registrant_email }] : []);

  switch (body.event) {
    case "meeting.created": {
      const brandId = await matchMeetingBrand(participants, obj.host_email ?? null, obj.topic ?? "");
      const hostAdmin = await matchHostAdmin(obj.host_email ?? null);
      await upsertMeeting({
        zoomUuid, zoomMeetingId: String(obj.id ?? ""), topic: obj.topic ?? "",
        hostEmail: obj.host_email ?? null, scheduledAt: obj.start_time ?? null,
        brandId, hostAdmin, status: "scheduled", participants,
      });
      break;
    }
    case "meeting.updated": {
      await query("UPDATE meetings SET scheduled_at=COALESCE($2,scheduled_at) WHERE zoom_uuid=$1",
        [zoomUuid, obj.start_time ?? null]);
      break;
    }
    case "meeting.deleted": {
      await query("UPDATE meetings SET status='canceled' WHERE zoom_uuid=$1", [zoomUuid]);
      break;
    }
    case "recording.completed": {
      const brandId = await matchMeetingBrand(participants, obj.host_email ?? null, obj.topic ?? "");
      const hostAdmin = await matchHostAdmin(obj.host_email ?? null);
      const recUrl = obj.share_url ?? (obj.recording_files?.[0]?.download_url ?? null);
      await upsertMeeting({
        zoomUuid, zoomMeetingId: String(obj.id ?? ""), topic: obj.topic ?? "",
        hostEmail: obj.host_email ?? null, scheduledAt: obj.start_time ?? null,
        brandId, hostAdmin, status: brandId ? "received" : "unmatched",
        recordingUrl: recUrl, startedAt: obj.start_time ?? null, participants,
      });
      break;
    }
    default:
      // recording.transcript_completed / meeting.summary_completed 등은 워커에서 참고 저장.
      break;
  }
}

async function upsertMeeting(m: {
  zoomUuid: string; zoomMeetingId: string; topic: string; hostEmail: string | null;
  scheduledAt: string | null; brandId: string | null; hostAdmin: string | null;
  status: string; recordingUrl?: string | null; startedAt?: string | null;
  participants: ZoomParticipant[];
}) {
  const exists = await queryOne<{ id: string }>("SELECT id FROM meetings WHERE zoom_uuid=$1", [m.zoomUuid]);
  if (exists) {
    await query(
      `UPDATE meetings SET status=$2, recording_url=COALESCE($3,recording_url),
         started_at=COALESCE($4,started_at), brand_id=COALESCE(brand_id,$5),
         host_admin_id=COALESCE(host_admin_id,$6) WHERE zoom_uuid=$1`,
      [m.zoomUuid, m.status, m.recordingUrl ?? null, m.startedAt ?? null, m.brandId, m.hostAdmin]);
    return;
  }
  await query(
    `INSERT INTO meetings (brand_id, zoom_meeting_id, zoom_uuid, topic, host_email, participants,
       scheduled_at, host_admin_id, started_at, recording_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [m.brandId, m.zoomMeetingId, m.zoomUuid, m.topic, m.hostEmail, JSON.stringify(m.participants),
     m.scheduledAt, m.hostAdmin, m.startedAt ?? null, m.recordingUrl ?? null, m.status]);
}

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

interface ZoomEvent {
  event: string;
  payload?: {
    plainToken?: string;
    object?: {
      uuid?: string; id?: number | string; topic?: string; host_email?: string;
      start_time?: string; registrant_email?: string; share_url?: string;
      participants?: ZoomParticipant[];
      recording_files?: { download_url?: string }[];
    };
  };
}
