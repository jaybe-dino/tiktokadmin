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

/** 노쇼 감지 (08 §3-0-5): scheduled + 예약시각+24h 경과 + recording 미수신. */
export async function detectNoShows(): Promise<number> {
  const res = await query<{ id: string }>(
    `UPDATE meetings SET status='no_show'
      WHERE status='scheduled' AND scheduled_at IS NOT NULL
        AND scheduled_at < now() - interval '24 hours'
      RETURNING id`);
  return res.length;
}
