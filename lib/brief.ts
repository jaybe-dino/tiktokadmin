import { docProgress } from "./docs";
import { getBrand } from "./repo/brands";
import { env } from "./env";
import { STATE_LABELS } from "./types";

// 리마인더 초안 + 사전분석 브리프 (06-MCP-AGENTS §2). 매번 새로 생성.

export interface ReminderDraft {
  subject?: string;
  body: string;
}

/** 브랜드 발송용 정중한 한국어 리마인더 초안. */
export async function draftReminder(
  brandId: string,
  channel: "email" | "sms" = "email",
): Promise<ReminderDraft> {
  const brand = await getBrand(brandId);
  if (!brand) return { body: "" };
  const prog = await docProgress(brandId);
  const missing = prog.missing.length ? prog.missing.join(", ") : "추가 서류";
  const link = `${env.adminUrl}/brand/${brandId}`;

  if (channel === "sms") {
    return {
      body:
        `[Glovek] ${brand.brand_name}님, 온보딩 진행을 위해 미제출 서류(${missing})가 필요합니다. ` +
        `확인 부탁드립니다.`,
    };
  }

  return {
    subject: `[Glovek] ${brand.brand_name} 온보딩 서류 요청`,
    body:
      `안녕하세요, ${brand.contact_name || brand.brand_name}님.\n\n` +
      `Glovek 온보딩 진행을 위해 아래 서류가 아직 접수되지 않았습니다.\n` +
      `· 미제출: ${missing}\n\n` +
      `빠른 입점 셋업을 위해 확인 후 회신 부탁드립니다.\n` +
      `문의사항은 담당자에게 편하게 연락 주세요.\n\n` +
      `감사합니다.\nGlovek 온보딩팀`,
  };
}

/** 결제 안내 버전 초안 (past_due). */
export async function draftPaymentReminder(brandId: string): Promise<ReminderDraft> {
  const brand = await getBrand(brandId);
  if (!brand) return { body: "" };
  return {
    subject: `[Glovek] ${brand.brand_name} 정기결제 확인 요청`,
    body:
      `안녕하세요, ${brand.contact_name || brand.brand_name}님.\n\n` +
      `정기결제가 정상 처리되지 않아 서비스 이용에 영향이 있을 수 있습니다.\n` +
      `결제 수단을 확인해 주시면 감사하겠습니다.\n\n` +
      `Glovek 운영팀`,
  };
}

/**
 * 사전분석 브리프(brief_md). 06 §2 의 6줄 구조.
 * signals: brand_signals 요약, checks: 셀프진단 등.
 * (AI 정식화 전 규칙 기반 draft — diagnose_brand 에서 사용)
 */
export function buildBriefMarkdown(input: {
  brandName: string;
  category: string;
  countries: string[];
  grade: string | null;
  recTrack: string | null;
  state: string;
  domesticSignal?: string;
  digitalPresence?: string;
  overseasReadiness?: string;
  salesPoint?: string;
  risk?: string;
}): string {
  const {
    brandName, category, countries, grade, recTrack, state,
    domesticSignal = "공개신호 수집 전 (신뢰도 low)",
    digitalPresence = "미수집",
    overseasReadiness = "셀프진단 기반",
    salesPoint = "브랜드 강점 확인 필요",
    risk = "미팅 검증 필요",
  } = input;

  return [
    `## ${brandName} · 사전분석 브리프`,
    ``,
    `- **카테고리/목표국**: ${category || "미상"} / ${countries.length ? countries.join(", ") : "미정"}`,
    `- **국내 규모(추정)**: ${domesticSignal}`,
    `- **디지털 존재감(SNS·틱톡)**: ${digitalPresence}`,
    `- **해외 준비(인증·물류·경험)**: ${overseasReadiness}`,
    `- **5대 지표 판정 → 등급**: ${grade ?? "미산정"} (추천: ${recTrack ?? "미정"})`,
    `- **추천 트랙·플랜 + 영업 포인트 / 리스크**: ${recTrack ?? "미정"} · ${salesPoint} · ⚠️ ${risk}`,
    ``,
    `_현재 상태: ${STATE_LABELS[state as keyof typeof STATE_LABELS] ?? state}_`,
  ].join("\n");
}
