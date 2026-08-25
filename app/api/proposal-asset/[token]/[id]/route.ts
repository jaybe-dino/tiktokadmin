// 제안서 공개 이미지 프록시 — 제안서 토큰(비공개 링크)을 아는 열람자에게만,
//   그 제안서 브랜드에 속한 "이미지 파일"을 세션 없이 스트리밍한다.
//   (로고·제품 이미지가 세션 보호 경로(import_files/onb_files)에 저장돼 공개 제안서에서 깨지던 문제)
//   안전장치: ① 토큰 → 제안서(운영/마케팅) → brand_id 검증 ② 파일의 브랜드 일치 확인 ③ image/* MIME 만 허용.
import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function brandIdForToken(token: string): Promise<string | null> {
  // 운영 제안서 → 마케팅 제안서 순으로 조회(토큰 네임스페이스가 달라 충돌 없음).
  const ops = await queryOne<{ brand_id: string | null }>(
    "SELECT brand_id FROM proposal_docs WHERE token=$1", [token]).catch(() => null);
  if (ops) return ops.brand_id;
  const mkt = await queryOne<{ brand_id: string | null }>(
    "SELECT brand_id FROM mkt_proposal_docs WHERE token=$1", [token]).catch(() => null);
  return mkt ? mkt.brand_id : null;
}

interface FileRow { filename: string; mime: string | null; bytes: Buffer; brand_id: string | null }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  if (!UUID_RE.test(id) || !token || token.length > 80) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const brandId = await brandIdForToken(token);
  if (!brandId) return NextResponse.json({ error: "not found" }, { status: 404 });

  // ① 브랜드 원장 파일(import_files) → ② 온보딩 신청 파일(onb_files, 신청서/고객계정 양쪽 brand_id 매칭).
  let f = await queryOne<FileRow>(
    "SELECT filename, mime, bytes, brand_id FROM import_files WHERE id=$1", [id]).catch(() => null);
  if (!f) {
    f = await queryOne<FileRow>(
      `SELECT f.filename, f.mime, f.bytes, COALESCE(a.brand_id, cu.brand_id) AS brand_id
         FROM onb_files f
         JOIN onb_applications a ON a.id = f.application_id
         LEFT JOIN onb_customers cu ON cu.id = a.customer_id
        WHERE f.id=$1`, [id]).catch(() => null);
  }
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!f.brand_id || f.brand_id !== brandId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const mime = f.mime || "application/octet-stream";
  // 이미지 외 파일(계약서 PDF·KYC 문서 등)은 이 공개 경로로 절대 서빙하지 않는다.
  if (!mime.startsWith("image/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.filename)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
