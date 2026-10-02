"use server";
// 틱톡샵 주간 온보딩 신청(공개 폼) 제출.
//   · 전용 표에만 저장한다 — 브랜드를 만들거나 기존 고객 값을 고치지 않는다.
//   · 자동 문자·메일 캠페인에 등록하지 않는다(processIngest 를 거치지 않는다).
//   · 접수 자체로 확정·마감을 판정하지 않는다.
import { submitWeeklyApplication, type WeeklyApplyInput } from "@/lib/weekly-onboarding";

export interface WeeklyFormInput {
  brandName: string; companyName: string; siteUrl?: string;
  contactName: string; contactTitle?: string;
  phone: string; email: string; note?: string;
  /** 신청자가 고른 자가 기입 매출 구간(필수). 서버가 허용값인지 다시 검사한다. */
  revenueBand?: string;
}

export async function submitWeeklyApplyAction(input: WeeklyFormInput):
  Promise<{ ok: boolean; error?: string; already?: boolean }> {
  // 공개 경로에서는 is_test 를 받지 않는다(합성 데이터 표시는 서버 내부에서만 쓴다).
  const safe: WeeklyApplyInput = {
    brandName: input.brandName, companyName: input.companyName, siteUrl: input.siteUrl,
    contactName: input.contactName, contactTitle: input.contactTitle,
    phone: input.phone, email: input.email, note: input.note,
    revenueBand: input.revenueBand,
  };
  const r = await submitWeeklyApplication(safe);
  return r.ok ? { ok: true, already: r.already } : { ok: false, error: r.error };
}
