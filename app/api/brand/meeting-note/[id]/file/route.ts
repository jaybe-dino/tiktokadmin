import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getMeetingNoteFile } from "@/lib/meeting-notes";
import { contentDisposition } from "@/lib/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 회의록 첨부파일 스트리밍 — 관리자(glovek_admin)만.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await currentUser().catch(() => null);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const f = await getMeetingNoteFile(id);
  if (!f || !f.file_bytes) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(f.file_bytes), {
    headers: {
      "Content-Type": f.file_mime || "application/octet-stream",
      "Content-Disposition": contentDisposition(f.file_name || "meeting-note", "inline"),
      "Cache-Control": "private, no-store",
    },
  });
}
