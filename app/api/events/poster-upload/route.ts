// 포스터 업로드(관리자 전용). 이미지 내용까지 확인한 뒤 DB 에 저장하고 행사에 연결한다.
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { savePoster } from "@/lib/seminar-events";
import { posterError, sniffImageMime, POSTER_MAX_BYTES } from "@/lib/seminar-events-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADMIN_ROLES = new Set(["exec", "lead"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const u = await currentUser().catch(() => null);
  if (!u) return NextResponse.json({ ok: false, error: "세션이 만료되었습니다." }, { status: 401 });
  if (!ADMIN_ROLES.has(u.role)) {
    return NextResponse.json({ ok: false, error: "대표·파트장만 포스터를 올릴 수 있습니다." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const eventId = String(form?.get("eventId") ?? "");
  const file = form?.get("file");
  if (!UUID_RE.test(eventId)) return NextResponse.json({ ok: false, error: "행사를 찾지 못했습니다." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "파일이 없습니다." }, { status: 400 });
  if (file.size > POSTER_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "포스터는 8MB 이하만 올릴 수 있습니다." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const bad = posterError(file.name || "", bytes.length, bytes.subarray(0, 16));
  if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400 });
  const mime = sniffImageMime(bytes.subarray(0, 16));
  if (!mime) return NextResponse.json({ ok: false, error: "이미지 파일이 아닙니다." }, { status: 400 });

  const r = await savePoster(eventId, file.name || "poster", mime, bytes, u.id);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "저장 실패" }, { status: 500 });
  return NextResponse.json({ ok: true, fileId: r.fileId });
}
