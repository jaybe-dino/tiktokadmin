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
import { query } from "@/lib/db";

export interface CsvImportSummary {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  /** 등록 직후 실행한 1차 분석 건수(AI 또는 규칙기반) */
  aiAnalyzed?: number;
  /** 즉시 처리 한도(5건) 초과분 — pre_analysis 에이전트가 처리 */
  aiPending?: number;
  /** ANTHROPIC 키 존재 → AI 분석 여부 (false 면 규칙기반) */
  aiUsed?: boolean;
}

/**
 * 등록 직후 1차 AI 분석(§8 리드 CSV 확정) — brief_md 없는 브랜드만 대상.
 *   · aiEnabled() → aiText 로 기본정보(브랜드명·카테고리·URL·소스) 기반 시장조사 브리프
 *   · 키 없거나 AI 실패 → 기존 규칙기반 buildBriefMarkdown 재사용
 *   · 동기 지연 방지: 최대 limit(기본 5)건만 즉시 — 나머지는 pre_analysis 에이전트가 처리
 */
async function runInitialBriefs(
  brandIds: string[],
  limit = 5,
): Promise<{ analyzed: number; pending: number; ai: boolean }> {
  if (!brandIds.length) return { analyzed: 0, pending: 0, ai: false };
  const { aiEnabled, aiText } = await import("@/lib/ai");
  const rows = await query<{
    id: string; brand_name: string; category: string | null; brand_url: string | null;
    source: string; countries: string[] | null; grade: string | null;
    rec_track: string | null; state: string;
  }>(
    `SELECT id, brand_name, category, brand_url, source, countries, grade, rec_track, state
       FROM brands
      WHERE id = ANY($1::uuid[]) AND (brief_md IS NULL OR brief_md='')`,
    [brandIds],
  ).catch(() => []);

  const targets = rows.slice(0, limit);
  const pending = rows.length - targets.length;
  const useAi = aiEnabled();
  let analyzed = 0;

  for (const b of targets) {
    let brief: string | null = null;
    if (useAi) {
      brief = await aiText({
        system:
          "너는 GloveK 시장조사 분석가다. 최소 기본정보만으로 브랜드 1차 시장조사 브리프를 " +
          "한국어 마크다운 8줄 이내로 작성한다. 구성: 브랜드 개요 가설 · 카테고리 시장성(틱톡숍·해외) · " +
          "예상 강점 · 리스크 · 미팅 확인질문 3개. 사실 확인 전 추정임을 명시하고 과장 금지.",
        user:
          `브랜드명: ${b.brand_name}\n카테고리: ${b.category || "미상"}\n` +
          `URL: ${b.brand_url || "없음"}\n유입 소스: ${b.source}`,
        maxTokens: 700,
      }).catch(() => null);
    }
    if (!brief) {
      // 키 없음/실패 → 기존 규칙기반 브리프 재사용
      const { buildBriefMarkdown } = await import("@/lib/brief");
      brief = buildBriefMarkdown({
        brandName: b.brand_name,
        category: b.category ?? "",
        countries: b.countries ?? [],
        grade: b.grade,
        recTrack: b.rec_track,
        state: b.state,
      });
    }
    await query(
      `UPDATE brands SET brief_md=$2, updated_at=now()
        WHERE id=$1 AND (brief_md IS NULL OR brief_md='')`,
      [b.id, brief],
    ).catch(() => {});
    analyzed++;
  }
  return { analyzed, pending, ai: useAi };
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
  const createdIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rec = detectImportRecord(rows[i]);
    if (!rec.source && defaultSource) rec.source = defaultSource;
    const res = await importBrandRecord(`admin:${u.id}`, rec);
    if (res.ok) {
      if (res.created) created++;
      else updated++;
      if (res.brand_id) {
        ids.push(res.brand_id);
        if (res.created) createdIds.push(res.brand_id);
      }
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

  // 신규 생성 브랜드 1차 AI 분석 — 최대 5건 즉시, 초과분은 pre_analysis 에이전트가 처리
  const brief = await runInitialBriefs(createdIds, 5);

  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/send");
  return {
    ok: true, created, updated, skipped, errors,
    aiAnalyzed: brief.analyzed, aiPending: brief.pending, aiUsed: brief.ai,
  };
}

export interface RegisterLeadResult {
  ok: boolean;
  error?: string;
  brand_id?: string;
  briefed?: boolean;
  /** true=AI 1차 분석, false=규칙기반 브리프 */
  ai?: boolean;
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

  // 1차 분석 — brief_md 미생성 시 AI(키 있으면) 또는 규칙기반 브리프 생성
  const brief = await runInitialBriefs([res.brand_id], 1);

  revalidatePath("/");
  revalidatePath("/import");
  return { ok: true, brand_id: res.brand_id, briefed: brief.analyzed > 0, ai: brief.ai };
}
