// 행사별 신청자 CSV(관리자 전용). 내부용이므로 연락처·메모까지 담는다.
//   외부 공유 링크의 CSV(/api/roster/<token>/export)와는 다른 경로다 —
//   그쪽은 기본 OFF 이고 노출 항목도 관리자가 고른 것만 나간다.
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getEvent, listRegistrations } from "@/lib/seminar-events";
import { csvDoc, fmtKstDateTime, REG_STATUS_LABEL, isRegStatus } from "@/lib/seminar-events-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["exec", "lead"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const u = await currentUser().catch(() => null);
  if (!u) return NextResponse.json({ error: "세션 만료" }, { status: 401 });
  if (!ADMIN_ROLES.has(u.role)) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const eventId = req.nextUrl.searchParams.get("eventId") ?? "";
  if (!UUID_RE.test(eventId)) return NextResponse.json({ error: "행사를 찾지 못했습니다." }, { status: 400 });
  const ev = await getEvent(eventId).catch(() => null);
  if (!ev) return NextResponse.json({ error: "행사를 찾지 못했습니다." }, { status: 404 });

  const includeTest = req.nextUrl.searchParams.get("test") === "1";
  // 페이지네이션은 화면용이고, 내려받기는 전체를 담는다.
  const rows = await collectAll(eventId, includeTest);

  const csv = csvDoc(
    ["신청일시(KST)", "회사명", "브랜드명", "담당자", "직함", "연락처", "이메일",
      "회사 사이트", "관심 국가", "문의", "상태", "개인정보동의", "마케팅동의", "담당", "내부메모", "검수용"],
    rows.map((r) => [
      fmtKstDateTime(r.created_at), r.company_name, r.brand_name, r.contact_name, r.contact_title,
      r.phone, r.email, r.site_url, r.countries, r.note,
      isRegStatus(r.status) ? REG_STATUS_LABEL[r.status] : r.status,
      r.privacy_agreed ? "동의" : "", r.marketing_agreed ? "동의" : "",
      r.owner_admin_id ?? "", r.admin_note, r.is_test ? "TEST" : "",
    ]),
  );
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sev-${ev.slug}-${today}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/** 전체 신청자를 페이지 단위로 모아 온다(한 번에 다 읽어 메모리를 키우지 않도록). */
async function collectAll(eventId: string, includeTest: boolean) {
  const pageSize = 200;
  const out: Awaited<ReturnType<typeof listRegistrations>>["rows"] = [];
  let page = 1;
  // 안전 상한 — 한 행사에서 2만 건을 넘기면 끊는다.
  for (; page <= 100; page++) {
    const r = await listRegistrations({ eventId, includeTest, page, pageSize });
    out.push(...r.rows);
    if (page >= r.pages || r.rows.length === 0) break;
  }
  return out;
}
