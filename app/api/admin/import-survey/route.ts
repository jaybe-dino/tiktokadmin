import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/auth";
import { importSurveyCsv } from "@/lib/survey-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 설문 CSV 이관 — 응답행을 브랜드에 매칭해 surveys.answers 로 저장.
//   POST (multipart: file=CSV) ?dry_run=1  또는  JSON { csv: "..." }
//   인증: 대표·파트장 세션 또는 CRON_SECRET.

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = env.cronSecret;
  if (secret && (req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("token") === secret)) return true;
  const u = await currentUser().catch(() => null);
  return !!u && (u.role === "exec" || u.role === "lead");
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1" || req.nextUrl.searchParams.get("dry_run") === "true";
  try {
    let csv = "";
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const f = fd.get("file");
      if (!f || typeof f === "string") return NextResponse.json({ ok: false, error: "CSV 파일이 필요합니다." }, { status: 400 });
      csv = await (f as File).text();
    } else {
      const body = await req.json().catch(() => ({}));
      csv = String(body.csv ?? "");
    }
    if (!csv.trim()) return NextResponse.json({ ok: false, error: "빈 CSV 입니다." }, { status: 400 });
    const report = await importSurveyCsv(csv, { dryRun });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
