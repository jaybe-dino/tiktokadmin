import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/auth";
import { storeImportFile } from "@/lib/tpartners-import";

// apply.tpartners.live 업로드 파일 1개 이관. 토큰 보호. multipart: file (+ 선택 sha256).
//   POST /api/admin/import-file?token=<CRON_SECRET>
//   → 파일명으로 브랜드·서류 매칭(먼저 import-tpartners 로 행 이관 필요) + 체크섬 검증.
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

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "multipart 필요" }, { status: 400 }); }
  const file = form.get("file");
  const expectSha = String(form.get("sha256") ?? "").trim().toLowerCase();
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) return NextResponse.json({ error: "file 필드 필요" }, { status: 400 });
  const f = file as File;
  const filename = String(form.get("filename") ?? f.name ?? "").trim();
  if (!filename) return NextResponse.json({ error: "filename 필요" }, { status: 400 });

  const bytes = Buffer.from(await f.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (expectSha && expectSha !== sha) {
    return NextResponse.json({ ok: false, error: `체크섬 불일치: expected ${expectSha}, got ${sha}` }, { status: 422 });
  }

  try {
    const r = await storeImportFile({ filename, mime: f.type || "application/octet-stream", bytes, sha256: sha });
    return NextResponse.json({ ...r, sha256: sha, filename });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
