// 기능오류 제보 저장·조회. 이미지(스크린샷)는 bytea, 스트리밍은 /api/bug-report/[id]/image.
import { query, queryOne } from "./db";
export { BUG_STATUS } from "./bug-status";

export interface BugReportRow {
  id: string; url: string | null; description: string; reporter: string | null;
  user_agent: string | null; viewport: string | null; meta: Record<string, unknown>;
  has_image: boolean; status: string; dev_note: string; created_at: string;
}

export async function createBugReport(input: {
  url?: string; description: string; reporter?: string | null;
  userAgent?: string; viewport?: string; meta?: Record<string, unknown>;
  image?: { bytes: Buffer; mime: string } | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO bug_reports (url, description, reporter, user_agent, viewport, meta, image, image_mime)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      input.url ?? null, input.description, input.reporter ?? null,
      input.userAgent ?? null, input.viewport ?? null, JSON.stringify(input.meta ?? {}),
      input.image?.bytes ?? null, input.image?.mime ?? null,
    ],
  );
  return row!.id;
}

export async function listBugReports(status?: string): Promise<BugReportRow[]> {
  const where = status && status !== "all" ? "WHERE status=$1" : "";
  const params = status && status !== "all" ? [status] : [];
  return query<BugReportRow>(
    `SELECT id, url, description, reporter, user_agent, viewport, meta,
            (image IS NOT NULL) AS has_image, status, dev_note, created_at
       FROM bug_reports ${where} ORDER BY created_at DESC LIMIT 500`,
    params,
  ).catch(() => []);
}

export async function getBugReportImage(id: string): Promise<{ bytes: Buffer; mime: string | null } | null> {
  const r = await queryOne<{ image: Buffer | null; image_mime: string | null }>(
    "SELECT image, image_mime FROM bug_reports WHERE id=$1", [id],
  ).catch(() => null);
  if (!r?.image) return null;
  return { bytes: r.image, mime: r.image_mime };
}

export async function updateBugReport(id: string, patch: { status?: string; dev_note?: string }): Promise<void> {
  await query(
    `UPDATE bug_reports SET status=COALESCE($2,status), dev_note=COALESCE($3,dev_note), updated_at=now() WHERE id=$1`,
    [id, patch.status ?? null, patch.dev_note ?? null],
  );
}

export async function deleteBugReport(id: string): Promise<void> {
  await query("DELETE FROM bug_reports WHERE id=$1", [id]);
}
