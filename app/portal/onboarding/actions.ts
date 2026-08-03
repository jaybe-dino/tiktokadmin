"use server";

// 포털 온보딩 화면 전용 서버액션 (v3.1 s-portal — 서류 "업로드" 버튼 배선).
//   brand_id 격리는 반드시 pq 경유 · 실물 파일은 자산 색인(assets)에 접수 기록,
//   담당 검토용 CS 티켓(channel='portal') 생성 → 어드민 승인 시 doc_items.done 처리.
import { revalidatePath } from "next/cache";
import { portalSession, pq } from "@/lib/portal-db";
import { query } from "@/lib/db";
import { createTicket } from "@/lib/cs";

export interface PortalDocResult {
  ok: boolean;
  error?: string;
}

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/** 서류 업로드 접수 — 미승인 항목만. 접수 즉시 자산 색인 + 담당 검토 티켓. */
export async function uploadDocAction(formData: FormData): Promise<PortalDocResult> {
  const s = await portalSession();
  if (!s) return { ok: false, error: "세션이 만료되었습니다. 다시 로그인해 주세요." };

  const itemKey = String(formData.get("item_key") ?? "").trim();
  const file = formData.get("file");
  if (!itemKey) return { ok: false, error: "서류 항목이 필요합니다." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일을 선택해 주세요." };
  if (file.size > MAX_SIZE) return { ok: false, error: "20MB 이하 파일만 업로드할 수 있습니다." };

  // 격리: 본인 브랜드의 서류 항목만.
  const item = (await pq<{ id: string; label: string; done: boolean }>(
    s.brand_id,
    "SELECT id::text, label, done FROM doc_items WHERE brand_id=$1 AND item_key=$2",
    [itemKey],
  ).catch(() => []))[0];
  if (!item) return { ok: false, error: "서류 항목을 찾을 수 없습니다." };
  if (item.done) return { ok: false, error: "이미 승인된 서류입니다." };

  // 자산 색인 등록 (source_ref 로 doc_item 연결 → 화면에서 '검토중' 표시)
  await query(
    `INSERT INTO assets (brand_id, kind, filename, mime, size_bytes, source, source_ref, uploaded_by)
     VALUES ($1,'doc',$2,$3,$4,'admin',$5,$6)`,
    [s.brand_id, file.name, file.type || null, file.size, `doc_item:${itemKey}`, `contact:${s.contact_id}`],
  ).catch(() => {
    throw new Error("업로드 접수에 실패했습니다.");
  });

  // 담당 검토 티켓 — 승인 시 어드민에서 doc_items.done 처리.
  await createTicket({
    brand_id: s.brand_id,
    channel: "portal",
    subject: `서류 제출: ${item.label}`,
    body: `브랜드가 포털에서 '${item.label}' 서류(${file.name})를 제출했습니다. 검토 후 승인 처리해 주세요.`,
  }).catch(() => {});

  revalidatePath("/portal/onboarding");
  return { ok: true };
}
