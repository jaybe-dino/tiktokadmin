// 줌 미팅 파이프라인 (08) — 매칭·다음스텝 체크리스트·팔로업 초안.
//   외부 호출(STT·요약)은 워커에서. 여기엔 순수/DB 로직만.
import { query, queryOne, getPool } from "./db";
import { extractKeys, findBrand } from "./dedup";
import { GATES, type GateContext, evaluateGate } from "./gates";
import { FORWARD_TRANSITIONS } from "./states";
import type { Brand, State } from "./types";

export interface ZoomParticipant { name?: string; email?: string }

/** 참가자 이메일(호스트 제외) → brands, 실패 시 topic 브랜드명 → NULL(수동 매칭). */
export async function matchMeetingBrand(
  participants: ZoomParticipant[], hostEmail: string | null, topic: string,
): Promise<string | null> {
  const client = await getPool().connect();
  try {
    for (const p of participants) {
      if (!p.email || (hostEmail && p.email.toLowerCase() === hostEmail.toLowerCase())) continue;
      // 1) 별칭 → 2) brands 매칭
      const alias = await queryOne<{ brand_id: string }>(
        "SELECT brand_id FROM brand_email_aliases WHERE lower(email)=lower($1) LIMIT 1", [p.email]);
      if (alias) return alias.brand_id;
      const b = await findBrand(client, extractKeys({ email: p.email }));
      if (b) return b.id;
    }
    // 3) topic 에 브랜드명 포함
    const m = topic.match(/\[([^\]]+)\]/);
    const name = (m?.[1] ?? topic).trim();
    if (name) {
      const byName = await queryOne<{ id: string }>(
        "SELECT id FROM brands WHERE brand_name=$1 OR lower(brand_name)=lower($1) LIMIT 1", [name]);
      if (byName) return byName.id;
    }
    return null;
  } finally {
    client.release();
  }
}

/** host_email → admin_users(zoom_email) 매핑. */
export async function matchHostAdmin(hostEmail: string | null): Promise<string | null> {
  if (!hostEmail) return null;
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM admin_users WHERE lower(zoom_email)=lower($1) LIMIT 1", [hostEmail]);
  return row?.id ?? null;
}

export interface NextStepItem { label: string; done: boolean }
export interface NextStepGuide { from: State; to: State; items: NextStepItem[] }

/** 현재 state 기준 다음 전이의 게이트 체크리스트 (08 §3-5, gates.ts 재사용). */
export async function nextStepGuide(brand: Brand, ctx: GateContext): Promise<NextStepGuide | null> {
  const nexts = FORWARD_TRANSITIONS[brand.state] ?? [];
  // 종료 상태 제외한 첫 전진 대상.
  const to = nexts.find((s) => s !== "dropped" && s !== "churned");
  if (!to) return null;
  const key = `${brand.state}→${to}`;
  const rules = GATES[key];
  if (!rules) {
    const res = evaluateGate(brand.state, to, ctx);
    return { from: brand.state, to, items: res.passed ? [] : [] };
  }
  const items = rules.map((r) => ({ label: r.label.replace(/ 없음| 미지정| 미정| 아님/g, ""), done: r.test(ctx) }));
  return { from: brand.state, to, items };
}

/** 08 §3-4 표준 회의록 포맷 프롬프트(요약 워커에서 사용). */
export const SUMMARY_FORMAT = `## 상담 요약 · {브랜드} · {날짜}
**참석**: … / **길이**: n분
**핵심 니즈**: (1~3줄)
**논의 플랜/국가**: Live Focus|Guarantee|Onboarding · 국가
**우려/반대 포인트**: …
**합의/약속한 것**: …
**다음 액션**: [ ] … (기한)
**등급 시그널**: 5대 지표 관련 새로 파악된 사실`;

/** 팔로업 메일 초안 생성 → email_drafts. 설문 링크 자동 포함(14-A). */
export async function draftFollowup(input: {
  brand: Brand; meetingId: string; summaryMd: string; surveyUrl?: string;
}): Promise<string> {
  const { brand, meetingId, summaryMd, surveyUrl } = input;
  const to = brand.email ?? "";
  const subject = `[GloveK] ${brand.brand_name} 상담 감사드립니다`;
  const body = [
    `${brand.contact_name || brand.brand_name}님, 안녕하세요. GloveK입니다.`,
    ``,
    `오늘 미팅 감사드립니다. 논의된 내용을 아래와 같이 정리했습니다.`,
    ``,
    summaryMd,
    ``,
    surveyUrl ? `▶ 맞춤 제안을 위한 간단한 설문 부탁드립니다 (1분): ${surveyUrl}` : "",
    ``,
    `추가 문의는 회신 주시면 됩니다. 감사합니다.`,
  ].filter(Boolean).join("\n");

  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_drafts (brand_id, meeting_id, kind, to_email, subject, body_md, status)
     VALUES ($1,$2,'followup',$3,$4,$5,'draft') RETURNING id`,
    [brand.id, meetingId, to, subject, body]);
  await query("UPDATE meetings SET followup_status='drafted' WHERE id=$1", [meetingId]);
  return row!.id;
}

/** 미팅 요약 완료 시 자동 기록: contact_logged(meeting) + last_contact_at (08 §3-5). */
export async function recordMeetingContact(brandId: string, meetingId: string, at: string): Promise<void> {
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
     VALUES ($1,'zoom','contact_logged',$2,$3)`,
    [brandId, JSON.stringify({ channel: "meeting", meeting_id: meetingId }), at]);
  await query("UPDATE brands SET last_contact_at=$2 WHERE id=$1", [brandId, at]);
}

export interface MeetingRow {
  id: string; brand_id: string | null; zoom_uuid: string; topic: string;
  host_email: string | null; scheduled_at: string | null; started_at: string | null;
  status: string; followup_status: string; summary_md: string | null; created_at: string;
}
export function listMeetings(brandId: string): Promise<MeetingRow[]> {
  return query<MeetingRow>(
    "SELECT id, brand_id, zoom_uuid, topic, host_email, scheduled_at, started_at, status, followup_status, summary_md, created_at FROM meetings WHERE brand_id=$1 ORDER BY created_at DESC",
    [brandId]);
}
export function listUnmatchedMeetings(): Promise<MeetingRow[]> {
  return query<MeetingRow>(
    "SELECT id, brand_id, zoom_uuid, topic, host_email, scheduled_at, started_at, status, followup_status, summary_md, created_at FROM meetings WHERE status='unmatched' ORDER BY created_at DESC LIMIT 100");
}
