import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/auth";
import { importApplications, parseDumpRows, storeImportFile } from "@/lib/tpartners-import";
import manifest from "@/data/tpartners-drive-manifest.json";

// apply.tpartners.live 자동 이관 — 서버가 공개 Drive 폴더에서 직접 내려받아 이관.
//   · 파일을 사람이 업로드할 필요 없음(140MB 브라우저 업로드 불필요).
//   · mode=rows : schema_and_data.sql 을 Drive에서 받아 신청행 이관(dry_run 지원).
//   · mode=files: 서류 파일을 offset/limit 배치로 내려받아 저장(SHA256 기록).
//   · 인증: 대표·파트장 세션 또는 CRON_SECRET 토큰.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MANIFEST = manifest as { sqlDriveId: string; files: { name: string; id: string }[] };

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = env.cronSecret;
  if (secret && (req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("token") === secret)) return true;
  const u = await currentUser().catch(() => null);
  return !!u && (u.role === "exec" || u.role === "lead");
}

/** 공개 Drive 파일 1개 내려받기. 대용량 바이러스검사 인터스티셜(HTML)도 폼 재제출로 통과. */
async function driveDownload(id: string): Promise<{ bytes: Buffer; mime: string }> {
  const base = "https://drive.usercontent.google.com/download";
  const first = `${base}?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  let r = await fetch(first, { redirect: "follow" });
  if (!r.ok) throw new Error(`Drive ${r.status}`);
  let ct = (r.headers.get("content-type") ?? "").toLowerCase();
  let buf = Buffer.from(await r.arrayBuffer());

  // 인터스티셜(HTML)이면 폼의 confirm/uuid 를 추출해 재요청.
  if (ct.includes("text/html")) {
    const html = buf.toString("utf8");
    const fields: Record<string, string> = {};
    const re = /name="([^"]+)"\s+value="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) fields[m[1]] = m[2];
    const params = new URLSearchParams({
      id: fields.id || id,
      export: fields.export || "download",
      confirm: fields.confirm || "t",
      ...(fields.uuid ? { uuid: fields.uuid } : {}),
      ...(fields.at ? { at: fields.at } : {}),
    });
    r = await fetch(`${base}?${params.toString()}`, { redirect: "follow" });
    if (!r.ok) throw new Error(`Drive(confirm) ${r.status}`);
    ct = (r.headers.get("content-type") ?? "").toLowerCase();
    buf = Buffer.from(await r.arrayBuffer());
    if (ct.includes("text/html")) throw new Error("Drive 인터스티셜 통과 실패(파일 공개 여부 확인)");
  }
  const mime = (ct.split(";")[0] || "application/octet-stream").trim();
  return { bytes: buf, mime };
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") ?? "rows";
  const dryRun = sp.get("dry_run") === "1" || sp.get("dry_run") === "true";

  // ── 신청행 이관 ──
  if (mode === "rows") {
    try {
      const { bytes } = await driveDownload(MANIFEST.sqlDriveId);
      const sql = bytes.toString("utf8");
      const apps = parseDumpRows(sql, "tiktok_shop_applications");
      if (apps.length === 0) return NextResponse.json({ ok: false, error: "SQL에서 tiktok_shop_applications 행을 찾지 못했습니다." }, { status: 422 });
      const report = await importApplications(apps, { dryRun });
      return NextResponse.json({ ok: true, report });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  // ── 서류 파일 배치 이관 ──
  if (mode === "files") {
    const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
    const limit = Math.min(30, Math.max(1, Number(sp.get("limit") ?? 12) || 12));
    const slice = MANIFEST.files.slice(offset, offset + limit);
    const results: { name: string; matched?: boolean; skipped?: string; error?: string }[] = [];
    let matched = 0, skipped = 0, failed = 0;

    for (const f of slice) {
      try {
        const { bytes, mime } = await driveDownload(f.id);
        const sha = createHash("sha256").update(bytes).digest("hex");
        const r = await storeImportFile({ filename: f.name, mime, bytes, sha256: sha });
        if (r.matched) { matched++; results.push({ name: f.name, matched: true }); }
        else { skipped++; results.push({ name: f.name, matched: false, skipped: r.skipped }); }
      } catch (e) {
        failed++; results.push({ name: f.name, error: (e as Error).message });
      }
    }

    const nextOffset = offset + slice.length;
    return NextResponse.json({
      ok: true, mode: "files",
      total: MANIFEST.files.length, offset, count: slice.length,
      matched, skipped, failed,
      next_offset: nextOffset < MANIFEST.files.length ? nextOffset : null,
      results,
    });
  }

  return NextResponse.json({ error: "mode 는 rows 또는 files" }, { status: 400 });
}

// 진행 상황·매니페스트 요약(GET) — UI 초기 표시용.
export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, files_total: MANIFEST.files.length, has_sql: Boolean(MANIFEST.sqlDriveId) });
}
