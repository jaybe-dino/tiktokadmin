"use server";

// 자산 저장소(assets) 화면 전용 서버액션.
//   원칙: 어드민 생성물만 실물 저장, 원본은 external_url 링크로 참조(복제 금지).
//   assets 테이블만 사용(migrations/0007_card_gaps.sql). @/app/actions.ts 는 수정하지 않음.
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export interface AssetActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const ALLOWED_KINDS = new Set([
  "proposal", "contract", "cert", "doc", "report", "meeting_rec", "brand_intro", "etc",
]);

/**
 * 드라이브/원본 링크를 색인에 등록(업로드 → 드라이브 저장).
 * 실물 복제 없이 external_url 참조만 저장 — 저장 원칙 준수.
 */
export async function registerAssetAction(input: {
  kind: string; filename: string; external_url: string;
}): Promise<AssetActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  const filename = input.filename?.trim();
  const url = input.external_url?.trim();
  if (!filename) return { ok: false, error: "파일명이 필요합니다." };
  if (!url) return { ok: false, error: "드라이브/원본 링크가 필요합니다." };

  const kind = ALLOWED_KINDS.has(input.kind) ? input.kind : "etc";

  const row = await queryOne<{ id: string }>(
    `INSERT INTO assets (kind, filename, external_url, source, uploaded_by)
     VALUES ($1,$2,$3,'drive',$4) RETURNING id`,
    [kind, filename, url, `admin:${u.id}`],
  );

  revalidatePath("/assets");
  return { ok: true, id: row?.id };
}

/**
 * 드라이브 동기화 — 색인을 DB에서 다시 읽어 최신 상태로 재색인.
 * (Google Drive 양방향 동기화의 어드민측 재색인 지점 · 현재 건수 반환)
 */
export async function syncAssetsAction(): Promise<AssetActionResult & { count?: number }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  const r = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM assets");
  revalidatePath("/assets");
  return { ok: true, count: Number(r?.n ?? 0) };
}
