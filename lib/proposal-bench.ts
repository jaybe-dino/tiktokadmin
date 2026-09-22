// 제안서 시딩 벤치마크 표 — 어드민 편집 화면(클라이언트)과 공개 렌더가 함께 쓰는 값.
//   lib/proposal-doc.ts 는 DB(pg)를 끌고 오므로, 클라이언트 컴포넌트에서 쓸 값은 여기에 둔다.
export interface ProposalBench { country: string; category: string; content: string[]; adspend: string[] }

/** 시딩 벤치마크 기본값 — 베트남 · Beauty · 30일(기존 고정 상수). 국가가 다르면 제안서에서 수정. */
export const BENCH_DEFAULT: ProposalBench = {
  country: "베트남(VN)",
  category: "Beauty",
  content: ["204", "992", "2,776", "6,327", "22,470", "82,509"],
  adspend: ["$1.4K", "$14K", "$30K", "$137K", "$438K", "$4.6M"],
};
export const BENCH_TIERS = ["T1", "T2", "T3", "T4", "T5", "Beyond"];

/** 저장된 벤치마크 정규화 — 형태가 깨졌거나 비어 있으면 기본값으로 메운다. */
export function benchOf(v: unknown): ProposalBench {
  const b = (v ?? {}) as Partial<ProposalBench>;
  const six = (arr: unknown, fb: string[]): string[] =>
    Array.isArray(arr) && arr.length === fb.length ? arr.map((x, i) => (String(x ?? "").trim() || fb[i])) : fb;
  return {
    country: (b.country ?? "").trim() || BENCH_DEFAULT.country,
    category: (b.category ?? "").trim() || BENCH_DEFAULT.category,
    content: six(b.content, BENCH_DEFAULT.content),
    adspend: six(b.adspend, BENCH_DEFAULT.adspend),
  };
}

/** 진행 국가 표기(BUG-36) — 국가를 지정하면 "(국가 당)" 대신 국가명을 보여준다.
 *  금액은 국가당 단가 그대로(합산하지 않음) — 몇 개국 기준인지만 명시한다. */
export function perCountryLabel(cs: string[] | null | undefined): string {
  const list = (cs ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
  if (list.length === 0) return "(국가 당)";
  if (list.length === 1) return `(${list[0]} 기준)`;
  return `(국가 당 · ${list.join(" · ")} ${list.length}개국)`;
}
