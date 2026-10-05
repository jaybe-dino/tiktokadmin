// 세미나 발송 시도 이력 — "실제로 보낸 내용"을 시도마다 남긴다.
//
//   규칙
//     · 내용 칸(subject·body·to_masked·channel·stage·attempt_no)은 insert 때 한 번만 쓴다.
//       나중에 바꾸는 것은 결과 칸(result·provider·provider_id·error·finished_at)뿐이다.
//     · 기록을 남기지 못하면 보내지 않는다 — beginAttempt 가 null 을 돌려주면 호출부가 멈춘다.
//     · 지난 발송을 소급 생성하지 않는다. 기록이 없는 건은 화면에서 "기록 없음"이다.
//     · 본문·제목을 로그(console)로 내보내지 않는다.
import { query, queryOne } from "./db";
import type { SeminarChannel, SeminarStage } from "./seminar-schedule";

export const SEMINAR_ATTEMPTS_MIGRATION = "0111_seminar_send_attempts.sql";

/** 기록 표와 선점 소유자 컬럼이 준비됐는지. 준비 안 됐으면 발송을 막는다(기록 없는 발송 금지). */
export async function attemptsSchemaState(): Promise<{ ready: boolean; error?: string }> {
  try {
    const t = await queryOne<{ reg: string | null }>(
      "SELECT to_regclass('public.seminar_send_attempts')::text AS reg");
    if (!t?.reg) {
      return { ready: false, error: `마이그레이션 ${SEMINAR_ATTEMPTS_MIGRATION} 미적용 — seminar_send_attempts 표가 없습니다.` };
    }
    const c = await queryOne<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='seminar_sends' AND column_name='claimed_by'`);
    if (!c) {
      return { ready: false, error: `마이그레이션 ${SEMINAR_ATTEMPTS_MIGRATION} 미적용 — seminar_sends.claimed_by 컬럼이 없습니다.` };
    }
    return { ready: true };
  } catch (e) {
    return { ready: false, error: `기록 표 확인 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

export interface BeginAttemptInput {
  sendId: string; sessionId: string; targetId: string; runId?: string | null;
  stage: SeminarStage; channel: SeminarChannel; attemptNo: number;
  toMasked: string; subject: string; body: string; purpose: string;
}

/**
 * 전송 "직전"에 보낼 내용을 남긴다. 성공하면 기록 id, 실패하면 null.
 *   null 이면 호출부는 전송하지 않아야 한다(기록 없는 발송을 만들지 않는다).
 *   같은 시도 번호가 이미 있으면 그 행을 그대로 쓴다(재실행에도 이력이 부풀지 않는다).
 */
export async function beginAttempt(i: BeginAttemptInput): Promise<string | null> {
  try {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO seminar_send_attempts
         (send_id, session_id, target_id, run_id, stage, channel, attempt_no,
          to_masked, subject, body, purpose)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (send_id, attempt_no) DO NOTHING
       RETURNING id::text AS id`,
      [i.sendId, i.sessionId, i.targetId, i.runId ?? null, i.stage, i.channel,
        Math.max(1, Math.floor(i.attemptNo)),
        i.toMasked.slice(0, 200), i.subject.slice(0, 500), i.body, i.purpose.slice(0, 20)]);
    if (r?.id) return r.id;
    // 같은 시도 번호가 이미 있으면 그 행에 결과를 채운다.
    const dup = await queryOne<{ id: string }>(
      "SELECT id::text AS id FROM seminar_send_attempts WHERE send_id=$1::uuid AND attempt_no=$2",
      [i.sendId, Math.max(1, Math.floor(i.attemptNo))]);
    return dup?.id ?? null;
  } catch {
    // 실패 사유에 본문이 섞일 수 있어 그대로 올리지 않는다. 호출부는 null 만 보고 멈춘다.
    return null;
  }
}

export interface AttemptOutcome {
  ok: boolean; provider?: string; providerId?: string; error?: string;
}

/** 전송이 끝난 뒤 결과 칸만 채운다. 내용 칸은 건드리지 않는다. */
export async function finishAttempt(id: string, o: AttemptOutcome): Promise<void> {
  await query(
    `UPDATE seminar_send_attempts
        SET result=$2, provider=$3, provider_id=$4, error=$5, finished_at=now()
      WHERE id=$1::uuid`,
    [id, o.ok ? "sent" : "failed", (o.provider ?? "").slice(0, 40),
      (o.providerId ?? "").slice(0, 200), (o.error ?? "").slice(0, 300)]).catch(() => {});
}

export interface AttemptRow {
  id: string; send_id: string; stage: string; channel: string; attempt_no: number;
  to_masked: string; subject: string; body: string; purpose: string;
  result: string; provider: string; provider_id: string; error: string;
  started_at: string; finished_at: string | null;
}
const ATTEMPT_COLS = `id::text AS id, send_id::text AS send_id, stage, channel, attempt_no,
  to_masked, subject, body, purpose, result, provider, provider_id, error,
  started_at::text AS started_at, finished_at::text AS finished_at`;

/** 예약 1건의 시도 이력(최신순). 기록이 없으면 빈 배열 — 지난 발송은 소급 생성하지 않는다. */
export async function listSendAttempts(sendId: string, limit = 20): Promise<AttemptRow[]> {
  return query<AttemptRow>(
    `SELECT ${ATTEMPT_COLS} FROM seminar_send_attempts
      WHERE send_id=$1::uuid ORDER BY attempt_no DESC LIMIT $2`, [sendId, limit]);
}

/** 회차 전체에서 기록이 있는 예약 id — 화면이 "기록 없음"을 구분하는 데 쓴다. */
export async function sendsWithAttempts(sessionId: string): Promise<Record<string, number>> {
  const rows = await query<{ send_id: string; n: string }>(
    `SELECT send_id::text AS send_id, count(*)::text AS n
       FROM seminar_send_attempts WHERE session_id=$1::uuid GROUP BY send_id`, [sessionId]);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.send_id] = Number(r.n);
  return out;
}
