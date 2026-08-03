"use server";

// 리드 가져오기 화면 전용 서버액션 (v3.1).
//   @/app/actions.ts 는 수정 금지 → 이 화면의 신규 버튼용 액션은 여기서 정의.
//   등록·병합은 기존 게이트/라이브러리 그대로 재사용:
//     · 수동 등록: @/app/actions(createBrandAction) — 중복 판정·병합·웰컴 게이트 경유
//     · CSV: lib/csv(parseCsv) + lib/field-detect(detectImportRecord) + lib/import(importBrandRecord)
//     · 사전분석 초안: lib/brief(buildBriefMarkdown) — brief_md 미생성 시 규칙 기반 draft

import { revalidatePath } from "next/cache";
import { createBrandAction } from "@/app/actions";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export interface CsvImportSummary {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** CSV 반영 — 기본 유입 경로·리드 그룹을 지정해 일괄 등록(중복은 병합). */
export async function importCsvAction(
  csvText: string,
  defaultSource?: string,
  leadGroup?: string,
): Promise<CsvImportSummary> {
  const u = await currentUser();
  if (!u) return { ok: false, created: 0, updated: 0, skipped: 0, errors: ["세션 만료"] };

  const { parseCsv } = await import("@/lib/csv");
  const { detectImportRecord } = await import("@/lib/field-detect");
  const { importBrandRecord } = await import("@/lib/import");

  const rows = parseCsv(csvText);
  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];
  const ids: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rec = detectImportRecord(rows[i]);
    if (!rec.source && defaultSource) rec.source = defaultSource;
    const res = await importBrandRecord(`admin:${u.id}`, rec);
    if (res.ok) {
      if (res.created) created++;
      else updated++;
      if (res.brand_id) ids.push(res.brand_id);
    } else {
      skipped++;
      if (errors.length < 10) errors.push(`행 ${i + 2}: ${res.error}`);
    }
  }

  const group = (leadGroup ?? "").trim();
  if (group && ids.length) {
    await query(
      `UPDATE brands SET lead_group=$1, updated_at=now() WHERE id = ANY($2::uuid[])`,
      [group, ids],
    ).catch(() => {});
  }

  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/send");
  return { ok: true, created, updated, skipped, errors };
}

export interface RegisterLeadResult {
  ok: boolean;
  error?: string;
  brand_id?: string;
  briefed?: boolean;
}

/** 수동 등록 — 등록 → 사전분석 실행. 중복 판정 키(이메일/전화) 하나만 받아 병합 게이트 경유. */
export async function registerLeadAction(input: {
  brand_name: string;
  contact: string; // 이메일 또는 전화 (중복 판정 키)
  contact_name?: string;
  source: string;
  lead_group?: string;
  memo?: string;
  state?: string;
  grade?: string;
  plan?: string;
  contract_type?: string;
}): Promise<RegisterLeadResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  const contact = (input.contact ?? "").trim();
  const email = contact.includes("@") ? contact : undefined;
  const phone = !email && /\d{7,}/.test(contact.replace(/\D/g, "")) ? contact : undefined;
  if (!email && !phone) return { ok: false, error: "이메일 또는 전화 형식을 확인하세요 (중복 판정 키)" };

  // 기존 서버액션 재사용 — 중복 판정 → 원장 1행 병합 → (신규 시) 웰컴 자동 안내
  const res = await createBrandAction({
    brand_name: input.brand_name,
    email,
    phone,
    contact_name: input.contact_name || undefined,
    source: input.source || "etc",
    memo: input.memo || undefined,
    state: input.state || undefined,
    grade: input.grade || undefined,
    plan: input.plan || undefined,
    contract_type: input.contract_type || undefined,
  });
  if (!res.ok || !res.brand_id) return { ok: false, error: res.error || "등록 실패" };

  const group = (input.lead_group ?? "").trim();
  if (group) {
    await query(
      `UPDATE brands SET lead_group=$1, updated_at=now() WHERE id=$2`,
      [group, res.brand_id],
    ).catch(() => {});
  }

  // 사전분석 실행 — 브리프 미생성 시 규칙 기반 초안 생성(정식 진단 전 draft)
  let briefed = false;
  const b = await queryOne<{
    brand_name: string; category: string | null; countries: string[] | null;
    grade: string | null; rec_track: string | null; state: string; brief_md: string | null;
  }>(
    `SELECT brand_name, category, countries, grade, rec_track, state, brief_md FROM brands WHERE id=$1`,
    [res.brand_id],
  ).catch(() => null);
  if (b && !b.brief_md) {
    const { buildBriefMarkdown } = await import("@/lib/brief");
    const { setFields } = await import("@/lib/repo/brands");
    const brief = buildBriefMarkdown({
      brandName: b.brand_name,
      category: b.category ?? "",
      countries: b.countries ?? [],
      grade: b.grade,
      recTrack: b.rec_track,
      state: b.state,
    });
    await setFields(res.brand_id, { brief_md: brief }).catch(() => {});
    briefed = true;
  }

  revalidatePath("/");
  revalidatePath("/import");
  return { ok: true, brand_id: res.brand_id, briefed };
}
