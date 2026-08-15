import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/auth";
import { importApplications, parseDumpRows } from "@/lib/tpartners-import";

// apply.tpartners.live 신청 행 이관. 대표·파트장 세션 또는 CRON_SECRET 토큰. dry_run=1 이면 쓰기 없음.
//   ① UI: multipart 로 schema_and_data.sql 업로드(file 필드) → 서버가 파싱
//   ② 스크립트: JSON { applications:[...] } (token)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = env.cronSecret;
  if (secret && (req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("token") === secret)) return true;
  const u = await currentUser().catch(() => null);
  return !!u && (u.role === "exec" || u.role === "lead");
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1" || req.nextUrl.searchParams.get("dry_run") === "true";
  const ct = req.headers.get("content-type") ?? "";

  let apps: Record<string, unknown>[] | null = null;
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof file === "object" && "text" in file) {
        const sql = await (file as File).text();
        apps = parseDumpRows(sql, "tiktok_shop_applications");
      }
    } else {
      const body = await req.json();
      if (Array.isArray(body.applications)) apps = body.applications;
    }
  } catch (e) {
    return NextResponse.json({ error: `파싱 오류: ${(e as Error).message}` }, { status: 400 });
  }
  if (!apps) return NextResponse.json({ error: "schema_and_data.sql(file) 또는 applications 배열이 필요합니다." }, { status: 400 });

  try {
    const report = await importApplications(apps, { dryRun });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
