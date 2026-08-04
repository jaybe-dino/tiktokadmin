"use server";

// 1:1 미팅 잡기(브랜드360) + 미팅캘린더 참석자·일시 수정 서버액션 (PLAN §8 미팅).
// (@/app/actions.ts 수정 금지 규칙 — 화면 전용 파일 신규)
//   · meetings 는 어드민 소유 테이블(0008·0019) — INSERT/UPDATE 허용.
//   · 초대 메일은 lib/meeting-invite(ICS + Resend) 경유, RESEND 미설정 시 스킵.
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { sendMeetingInvites, type Attendee, type InviteSendResult } from "@/lib/meeting-invite";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 참석자 정리 — 이메일 검증·소문자 dedupe·최대 30명 */
function cleanAttendees(raw: unknown): Attendee[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const email = String((r as { email?: unknown }).email ?? "").trim();
    const name = String((r as { name?: unknown }).name ?? "").trim().slice(0, 80);
    if (!EMAIL_RE.test(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email });
    if (out.length >= 30) break;
  }
  return out;
}

/** datetime-local("YYYY-MM-DDTHH:MM", KST 입력) → instant */
function parseKstInput(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 16)}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validJoinUrl(s: unknown): string | null {
  const url = String(s ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 500) return null;
  return url;
}

// ── 폼 옵션: 지정인(파트장 lead/대표 exec/담당) + 기본 참석자(브랜드 담당자 이메일) ──
export interface MeetingInviteOptions {
  ok: boolean;
  error?: string;
  brandName?: string;
  hosts?: { id: string; name: string; role: string; email: string }[];
  attendees?: Attendee[];
}

export async function getMeetingInviteOptionsAction(brandId: string): Promise<MeetingInviteOptions> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };

  const brand = await queryOne<{
    brand_name: string; email: string | null; contact_name: string | null;
    owner_intake: string | null; owner_sales: string | null; owner_onboard: string | null; owner_ads: string | null;
  }>(
    `SELECT brand_name, email, contact_name, owner_intake, owner_sales, owner_onboard, owner_ads
       FROM brands WHERE id=$1`, [brandId],
  ).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  const owners = [brand.owner_intake, brand.owner_sales, brand.owner_onboard, brand.owner_ads]
    .filter((v): v is string => Boolean(v));

  // 지정인: 파트장(lead)·대표(exec) + 이 브랜드 담당(owner_*)
  const hosts = await query<{ id: string; name: string; role: string; zoom_email: string | null }>(
    `SELECT id, name, role, zoom_email FROM admin_users
      WHERE active AND (role IN ('lead','exec') OR id = ANY($1::text[]))
      ORDER BY CASE role WHEN 'exec' THEN 0 WHEN 'lead' THEN 1 ELSE 2 END, name`,
    [owners],
  ).catch(() => [] as { id: string; name: string; role: string; zoom_email: string | null }[]);

  // 기본 참석자: 브랜드 대표 이메일 + 담당자 연락처(brand_contacts) 이메일
  const contacts = await query<{ name: string; email: string | null }>(
    `SELECT name, email FROM brand_contacts
      WHERE brand_id=$1 AND email IS NOT NULL AND email <> ''
      ORDER BY is_primary DESC, created_at ASC LIMIT 20`,
    [brandId],
  ).catch(() => [] as { name: string; email: string | null }[]);

  const attendees = cleanAttendees([
    ...(brand.email ? [{ name: brand.contact_name || brand.brand_name, email: brand.email }] : []),
    ...contacts.map((c) => ({ name: c.name, email: c.email ?? "" })),
  ]);

  return {
    ok: true,
    brandName: brand.brand_name,
    hosts: hosts.map((h) => ({ id: h.id, name: h.name, role: h.role, email: h.zoom_email || h.id })),
    attendees,
  };
}

// ── 1:1 미팅 등록 + 초대 발송 ────────────────────────────────
export interface ScheduleMeetingResult {
  ok: boolean;
  error?: string;
  meetingId?: string;
  invite?: InviteSendResult;
  smsSent?: boolean;
}

export async function scheduleMeetingAction(
  brandId: string,
  input: { scheduledAt: string; topic?: string; hostId: string; zoomJoinUrl: string; attendees: Attendee[] },
): Promise<ScheduleMeetingResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };

  const start = parseKstInput(input.scheduledAt);
  if (!start) return { ok: false, error: "일시를 선택하세요." };
  const joinUrl = validJoinUrl(input.zoomJoinUrl);
  if (!joinUrl) return { ok: false, error: "줌 링크(https://…)를 입력하세요." };
  const attendees = cleanAttendees(input.attendees);
  if (attendees.length === 0) return { ok: false, error: "참석자 이메일을 1명 이상 입력하세요." };

  const brand = await queryOne<{ id: string; brand_name: string; phone: string | null }>(
    "SELECT id, brand_name, phone FROM brands WHERE id=$1", [brandId]);
  if (!brand) return { ok: false, error: "존재하지 않는 브랜드입니다." };

  // 지정인 검증 — 실존 활성 admin_users 만 (하드코딩·유령 지정 방지)
  const host = await queryOne<{ id: string; name: string; zoom_email: string | null }>(
    "SELECT id, name, zoom_email FROM admin_users WHERE id=$1 AND active", [input.hostId ?? ""]);
  if (!host) return { ok: false, error: "지정인을 선택하세요." };
  const hostEmail = host.zoom_email || host.id;

  const topic = String(input.topic ?? "").trim().slice(0, 200) || "1:1 미팅";

  // 줌 링크에서 미팅 ID 추출(예: /j/1234567890) → zoom_meeting_id 저장.
  //   추후 recording.completed 웹훅이 이 미팅 ID 로 예약 미팅(회사)과 연결 가능.
  const zoomMeetingId = joinUrl.match(/\/j\/(\d+)/)?.[1] || "manual";

  // 어드민 수동 등록 — zoom_uuid 는 NOT NULL UNIQUE 라 admin: 접두 멱등키 생성.
  const row = await queryOne<{ id: string }>(
    `INSERT INTO meetings
       (brand_id, zoom_meeting_id, zoom_uuid, topic, host_email, scheduled_at,
        attendees, zoom_join_url, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled')
     RETURNING id`,
    [brandId, zoomMeetingId, `admin:${crypto.randomUUID()}`, topic, hostEmail, start.toISOString(),
     JSON.stringify(attendees), joinUrl, u.id],
  ).catch(() => null);
  if (!row) return { ok: false, error: "미팅 등록 실패 (마이그레이션 0019 적용 여부 확인)" };

  // 참석자 이메일 초대(ICS) — RESEND/Gmail 미설정이면 스킵되고 등록은 유지.
  const invite = await sendMeetingInvites({
    meetingId: row.id, topic, brandName: brand.brand_name, start,
    zoomJoinUrl: joinUrl, hostEmail, hostName: host.name, attendees,
  }).catch((e: Error): InviteSendResult => ({ sent: 0, failed: attendees.length, skipped: false, errors: [e.message] }));

  // 브랜드 연락처로 1:1 안내 문자 발송(전화 있으면). 거래성(reminder)이라 동의 게이트 통과.
  let smsSent = false;
  if (brand.phone) {
    const whenKst = start.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
    const { sendSms } = await import("@/lib/sms");
    const r = await sendSms({
      receiver: brand.phone,
      msg: `[GloveK] ${brand.brand_name}님, 1:1 미팅 안내\n일시: ${whenKst}\n줌 참여: ${joinUrl}`,
    }).catch(() => ({ ok: false } as { ok: boolean }));
    smsSent = r.ok;
    if (r.ok) {
      await query(
        `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
         VALUES ($1,'admin','contact_logged',$2,now())`,
        [brandId, JSON.stringify({ channel: "sms", kind: "meeting_invite", meeting_id: row.id })]).catch(() => {});
      await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [brandId]).catch(() => {});
    }
  }

  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/meetings");
  return { ok: true, meetingId: row.id, invite, smsSent };
}

// ── 미팅캘린더: 참석자·일시 수정 (+재초대 옵션) ──────────────
export interface UpdateMeetingResult {
  ok: boolean;
  error?: string;
  invite?: InviteSendResult;
}

export async function updateMeetingAction(
  meetingId: string,
  input: { scheduledAt: string; attendees: Attendee[]; zoomJoinUrl?: string; topic?: string; resendInvites: boolean },
): Promise<UpdateMeetingResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(meetingId)) return { ok: false, error: "잘못된 미팅 ID" };

  const meeting = await queryOne<{
    id: string; brand_id: string | null; topic: string; host_email: string | null;
    zoom_join_url: string | null; created_by: string | null; status: string;
  }>(
    `SELECT m.id, m.brand_id, m.topic, m.host_email, m.zoom_join_url, m.created_by, m.status
       FROM meetings m WHERE m.id=$1`, [meetingId]);
  if (!meeting) return { ok: false, error: "존재하지 않는 미팅입니다." };

  const start = parseKstInput(input.scheduledAt);
  if (!start) return { ok: false, error: "일시를 선택하세요." };
  const attendees = cleanAttendees(input.attendees);
  const joinUrl = input.zoomJoinUrl?.trim() ? validJoinUrl(input.zoomJoinUrl) : null;
  if (input.zoomJoinUrl?.trim() && !joinUrl) return { ok: false, error: "줌 링크 형식이 올바르지 않습니다." };
  const topic = String(input.topic ?? "").trim().slice(0, 200);

  await query(
    `UPDATE meetings
        SET scheduled_at=$2,
            attendees=$3,
            zoom_join_url=COALESCE($4, zoom_join_url),
            topic=COALESCE(NULLIF($5,''), topic),
            status=CASE WHEN status='canceled' THEN 'scheduled' ELSE status END
      WHERE id=$1`,
    [meetingId, start.toISOString(), JSON.stringify(attendees), joinUrl, topic]);

  let invite: InviteSendResult | undefined;
  if (input.resendInvites && attendees.length > 0) {
    const finalUrl = joinUrl ?? meeting.zoom_join_url ?? "";
    const hostEmail = meeting.host_email || meeting.created_by || u.id;
    // 호스트 이름(있으면) — admin_users id 또는 zoom_email 로 역조회
    const hostRow = await queryOne<{ name: string }>(
      `SELECT name FROM admin_users
        WHERE id=$1 OR (zoom_email IS NOT NULL AND lower(zoom_email)=lower($1)) LIMIT 1`,
      [hostEmail]).catch(() => null);
    let brandName: string | null = null;
    if (meeting.brand_id) {
      const b = await queryOne<{ brand_name: string }>(
        "SELECT brand_name FROM brands WHERE id=$1", [meeting.brand_id]).catch(() => null);
      brandName = b?.brand_name ?? null;
    }
    if (!finalUrl) {
      invite = { sent: 0, failed: 0, skipped: false, errors: ["줌 링크가 없어 재초대를 보내지 못했습니다."] };
    } else {
      invite = await sendMeetingInvites({
        meetingId, topic: topic || meeting.topic || "1:1 미팅", brandName, start,
        zoomJoinUrl: finalUrl, hostEmail, hostName: hostRow?.name, attendees,
        sequence: Math.floor(Date.now() / 1000), // 재초대 — SEQUENCE 증가로 캘린더 갱신
        isUpdate: true,
      }).catch((e: Error): InviteSendResult => ({ sent: 0, failed: attendees.length, skipped: false, errors: [e.message] }));
    }
  }

  revalidatePath("/meetings");
  if (meeting.brand_id) revalidatePath(`/brand/${meeting.brand_id}`);
  return { ok: true, invite };
}
