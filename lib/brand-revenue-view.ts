// Display contract only. AI execution and scheduling are intentionally separate.
import { z } from "zod";

const Source = z.object({ title: z.string().trim().min(1).max(200), url: z.string().url() })
  .refine((s) => /^https?:\/\//.test(s.url));
const Estimated = z.object({
  status: z.literal("estimated"),
  lower: z.number().finite().positive().safe(),
  upper: z.number().finite().positive().safe(),
  currency: z.enum(["KRW", "USD", "JPY", "EUR", "CNY"]),
  year: z.number().int().min(2000).max(new Date().getFullYear()),
  scope: z.enum(["brand", "company_separate", "company_consolidated"]),
  entity: z.string().trim().min(1).max(200),
  confidence: z.enum(["high", "medium", "low"]),
  estimated_at: z.string().datetime({ offset: true }),
  rationale: z.string().trim().min(1).max(2000),
  sources: z.array(Source).min(1).max(10),
}).refine((r) => r.upper >= r.lower);
export type RevenueEstimate = z.infer<typeof Estimated>;
export type RevenueView = { estimate: RevenueEstimate | null; label: string; detail: string };
export function revenueView(raw: unknown): RevenueView {
  const parsed = Estimated.safeParse(raw);
  if (parsed.success) return { estimate: parsed.data, label: "AI 추정 · 미확정", detail: "실제 매출·고객이 제출한 매출과 구분되는 추정 범위입니다." };
  const status = raw && typeof raw === "object" ? (raw as { status?: unknown }).status : null;
  if (status === "pending") return { estimate: null, label: "추정 대기", detail: "추정 결과가 저장되면 여기에 표시됩니다." };
  if (status === "running") return { estimate: null, label: "추정 중", detail: "브랜드와 운영법인의 공개 근거를 확인하고 있습니다." };
  if (status === "insufficient") return { estimate: null, label: "추정 불가", detail: "매출을 추정할 근거가 부족합니다." };
  if (status === "failed" || status === "estimated") return { estimate: null, label: "확인 필요", detail: "유효한 추정 결과와 출처가 확인되지 않았습니다." };
  return { estimate: null, label: "추정 전", detail: "아직 저장된 AI 추정 결과가 없습니다. 자동 추정 연결 대기 상태입니다." };
}
export function revenueAmount(value: number, currency: RevenueEstimate["currency"]): string {
  if (currency === "KRW") {
    if (value >= 100_000_000) return `${Number((value / 100_000_000).toFixed(2)).toLocaleString("ko-KR")}억 원`;
    if (value >= 10_000) return `${Number((value / 10_000).toFixed(1)).toLocaleString("ko-KR")}만 원`;
    return `${value.toLocaleString("ko-KR")}원`;
  }
  return `${value.toLocaleString("ko-KR")} ${currency}`;
}
