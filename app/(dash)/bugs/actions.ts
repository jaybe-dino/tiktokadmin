"use server";
// 기능오류 제보 액션 — 제출(스크린샷+설명+컨텍스트) / 관리(상태·개발메모·삭제).
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { createBugReport, updateBugReport, deleteBugReport } from "@/lib/bug-reports";
import { queryOne } from "@/lib/db";
import { slackPostDM } from "@/lib/slack";

// 해결완료로 전이 시 제보 작성자에게 슬랙 DM(작성자 id=이메일). 실패해도 무시(비차단).
async function notifyReporterResolved(id: string, resolvedBy: string): Promise<void> {
  const r = await queryOne<{ reporter: string | null; ticket_no: number | null; description: string; url: string | null; dev_note: string | null }>(
    "SELECT reporter, ticket_no, description, url, dev_note FROM bug_reports WHERE id=$1", [id],
  ).catch(() => null);
  if (!r?.reporter || !r.reporter.includes("@")) return;
  const ticket = r.ticket_no != null ? `BUG-${r.ticket_no}` : `BUG-${id.slice(0, 6)}`;
  const desc = (r.description || "").replace(/\s+/g, " ").slice(0, 300);
  const lines = [
    `✅ *[${ticket}] 개발 완료* — 제보하신 기능오류가 처리되었습니다.`,
    `> ${desc}`,
    r.dev_note ? `• 처리 내용: ${r.dev_note.slice(0, 500)}` : "",
    r.url ? `• 화면: ${r.url}` : "",
    `• 처리: ${resolvedBy}`,
    `배포 반영 후 확인해 주세요. 이상 있으면 다시 제보해 주세요 🙏`,
  ].filter(Boolean);
  await slackPostDM(r.reporter, { text: lines.join("\n") }).catch(() => {});
}

export async function submitBugReportAction(fd: FormData): Promise<{ ok: boolean; error?: string; ticket?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const description = String(fd.get("description") ?? "").trim();
  if (!description) return { ok: false, error: "오류 내용을 입력하세요." };

  const url = String(fd.get("url") ?? "").slice(0, 2000) || undefined;
  const userAgent = String(fd.get("user_agent") ?? "").slice(0, 1000) || undefined;
  const viewport = String(fd.get("viewport") ?? "").slice(0, 40) || undefined;
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(String(fd.get("meta") ?? "{}")); } catch { meta = {}; }

  // 스크린샷(선택) — 5MB 제한, 이미지 MIME 만.
  let image: { bytes: Buffer; mime: string } | null = null;
  const file = fd.get("image");
  if (file && typeof file === "object" && "arrayBuffer" in file) {
    const f = file as File;
    if (f.size > 0) {
      if (!/^image\//.test(f.type)) return { ok: false, error: "이미지 파일만 첨부할 수 있습니다." };
      if (f.size > 5 * 1024 * 1024) return { ok: false, error: "이미지는 5MB 이하만 첨부할 수 있습니다." };
      image = { bytes: Buffer.from(await f.arrayBuffer()), mime: f.type };
    }
  }

  let ticketNo: number | null = null;
  try {
    const r = await createBugReport({ url, description, reporter: u.id, userAgent, viewport, meta, image });
    ticketNo = r.ticketNo;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/bug_reports|does not exist/i.test(msg)) return { ok: false, error: "제보 테이블이 없습니다 — 마이그레이션(0058) 적용 필요." };
    return { ok: false, error: "제보 저장 실패" };
  }
  revalidatePath("/bugs");
  return { ok: true, ticket: ticketNo != null ? `BUG-${ticketNo}` : undefined };
}

export async function updateBugReportAction(id: string, patch: { status?: string; dev_note?: string }): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  // 해결완료로 '전이'할 때만 알림(이미 해결 상태면 중복 알림 방지).
  const before = patch.status === "resolved"
    ? await queryOne<{ status: string }>("SELECT status FROM bug_reports WHERE id=$1", [id]).catch(() => null)
    : null;
  await updateBugReport(id, patch);
  if (patch.status === "resolved" && before?.status !== "resolved") {
    await notifyReporterResolved(id, u.name || u.id);
  }
  revalidatePath("/bugs");
  return { ok: true };
}

export async function deleteBugReportAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  await deleteBugReport(id);
  revalidatePath("/bugs");
  return { ok: true };
}
