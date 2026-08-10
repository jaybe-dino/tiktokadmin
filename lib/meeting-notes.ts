// 회의록(직접 입력) — 텍스트 + 파일(DB bytea) 첨부. 브랜드360 회의록 탭.
import { query, queryOne } from "./db";

export interface MeetingNote {
  id: string; brand_id: string; note_date: string; title: string; body: string;
  file_url: string | null; file_name: string | null; file_mime: string | null;
  has_file: boolean; created_by: string | null; created_at: string;
}

/** 브랜드 회의록 목록(파일 바이트 제외 — has_file 로만). 날짜 내림차순. */
export function listMeetingNotes(brandId: string): Promise<MeetingNote[]> {
  return query<MeetingNote>(
    `SELECT id, brand_id, note_date, title, body, file_url, file_name, file_mime,
            (file_bytes IS NOT NULL) AS has_file, created_by, created_at
       FROM meeting_notes WHERE brand_id=$1
      ORDER BY note_date DESC, created_at DESC`,
    [brandId],
  ).catch(() => []);
}

export async function addMeetingNote(input: {
  brand_id: string; note_date?: string | null; title?: string; body?: string;
  file_url?: string | null; file_name?: string | null; file_mime?: string | null; file_bytes?: Buffer | null;
  created_by?: string | null;
}): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO meeting_notes (brand_id, note_date, title, body, file_url, file_name, file_mime, file_bytes, created_by)
     VALUES ($1, COALESCE($2::date, current_date), $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [input.brand_id, input.note_date || null, (input.title ?? "").trim(), (input.body ?? "").trim(),
     input.file_url || null, input.file_name || null, input.file_mime || null, input.file_bytes ?? null, input.created_by || null],
  ).catch(() => null);
  return row?.id ?? null;
}

export async function deleteMeetingNote(id: string): Promise<string | null> {
  const row = await queryOne<{ brand_id: string }>("DELETE FROM meeting_notes WHERE id=$1 RETURNING brand_id", [id]).catch(() => null);
  return row?.brand_id ?? null;
}

/** 파일 스트리밍용 — 바이트 포함. */
export function getMeetingNoteFile(id: string): Promise<{ file_name: string | null; file_mime: string | null; file_bytes: Buffer | null } | null> {
  return queryOne<{ file_name: string | null; file_mime: string | null; file_bytes: Buffer | null }>(
    "SELECT file_name, file_mime, file_bytes FROM meeting_notes WHERE id=$1", [id],
  ).catch(() => null);
}
