import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "올바른 날짜를 입력하세요.");
export const recurringContractInput = z.object({
  brand_id: z.string().uuid(),
  kind: z.enum(["mall", "onboarding", "guarantee", "marketing", "marketing_retainer"]),
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().min(1).max(20000),
  start_date: date, end_date: date, first_billing_date: date,
  monthly_amount: z.coerce.number().int().min(301,"정기결제 최소 금액은 301원입니다.").max(1000000000),
  vat_mode: z.enum(["included", "excluded"]),
  fee_details: z.string().trim().max(10000),
  cancellation_terms: z.string().trim().min(1).max(5000),
}).superRefine((v, ctx) => {
  if (v.end_date < v.start_date) ctx.addIssue({ code: "custom", message: "종료일은 시작일 이후여야 합니다.", path: ["end_date"] });
  if (v.first_billing_date < v.start_date || v.first_billing_date > v.end_date)
    ctx.addIssue({ code: "custom", message: "최초 결제일은 계약기간 안에 있어야 합니다.", path: ["first_billing_date"] });
});
export function recurringTotal(amount: number, vatMode: string) {
  return vatMode === "excluded" ? amount + Math.round(amount * 0.1) : amount;
}
