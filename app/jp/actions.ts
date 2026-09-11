"use server";
// 일본 진출 사전 신청 — 공개 폼 제출 → 리드 인입(ingest 'lead').
//   기존 리드와 이메일·연락처가 겹치면 ingest 의 dedup 이 같은 브랜드로 병합한다
//   (새 브랜드를 만들지 않고 기존 카드에 소스·응답만 덧붙음).
import { processIngest } from "@/lib/ingest";

export interface JpApplyInput {
  company: string;        // 회사명
  brand_name: string;     // 브랜드명
  contact_name?: string;  // 담당자명(선택)
  phone: string;          // 연락처
  email: string;          // 이메일
  cert_status: string;    // 인증 보유 여부
  sku_count: string;      // 제품 SKU 수
  jp_sales: string;       // 일본 현지 판매 현황
  note?: string;          // 추가 문의(선택)
}

const clean = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function submitJpApplyAction(input: JpApplyInput): Promise<{ ok: boolean; error?: string }> {
  const company = clean(input.company, 120);
  const brand = clean(input.brand_name, 120);
  const email = clean(input.email, 160).toLowerCase();
  const phone = clean(input.phone, 40);

  if (!company) return { ok: false, error: "회사명을 입력해주세요." };
  if (!brand) return { ok: false, error: "브랜드명을 입력해주세요." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "이메일 형식을 확인해주세요." };
  if (phone.replace(/\D/g, "").length < 9) return { ok: false, error: "연락처를 정확히 입력해주세요." };

  // 멱등키 — 같은 사람이 새로고침으로 여러 번 눌러도 리드가 중복 생성되지 않는다(일자 단위).
  const day = new Date().toISOString().slice(0, 10);
  const idemKey = `jp:${email}:${day}`;

  const res = await processIngest("lead", idemKey, {
    site: "apply",
    occurred_at: new Date().toISOString(),
    source: "jp_preorder",
    email,
    phone,
    brand_name: brand,
    contact_name: clean(input.contact_name, 60) || null,
    source_ref: idemKey,
    // 설문 응답은 payload 로 보관 — 브랜드 360 타임라인의 유입 기록에서 그대로 열람된다.
    company_name: company,
    cert_status: clean(input.cert_status, 60),
    sku_count: clean(input.sku_count, 60),
    jp_sales: clean(input.jp_sales, 200),
    memo: [
      `[일본 사전신청] 회사 ${company} · 브랜드 ${brand}`,
      `인증 ${clean(input.cert_status, 60) || "-"} · SKU ${clean(input.sku_count, 60) || "-"}`,
      `일본 판매현황: ${clean(input.jp_sales, 200) || "-"}`,
      clean(input.note, 500) ? `문의: ${clean(input.note, 500)}` : "",
    ].filter(Boolean).join("\n"),
  }).catch(() => null);

  if (!res || res.http >= 400) {
    return { ok: false, error: "접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }
  return { ok: true };
}
