// 일본 사전 신청 목록 — 공개 폼(/jp)으로 들어온 신청을 코드 입력 후 열람하는 화면용.
//   데이터는 별도 테이블 없이 기존 리드 구조에 그대로 들어간다:
//     brands(리드, source='jp_preorder') + brand_sources(event='lead') 의 payload.
//   기존 고객과 이메일·연락처가 겹치면 같은 브랜드로 병합되므로, 신청 이력은 소스 행 기준으로 센다.
import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "./db";
import { env } from "./env";

/** 열람 코드 — 기본 'DINO'. 운영에서 바꾸려면 env JP_VIEW_CODE 설정(코드 배포 없이 교체 가능). */
export function jpViewCode(): string {
  return (process.env.JP_VIEW_CODE || "DINO").trim();
}

/** 입력 코드 검증 — 대소문자 무시, 타이밍 공격에 둔감하게 비교. */
export function checkJpCode(input: string): boolean {
  const a = Buffer.from((input ?? "").trim().toUpperCase());
  const b = Buffer.from(jpViewCode().toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 열람 쿠키 이름 — "use server" 파일은 async 함수만 export 할 수 있어 여기에 둔다. */
export const JP_VIEW_COOKIE = "jp_view";

// 쿠키는 서명값만 담는다 — 코드 자체를 쿠키에 넣지 않고, 위조도 불가능하게.
const TOKEN_SUBJECT = "jp-view";
export function jpViewToken(): string {
  return createHmac("sha256", env.sessionSecret).update(`${TOKEN_SUBJECT}:${jpViewCode()}`).digest("hex");
}
export function verifyJpViewToken(value: string | undefined): boolean {
  if (!value) return false;
  const expected = jpViewToken();
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export interface JpApplyRow {
  brand_id: string;
  applied_at: string;
  brand_name: string;
  company: string;
  contact_name: string;
  email: string;
  phone: string;
  cert_status: string;
  sku_count: string;
  jp_sales: string;
  note: string;
  state: string;
  merged: boolean; // 기존 고객과 병합된 신청(브랜드가 신청보다 먼저 생성됨)
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** 일본 사전 신청 목록(최신순). 신청 시점 응답은 소스 payload 에서 읽는다. */
export async function listJpApplications(limit = 300): Promise<JpApplyRow[]> {
  const rows = await query<{
    brand_id: string; occurred_at: string; payload: Record<string, unknown> | null;
    brand_name: string; email: string | null; phone: string | null; contact_name: string | null;
    state: string; created_at: string;
  }>(
    `SELECT s.brand_id, s.occurred_at, s.payload,
            b.brand_name, b.email, b.phone, b.contact_name, b.state, b.created_at
       FROM brand_sources s
       JOIN brands b ON b.id = s.brand_id
      WHERE s.event='lead' AND s.payload->>'source' = 'jp_preorder'
      ORDER BY s.occurred_at DESC
      LIMIT $1`,
    [limit],
  ).catch(() => []);

  return rows.map((r) => {
    const p = r.payload ?? {};
    // 신청서에 적힌 값을 우선 사용하고, 없으면 브랜드 원장 값으로 보완.
    return {
      brand_id: r.brand_id,
      applied_at: r.occurred_at,
      brand_name: str(p.brand_name) || r.brand_name || "",
      company: str(p.company_name),
      contact_name: str(p.contact_name) || r.contact_name || "",
      email: str(p.email) || r.email || "",
      phone: str(p.phone) || r.phone || "",
      cert_status: str(p.cert_status),
      sku_count: str(p.sku_count),
      jp_sales: str(p.jp_sales),
      note: str(p.memo),
      state: r.state,
      // 브랜드가 신청 시각보다 먼저 만들어졌다면 기존 고객에 병합된 건.
      merged: new Date(r.created_at).getTime() < new Date(r.occurred_at).getTime() - 60_000,
    };
  });
}
