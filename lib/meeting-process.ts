// 미팅 후처리 워커 (08 §3-2~3-6) — 전사→요약→기록→팔로업.
//   외부 API 키가 없으면 각 단계를 건너뛰고 상태만 남긴다.
import Anthropic from "@anthropic-ai/sdk";
import { query, queryOne } from "./db";
import { env } from "./env";
import { createSurvey } from "./repo/card";
import { draftFollowup, recordMeetingContact, SUMMARY_FORMAT } from "./meetings";
import type { Brand } from "./types";

import { AI_MODEL } from "./ai";
const MODEL = AI_MODEL;

interface PendingMeeting {
  id: string; brand_id: string | null; topic: string; transcript: string | null;
  summary_md: string | null; status: string; started_at: string | null; recording_url: string | null;
}

/** 처리 대기 미팅 일괄 후처리. 반환: 처리 건수. */
export async function processMeetings(limit = 5): Promise<{ summarized: number; skipped: number }> {
  const rows = await query<PendingMeeting>(
    `SELECT id, brand_id, topic, transcript, summary_md, status, started_at, recording_url
       FROM meetings
      WHERE status IN ('received','transcribing','summarizing')
        AND summary_md IS NULL
      ORDER BY created_at ASC LIMIT $1`, [limit]);

  let summarized = 0, skipped = 0;
  for (const m of rows) {
    try {
      // 전사본 없으면 녹음 → Whisper STT 로 전사(키/녹음 있을 때). 없으면 스킵.
      let transcript = m.transcript;
      if (!transcript) {
        const { transcribeAudio, sttEnabled } = await import("./stt");
        if (!sttEnabled() || !m.recording_url) { skipped++; continue; }
        await query("UPDATE meetings SET status='transcribing' WHERE id=$1", [m.id]);
        transcript = await transcribeAudio(m.recording_url);
        if (!transcript) {
          await query("UPDATE meetings SET status='received' WHERE id=$1", [m.id]);
          skipped++; continue;
        }
        await query("UPDATE meetings SET transcript=$2, transcript_source='whisper' WHERE id=$1", [m.id, transcript]);
      }
      if (!env.anthropicKey) { skipped++; continue; }

      const summary = await summarize(transcript, m.topic);
      await query("UPDATE meetings SET summary_md=$2, status='ready' WHERE id=$1", [m.id, summary]);

      if (m.brand_id) {
        const brand = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [m.brand_id]);
        if (brand) {
          const at = m.started_at ?? new Date().toISOString();
          await recordMeetingContact(brand.id, m.id, at);
          // 설문 링크 생성 → 팔로업 초안에 포함
          let surveyUrl: string | undefined;
          try {
            const token = await createSurvey(brand.id);
            surveyUrl = `${env.adminUrl}/s/${token}`;
          } catch { /* 설문 테이블 미적용 방어 */ }
          await draftFollowup({ brand, meetingId: m.id, summaryMd: summary, surveyUrl });
        }
      }
      summarized++;
    } catch (e) {
      await query("UPDATE meetings SET status='error', error=$2 WHERE id=$1", [m.id, (e as Error).message]);
      skipped++;
    }
  }
  return { summarized, skipped };
}

async function summarize(transcript: string, topic: string): Promise<string> {
  const client = new Anthropic({ apiKey: env.anthropicKey });
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1200,
    system: `너는 GloveK 상담 회의록 작성자다. 아래 고정 포맷으로만 한국어 회의록을 작성한다. 개인정보(카드·신분증·비밀번호)는 절대 출력하지 않는다.\n\n${SUMMARY_FORMAT}`,
    messages: [{ role: "user", content: `미팅 주제: ${topic}\n\n전사:\n${transcript.slice(0, 40000)}` }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  return text.trim();
}

/** 노쇼 감지 (08 §3-0-5): scheduled + 예약시각+24h 경과 + recording 미수신.
 *  판정 시 후처리(영업 파트 기획 확정):
 *   · 브랜드별 재예약 안내 메일 초안(email_drafts, kind='followup') 생성 — 동일 kind draft 존재 시 스킵(멱등)
 *   · 노쇼 2회 이상 브랜드는 alerts(kind='noshow_repeat', tier 1) upsert
 */
export async function detectNoShows(): Promise<number> {
  const res = await query<{ id: string; brand_id: string | null }>(
    `UPDATE meetings SET status='no_show'
      WHERE status='scheduled' AND scheduled_at IS NOT NULL
        AND scheduled_at < now() - interval '24 hours'
      RETURNING id, brand_id`);

  const brandIds = [...new Set(res.map((r) => r.brand_id).filter((b): b is string => !!b))];
  for (const brandId of brandIds) {
    try {
      const brand = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [brandId]);
      if (!brand) continue;

      // 재예약 안내 초안 — 브랜드당 동일 kind 의 draft 가 이미 있으면 스킵(멱등).
      const dup = await queryOne<{ id: string }>(
        "SELECT id FROM email_drafts WHERE brand_id=$1 AND kind='followup' AND status='draft' LIMIT 1",
        [brandId]);
      if (!dup) {
        const subject = `[GloveK] ${brand.brand_name} 미팅 재예약 안내`;
        const body = [
          `${brand.contact_name || brand.brand_name}님, 안녕하세요. GloveK입니다.`,
          ``,
          `예정되었던 미팅이 진행되지 못한 것으로 확인되어 연락드립니다.`,
          `일정이 여의치 않으셨다면 편하신 시간대를 회신 주시면 미팅을 다시 잡아드리겠습니다.`,
          ``,
          `가능하신 날짜/시간 2~3개를 알려주시면 빠르게 재예약 도와드리겠습니다.`,
          ``,
          `감사합니다.`,
        ].join("\n");
        await query(
          `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status)
           VALUES ($1,'followup',$2,$3,$4,'draft')`,
          [brandId, brand.email ?? "", subject, body]);
      }

      // 2회 이상 노쇼 → 반복 노쇼 알림(브랜드당 kind 1행 upsert 패턴).
      const cnt = await queryOne<{ n: number }>(
        "SELECT count(*)::int AS n FROM meetings WHERE brand_id=$1 AND status='no_show'",
        [brandId]);
      if ((cnt?.n ?? 0) >= 2) {
        const { upsertAlert } = await import("./repo/alerts");
        await upsertAlert(brandId, "noshow_repeat", 1,
          `${brand.brand_name} · 미팅 노쇼 ${cnt!.n}회 — 재예약/이탈 검토`);
      }
    } catch { /* 후처리 실패는 노쇼 판정 자체에 영향 없음 */ }
  }
  return res.length;
}
