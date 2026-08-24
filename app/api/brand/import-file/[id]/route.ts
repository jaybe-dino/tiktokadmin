import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getImportFile } from "@/lib/tpartners-import";
import { contentDisposition } from "@/lib/filename";

// 이관된 서류 스트리밍(브랜드360에서 열람). 어드민 세션 필요.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const f = await getImportFile(id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "content-type": f.mime || "application/octet-stream",
      "content-disposition": contentDisposition(f.filename, "inline"),
      "cache-control": "private, max-age=300",
    },
  });
}
