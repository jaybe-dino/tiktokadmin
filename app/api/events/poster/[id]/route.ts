// 포스터 이미지 서빙.
//   공개 허브용 — 게시된 행사의 "현재" 포스터만 내보낸다. 파일 id 를 알아도
//   초안 행사의 이미지는 나가지 않는다(관리자 세션이 있으면 미리보기로 허용).
import { NextRequest, NextResponse } from "next/server";
import { getPublicPoster, getAdminPoster } from "@/lib/seminar-events";
import { currentUser } from "@/lib/auth";
import { POSTER_MIMES, sniffImageMime } from "@/lib/seminar-events-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  let f = await getPublicPoster(id).catch(() => null);
  let isPublic = Boolean(f);
  if (!f) {
    // 초안 포스터는 관리자에게만.
    const admin = await currentUser().catch(() => null);
    if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });
    f = await getAdminPoster(id).catch(() => null);
    isPublic = false;
  }
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 저장된 MIME 을 그대로 믿지 않고 내용으로 한 번 더 확인한다(이미지 아닌 것이 섞여 나가지 않게).
  const bytes = Buffer.from(f.bytes);
  const sniffed = sniffImageMime(bytes.subarray(0, 16));
  const mime = sniffed ?? (POSTER_MIMES.includes(f.mime) ? f.mime : null);
  if (!mime) return NextResponse.json({ error: "not an image" }, { status: 415 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // 공개 포스터는 캐시해도 되지만 초안 미리보기는 캐시하지 않는다.
      "Cache-Control": isPublic ? "public, max-age=300" : "private, no-store",
    },
  });
}
