"use server";
// 행사별 신청 접수. 저장은 sev_registrations 에만 하고 고객에게 아무것도 보내지 않는다.
//   화면에서 온 is_test 는 받지 않는다(검수용 합성 데이터는 관리자 경로에서만 만든다).
import { submitRegistration } from "@/lib/seminar-events";

export interface EventApplyInput {
  companyName: string; brandName?: string;
  contactName: string; contactTitle?: string;
  phone: string; email: string; siteUrl?: string;
  countries?: string; note?: string;
  privacyAgreed?: boolean; marketingAgreed?: boolean;
}

export async function applyEventAction(slug: string, input: EventApplyInput):
  Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const r = await submitRegistration(slug, {
    companyName: input.companyName, brandName: input.brandName,
    contactName: input.contactName, contactTitle: input.contactTitle,
    phone: input.phone, email: input.email, siteUrl: input.siteUrl,
    countries: input.countries, note: input.note,
    privacyAgreed: input.privacyAgreed, marketingAgreed: input.marketingAgreed,
  });
  return r.ok ? { ok: true, already: r.already } : { ok: false, error: r.error };
}
