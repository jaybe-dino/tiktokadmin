// 제안서에 어떤 칸을 넣고 뺄지 — 담당자가 제안서마다 직접 켜고 끈다.
//   브랜드·트랙마다 필요한 칸이 달라 "특정 칸을 빼 달라"는 요청이 반복돼, 코드에서 지우는 대신
//   옵션으로 뒀다. 저장값이 없으면 여기 기본값(on)을 따른다.
//   ※ DB 의존이 없어야 한다 — 어드민 편집 화면(클라이언트)에서도 쓰는 모듈.
export interface SectionDef {
  key: string;
  label: string;
  desc: string;
  on: boolean;      // 기본 표시 여부
  where: string;    // 제안서에서 어디에 보이는 칸인지
}

export const SECTION_DEFS: SectionDef[] = [
  { key: "features", label: "기능 체크리스트", desc: "월 금액 아래 ✓ 목록", where: "가격 조건", on: false },
  { key: "value", label: "상당 구성 가치", desc: "구성 항목과 합계(상당)", where: "가격 조건", on: true },
  { key: "roadmap", label: "실행 로드맵 STEP", desc: "단계별 진행 계획", where: "실행 로드맵 & 기대 효과", on: true },
  { key: "ops", label: "운영 · 콘텐츠 칸", desc: "크리에이터 시딩 · 라이브 커머스 수량", where: "실행 로드맵 & 기대 효과", on: false },
  { key: "op_tags", label: "└ 운영 태그", desc: "운영·콘텐츠 칸 안의 #해시태그(운영·콘텐츠 칸을 켜야 보입니다)", where: "실행 로드맵 & 기대 효과", on: false },
  { key: "impact", label: "기대 효과", desc: "기대 효과 목록", where: "실행 로드맵 & 기대 효과", on: true },
  { key: "banner", label: "하단 배너 문구", desc: "「N원 상당 구성」 + 배너 문구", where: "실행 로드맵 & 기대 효과", on: true },
  { key: "bench", label: "시딩 벤치마크 표", desc: "T1~Beyond 표와 하단 주석", where: "KPI 로드맵", on: true },
  { key: "addon", label: "별도 제안(애드온)", desc: "광고 · 유가 시딩 등", where: "별도 제안", on: true },
  { key: "creators", label: "콘텐츠 레퍼런스", desc: "크리에이터 사례 카드", where: "콘텐츠 레퍼런스", on: true },
];

const DEFAULTS: Record<string, boolean> = Object.fromEntries(SECTION_DEFS.map((s) => [s.key, s.on]));

/** 이 칸을 제안서에 넣을지 — 저장값이 없으면 기본값. */
export function sectionOn(v: unknown, key: string): boolean {
  const m = (v ?? {}) as Record<string, unknown>;
  const set = m[key];
  return typeof set === "boolean" ? set : (DEFAULTS[key] ?? true);
}

/** 화면 편집용 — 전체 키의 현재 on/off 를 채워서 돌려준다. */
export function sectionMap(v: unknown): Record<string, boolean> {
  return Object.fromEntries(SECTION_DEFS.map((s) => [s.key, sectionOn(v, s.key)]));
}
