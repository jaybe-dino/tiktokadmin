// 온보딩 서류 사전 검수 규칙(BUG-60) — DB·AI 를 들이지 않는 순수 모듈.
//   화면(클라이언트 컴포넌트)과 서버가 같은 판정·문구를 쓰도록 한곳에 둔다.
//
// 목적: 브랜드가 서류를 올리는 그 자리에서 "이건 이대로 내면 반려됩니다" 를 알려 주는 것.
//   지금은 담당자가 나중에 하나씩 열어 보고 반려 → 다시 요청 → 며칠 지연이 반복된다.

/** 검수 결과. pass=그대로 접수, warn=받되 확인 필요, reject=이대로면 반려 */
export type DocVerdict = "pass" | "warn" | "reject";

export const VERDICT_LABEL: Record<DocVerdict, string> = {
  pass: "확인됨",
  warn: "확인 필요",
  reject: "이대로면 반려",
};

/** 사유 코드 — 자유 서술 대신 코드로 받는다(개인정보가 섞여 나오지 않게). */
export const REASON_TEXT: Record<string, string> = {
  // 기계적으로 판정하는 것(AI 없이도 항상 본다)
  too_small_pixels: "사진 해상도가 낮아 글자를 읽기 어렵습니다 — 더 크게 다시 찍어 올려주세요.",
  too_small_bytes: "파일이 너무 작습니다 — 빈 파일이거나 잘못 저장된 것 같습니다.",
  wrong_format: "이 서류 칸에 맞지 않는 파일 형식입니다.",
  pdf_not_allowed_here: "이 칸은 사진(JPG·PNG)으로 올려주세요.",
  // AI 가 보는 것
  wrong_document: "요청한 서류가 아닌 것으로 보입니다 — 칸을 다시 확인해주세요.",
  unreadable: "글자가 흐리거나 반사·그림자로 가려져 읽기 어렵습니다.",
  cropped: "서류의 일부가 잘렸습니다 — 네 모서리가 모두 보이게 다시 찍어주세요.",
  masked: "일부 항목이 가려져(마스킹) 있습니다 — 가리지 않은 원본으로 제출해주세요.",
  address_partial: "주소가 동·호수까지 전부 보이지 않습니다.",
  expired: "유효기간이 지난 서류로 보입니다.",
  wrong_language: "요청한 언어의 서류가 아닌 것으로 보입니다.",
  missing_fields: "꼭 보여야 하는 항목이 보이지 않습니다.",
  // 판정을 못 한 경우
  not_checked: "자동 검수를 하지 못했습니다 — 담당자가 직접 확인합니다.",
};

/** 응답에서 받아들일 사유 코드. 목록에 없는 코드는 버린다(모델이 지어낸 문장 차단). */
export const REASON_CODES: readonly string[] = Object.keys(REASON_TEXT);

export interface DocRule {
  /** 사람이 읽는 서류 이름 */
  label: string;
  /** 모델에게 "무엇이 보여야 하는가" 를 알려 주는 한 줄 */
  expect: string;
  /** 개인 신분·거주 정보가 담긴 서류인가(외부 전송 전 추가 확인 대상) */
  identity: boolean;
  /** 사진으로 받는 칸이면 최소 가로·세로 픽셀 */
  minPx?: number;
}

/** 필드 슬롯별 규칙. 접두사로 매칭되는 칸(label_photo_*, cert_* 등)은 아래 prefixRule 참조. */
export const DOC_RULES: Record<string, DocRule> = {
  doc_biz_reg_en: {
    label: "사업자등록증(영문)",
    expect: "영문으로 발급된 사업자등록증. 상호·사업자등록번호·주소·대표자명이 보여야 한다.",
    identity: false,
  },
  doc_corp_reg_kr: {
    label: "법인등기부등본",
    expect: "법인등기사항전부증명서. 법인명·법인등록번호·본점 주소·대표이사가 보여야 한다.",
    identity: false,
  },
  rep_passport_front: {
    label: "대표자 여권 사진면",
    expect: "여권의 사진·인적사항 면. 이름·여권번호·생년월일·만료일이 읽혀야 하고 네 모서리가 잘리지 않아야 한다.",
    identity: true,
    minPx: 600,
  },
  rep_address_proof: {
    label: "대표자 거주지 증명서류",
    expect: "주소가 적힌 공식 증명서. 동·호수까지 전체 주소가 가려지지 않고 보여야 한다.",
    identity: true,
    minPx: 600,
  },
  brand_logo: {
    label: "브랜드 로고",
    expect: "브랜드 로고 이미지.",
    identity: false,
  },
};

/** 접두사로 붙는 칸들(국가·제품별로 필드명이 달라진다). */
const PREFIX_RULES: [string, DocRule][] = [
  ["label_photo_", {
    label: "제품 라벨 사진",
    expect: "제품·포장에 붙은 라벨 사진. 제품명·내용량·원재료·제조사 표시가 읽혀야 한다.",
    identity: false,
    minPx: 600,
  }],
  ["cert_", {
    label: "수입 인증 서류",
    expect: "해당 국가의 수입·판매 인증 서류.",
    identity: false,
  }],
  ["logistics_", {
    label: "물류 계약서·증빙",
    expect: "현지 물류창고 계약서 또는 FBA 재고·계정 화면. 계약 당사자와 창고 주소가 보여야 한다.",
    identity: false,
  }],
  ["detail_", {
    label: "상세페이지",
    expect: "상품 상세페이지 이미지 또는 PDF.",
    identity: false,
  }],
];

export function ruleFor(field: string): DocRule | null {
  const f = String(field || "");
  if (DOC_RULES[f]) return DOC_RULES[f];
  for (const [p, r] of PREFIX_RULES) if (f.startsWith(p)) return r;
  return null;
}

export interface DocCheck {
  verdict: DocVerdict;
  /** REASON_CODES 안의 코드만 담는다. */
  reasons: string[];
  /** 기계 검사만 돌았는지(AI 미사용) */
  aiUsed: boolean;
}

/** 사유 코드 목록을 사람이 읽는 문장으로. 모르는 코드는 버린다. */
export function reasonLines(reasons: readonly string[]): string[] {
  return reasons.filter((c) => REASON_TEXT[c]).map((c) => REASON_TEXT[c]);
}

/** 코드 배열을 정제 — 아는 코드만, 중복 없이, 최대 4개. */
export function cleanReasons(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    const c = String(v || "").trim();
    if (REASON_TEXT[c] && !out.includes(c)) out.push(c);
    if (out.length >= 4) break;
  }
  return out;
}

export function cleanVerdict(v: unknown): DocVerdict | null {
  const s = String(v || "").trim().toLowerCase();
  return s === "pass" || s === "warn" || s === "reject" ? s : null;
}

/** 화면 뱃지 색 — 판정별로 한곳에서 정한다. */
export const VERDICT_STYLE: Record<DocVerdict, { fg: string; bg: string; bd: string }> = {
  pass: { fg: "#0b7a52", bg: "#eefaf4", bd: "#bfe6d4" },
  warn: { fg: "#8a5a12", bg: "#fffaf0", bd: "#f2d9a8" },
  reject: { fg: "#c92a2a", bg: "#fff5f5", bd: "#f3c2c2" },
};
