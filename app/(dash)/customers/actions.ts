"use server";

import { query } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  PLAN_LABELS, PAY_STATUS_LABELS, SOURCE_LABELS, STATE_LABELS,
  type Plan, type PayStatus, type State,
} from "@/lib/types";

// customers 화면 전용 서버액션 (@/app/actions.ts 는 수정 금지 → 별도 파일).

export interface CsvExportResult {
  ok: boolean;
  error?: string;
  csv?: string;
  filename?: string;
  count?: number;
}

interface CsvFilter {
  q?: string; state?: string; source?: string; grade?: string;
  plan?: string; owner?: string; breach?: string;
}

// CSV 셀 이스케이프 (콤마·따옴표·개행 안전).
function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 현재 검색·필터 조건에 맞는 브랜드 원장을 CSV 문자열로 반환.
 * 페이지 목록(customersList)과 동일한 조건을 DB 레벨에서 재현하되,
 * 페이지네이션 없이 전체 매칭 행을 내보낸다(존재하는 brands 컬럼만 사용).
 */
export async function exportCustomersCsvAction(f: CsvFilter): Promise<CsvExportResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  const where: string[] = ["1=1"];
  const p: unknown[] = [];
  if (f.q) {
    p.push(`%${f.q}%`);
    where.push(`(b.brand_name ILIKE $${p.length} OR b.email ILIKE $${p.length} OR b.phone ILIKE $${p.length})`);
  }
  if (f.state) { p.push(f.state); where.push(`b.state=$${p.length}`); }
  if (f.source) { p.push(f.source); where.push(`b.source=$${p.length}`); }
  if (f.grade) { p.push(f.grade); where.push(`b.grade=$${p.length}`); }
  if (f.plan) { p.push(f.plan); where.push(`b.plan=$${p.length}`); }
  if (f.owner) {
    p.push(f.owner);
    where.push(`($${p.length} IN (b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads))`);
  }
  if (f.breach === "1") {
    where.push(`EXISTS(SELECT 1 FROM alerts a WHERE a.brand_id=b.id AND a.kind='sla_breach' AND a.resolved_at IS NULL)`);
  }

  const rows = await query<{
    brand_name: string; brand_name_en: string | null; state: State;
    grade: string | null; plan: Plan | null; pay_status: PayStatus;
    source: string; countries: string[] | null; email: string | null; phone: string | null;
    category: string | null; brand_url: string | null;
    owner_sales: string | null; owner_onboard: string | null;
    last_contact_at: string | null; next_action: string | null; created_at: string;
  }>(
    `SELECT b.brand_name, b.brand_name_en, b.state, b.grade, b.plan, b.pay_status,
            b.source, b.countries, b.email, b.phone, b.category, b.brand_url,
            b.owner_sales, b.owner_onboard, b.last_contact_at, b.next_action, b.created_at
       FROM brands b
      WHERE ${where.join(" AND ")}
      ORDER BY b.updated_at DESC`,
    p,
  );

  const header = [
    "브랜드", "영문명", "상태", "등급", "플랜", "결제상태", "유입", "국가",
    "이메일", "전화", "카테고리", "URL", "영업담당", "온보딩담당",
    "마지막접촉", "다음액션", "등록일",
  ];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([
      r.brand_name,
      r.brand_name_en,
      STATE_LABELS[r.state] ?? r.state,
      r.grade,
      r.plan ? (PLAN_LABELS[r.plan] ?? r.plan) : "",
      PAY_STATUS_LABELS[r.pay_status] ?? r.pay_status,
      SOURCE_LABELS[r.source] ?? r.source,
      (r.countries ?? []).join(" "),
      r.email,
      r.phone,
      r.category,
      r.brand_url,
      r.owner_sales,
      r.owner_onboard,
      r.last_contact_at ? String(r.last_contact_at).slice(0, 10) : "",
      r.next_action,
      r.created_at ? String(r.created_at).slice(0, 10) : "",
    ].map(cell).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    csv: lines.join("\r\n"),
    filename: `customers_${stamp}.csv`,
    count: rows.length,
  };
}
