// 관리 화면의 순수 로직 — CSV 와 안내문 초안. DB 를 import 하지 않는다.
//   초안은 만들기만 한다. 이 모듈은 어디에도 보내지 않는다.
import {
  STATUS_KO, maskEmail, maskPhone, fmtSessionWhen,
  REVENUE_BANDS, OVERSEAS_REVENUE_BANDS, PROGRAM_TITLE,
  type SapStatus,
} from "./seminar-apply-model";

export interface CsvReg {
  id: string; session_no: number; session_starts_at: string;
  company_name: string; brand_name: string; no_brand: boolean;
  contact_name: string; job_role: string; job_role_etc: string;
  email: string; phone: string; site_url: string;
  product_category: string; overseas_stage: string; target_countries: string; question: string;
  selling_countries: string; selling_channels: string;
  revenue_band: string; overseas_revenue_band: string; export_timing: string; support_areas: string;
  wants_consult: boolean; biz_no: string;
  consent_optional: boolean; consent_ads: boolean; consent_version: string;
  consent_required_expires_at: string | null; consent_ads_expires_at: string | null;
  status: SapStatus; status_reason: string; admin_note: string;
  source: string; utm_source: string; utm_campaign: string; campaign_id: string;
  is_test: boolean; created_at: string;
}

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
const bandLabel = (key: string, list: { key: string; label: string }[]) =>
  key ? (list.find((b) => b.key === key)?.label ?? key) : "";

export const CSV_HEADER = [
  "회차", "회차일시", "상태", "상태사유", "회사명", "브랜드명", "담당자명", "직무",
  "업무이메일", "연락처", "공식URL", "상품카테고리", "해외진출단계", "희망국가",
  "질문·해결과제", "판매국가", "판매채널", "매출구간", "해외매출구간", "수출예정시기",
  "희망지원분야", "1:1상담", "사업자번호", "선택정보동의", "광고동의", "동의버전",
  "필수정보 만료", "광고동의 만료", "출처", "utm_source", "utm_campaign", "campaign_id",
  "테스트", "접수시각", "관리메모",
];

/**
 * CSV 본문. 접속 링크(Zoom)는 어떤 경우에도 넣지 않는다.
 *   masked=true 면 이메일·연락처를 가린다(연락처 조회 권한이 없는 역할).
 */
export function csvOfRegs(rows: CsvReg[], opts: { masked?: boolean } = {}): string {
  const body = rows.map((r) => [
    r.session_no,
    fmtSessionWhen(r.session_starts_at),
    STATUS_KO[r.status] ?? r.status,
    r.status_reason,
    r.company_name,
    r.no_brand ? "(미보유)" : r.brand_name,
    r.contact_name,
    r.job_role === "기타" && r.job_role_etc ? `기타(${r.job_role_etc})` : r.job_role,
    opts.masked ? maskEmail(r.email) : r.email,
    opts.masked ? maskPhone(r.phone) : r.phone,
    r.site_url,
    r.product_category,
    r.overseas_stage,
    r.target_countries,
    r.question,
    r.selling_countries,
    r.selling_channels,
    bandLabel(r.revenue_band, REVENUE_BANDS),
    bandLabel(r.overseas_revenue_band, OVERSEAS_REVENUE_BANDS),
    r.export_timing,
    r.support_areas,
    r.wants_consult ? "희망" : "",
    r.biz_no,
    r.consent_optional ? "동의" : "미동의",
    r.consent_ads ? "동의" : "미동의",
    r.consent_version,
    (r.consent_required_expires_at ?? "").slice(0, 10),
    (r.consent_ads_expires_at ?? "").slice(0, 10),
    r.source,
    r.utm_source,
    r.utm_campaign,
    r.campaign_id,
    r.is_test ? "TEST" : "",
    r.created_at.slice(0, 19),
    r.admin_note,
  ].map(cell).join(","));
  return "﻿" + [CSV_HEADER.map(cell).join(","), ...body].join("\r\n");
}

// ── 안내문 초안 ──────────────────────────────────────────────
//   보내지 않는다. 담당자가 읽고 고쳐 쓰는 초안이다.
//   접속 링크는 초안에 넣지 않고 자리만 표시한다 — 보내기 직전에 사람이 채운다.
export interface Draft { subject: string; body: string }

export function draftSelectedMail(r: Pick<CsvReg, "contact_name" | "company_name" | "session_no" | "session_starts_at">): Draft {
  const when = fmtSessionWhen(r.session_starts_at);
  return {
    subject: `[${PROGRAM_TITLE}] ${r.session_no}회차 선정 안내`,
    body: [
      `${r.contact_name}님, 안녕하세요. 디노스튜디오 GloveK입니다.`,
      "",
      `신청해 주신 「${PROGRAM_TITLE}」 ${r.session_no}회차에 선정되셨습니다.`,
      "",
      `• 일시: ${when}`,
      "• 진행: Zoom 온라인 (접속 링크는 아래 안내를 확인해 주세요)",
      "",
      "접속 링크는 별도 안내 메일로 보내 드립니다.",
      "일정이 어려우시면 이 메일로 알려주세요 — 다른 회차로 옮겨 드리겠습니다.",
      "",
      "디노스튜디오 GloveK 드림",
    ].join("\n"),
  };
}

export function draftZoomMail(r: Pick<CsvReg, "contact_name" | "session_no" | "session_starts_at">): Draft {
  const when = fmtSessionWhen(r.session_starts_at);
  return {
    subject: `[${PROGRAM_TITLE}] ${r.session_no}회차 접속 안내`,
    body: [
      `${r.contact_name}님, 안녕하세요. 디노스튜디오 GloveK입니다.`,
      "",
      `「${PROGRAM_TITLE}」 ${r.session_no}회차 접속 안내를 드립니다.`,
      "",
      `• 일시: ${when}`,
      "• 접속 링크: (보내기 전에 회차 설정의 링크를 직접 넣어 주세요)",
      "",
      "시작 5분 전까지 접속해 주세요. 대기실이 열려 있어 순차로 입장 처리됩니다.",
      "",
      "디노스튜디오 GloveK 드림",
    ].join("\n"),
  };
}
