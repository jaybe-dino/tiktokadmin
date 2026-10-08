"use server";
// 「브랜드 해외매출 실행전략 세미나」 공개 신청 제출.
//   · 전용 표(sap_*)에만 저장한다 — 브랜드 원장을 만들거나 고치지 않는다.
//   · 자동 문자·메일 캠페인에 등록하지 않고, 접수 메일도 보내지 않는다(기본 OFF).
//   · 접수 자체로 선정을 판정하지 않는다(상태는 submitted 로 저장된다).
import { headers } from "next/headers";
import { submitApplication, listPublicSessions, getSapConfig, seatsLeft } from "@/lib/seminar-apply";
import type { SapFormInput } from "@/lib/seminar-apply-model";

/** 프록시 뒤의 실제 접속 IP. 속도 제한에만 쓰고 저장하지 않는다. */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  return (fwd.split(",")[0] || h.get("x-real-ip") || "").trim();
}

export interface PublicSessionView {
  sessionNo: number; startsAt: string; endsAt: string;
  /** 선정 인원과 남은 자리. 설정값과 실제 선정 수에서 계산한 값만 내보낸다. */
  cap: number; seatsLeft: number;
}
export interface PublicIntro {
  ok: boolean; error?: string;
  applyOpen?: boolean;
  sessions?: PublicSessionView[];
}

/** 공개 화면이 쓰는 회차 목록. Zoom 링크는 담지 않는다. */
export async function publicSessionsAction(): Promise<PublicIntro> {
  try {
    const [cfg, sessions] = await Promise.all([getSapConfig(), listPublicSessions()]);
    return {
      ok: true,
      applyOpen: cfg.apply_open,
      sessions: sessions.map((s) => ({
        sessionNo: s.session_no, startsAt: s.starts_at, endsAt: s.ends_at,
        cap: s.select_cap, seatsLeft: seatsLeft(s),
      })),
    };
  } catch (e) {
    // 조회 실패를 빈 목록으로 숨기지 않는다.
    return { ok: false, error: `회차를 불러오지 못했습니다 — ${(e as Error).message.slice(0, 120)}` };
  }
}

export interface SubmitPublicResult { ok: boolean; error?: string; already?: boolean }

export async function submitSeminarApplyAction(
  input: SapFormInput,
  utm: { source?: string; medium?: string; campaign?: string; campaignId?: string } = {},
): Promise<SubmitPublicResult> {
  // 공개 경로에서는 is_test 를 받지 않는다 — 합성 표시는 관리자 쪽에서만 붙인다.
  const r = await submitApplication({ ...input, consentAds: false, wantsConsult: false }, {
    ip: await clientIp(),
    utmSource: utm.source, utmMedium: utm.medium,
    utmCampaign: utm.campaign, campaignId: utm.campaignId,
  });
  // 저장이 끝난 건과 이미 접수된 건만 성공으로 돌려준다. 기존 신청자 정보는 담지 않는다.
  return r.ok ? { ok: true, already: Boolean(r.already) } : { ok: false, error: r.error };
}
