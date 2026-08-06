// 설문 문항 뱅크(DB) 서버 계층 — survey.ts(순수 상수)와 분리(여긴 DB 의존).
//   렌더/발송은 getQuestions(kind) 로 DB 문항을 읽고, 비어 있으면 상수로 폴백(미이관 DB 안전).
import { query, queryOne } from "./db";
import { questionsForKind, type SurveyQuestion } from "./survey";

export interface SurveyQuestionRow extends SurveyQuestion {
  id: string;
  kind: string;
  sort_order: number;
  active: boolean;
}

interface DbRow {
  id: string; kind: string; section: string | null; qkey: string; label: string;
  qtype: SurveyQuestion["type"]; options: string[] | null; placeholder: string | null;
  sort_order: number; active: boolean;
}

function toQuestion(r: DbRow): SurveyQuestionRow {
  return {
    id: r.id, kind: r.kind, key: r.qkey, label: r.label, type: r.qtype,
    options: r.options ?? [], placeholder: r.placeholder ?? undefined,
    section: r.section ?? undefined, sort_order: r.sort_order, active: r.active,
  };
}

/** 렌더/발송용 — 활성 문항만, 정렬순. DB 비어있으면 상수 폴백. */
export async function getQuestions(kind: string): Promise<SurveyQuestion[]> {
  const rows = await query<DbRow>(
    `SELECT id, kind, section, qkey, label, qtype, options, placeholder, sort_order, active
       FROM survey_questions WHERE kind=$1 AND active ORDER BY sort_order, label`,
    [kind],
  ).catch(() => [] as DbRow[]);
  if (rows.length === 0) return questionsForKind(kind); // 미이관/조회실패 시 폴백
  return rows.map(toQuestion);
}

/** 어드민 편집용 — 비활성 포함 전체. */
export async function listQuestions(kind: string): Promise<SurveyQuestionRow[]> {
  const rows = await query<DbRow>(
    `SELECT id, kind, section, qkey, label, qtype, options, placeholder, sort_order, active
       FROM survey_questions WHERE kind=$1 ORDER BY sort_order, label`,
    [kind],
  ).catch(() => [] as DbRow[]);
  return rows.map(toQuestion);
}

export interface QuestionInput {
  id?: string; kind: string; section?: string; qkey: string; label: string;
  type: SurveyQuestion["type"]; options?: string[]; placeholder?: string;
  sort_order?: number; active?: boolean;
}

/** 문항 추가/수정. qkey 는 kind 내 유니크(응답 저장 키). */
export async function upsertQuestion(input: QuestionInput): Promise<{ id: string }> {
  const opts = JSON.stringify(input.options ?? []);
  if (input.id) {
    const row = await queryOne<{ id: string }>(
      `UPDATE survey_questions SET section=$2, qkey=$3, label=$4, qtype=$5, options=$6::jsonb,
         placeholder=$7, sort_order=$8, active=$9, updated_at=now() WHERE id=$1 RETURNING id`,
      [input.id, input.section ?? null, input.qkey.trim(), input.label.trim(), input.type, opts,
       input.placeholder ?? null, input.sort_order ?? 0, input.active ?? true],
    );
    if (!row) throw new Error("문항을 찾을 수 없습니다.");
    return row;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO survey_questions (kind, section, qkey, label, qtype, options, placeholder, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     ON CONFLICT (kind, qkey) DO UPDATE SET section=EXCLUDED.section, label=EXCLUDED.label,
       qtype=EXCLUDED.qtype, options=EXCLUDED.options, placeholder=EXCLUDED.placeholder,
       sort_order=EXCLUDED.sort_order, active=EXCLUDED.active, updated_at=now()
     RETURNING id`,
    [input.kind, input.section ?? null, input.qkey.trim(), input.label.trim(), input.type, opts,
     input.placeholder ?? null, input.sort_order ?? 0, input.active ?? true],
  );
  if (!row) throw new Error("문항 저장 실패");
  return row;
}

export async function deleteQuestion(id: string): Promise<void> {
  await query("DELETE FROM survey_questions WHERE id=$1", [id]);
}

/** 순서 일괄 저장(id → sort_order). */
export async function reorderQuestions(orders: { id: string; sort_order: number }[]): Promise<void> {
  for (const o of orders) {
    await query("UPDATE survey_questions SET sort_order=$2, updated_at=now() WHERE id=$1", [o.id, o.sort_order]).catch(() => {});
  }
}
