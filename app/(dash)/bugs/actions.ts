"use server";
// 기능오류 제보 액션 — 제출(스크린샷+설명+컨텍스트) / 관리(상태·개발메모·삭제).
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { createBugReport, updateBugReport, deleteBugReport } from "@/lib/bug-reports";

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
  await updateBugReport(id, patch);
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
