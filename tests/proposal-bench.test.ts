// 제안서 벤치마크·국가 표기(BUG-35·36) + 유입일 범위(BUG-41) 규칙.
import { describe, it, expect } from "vitest";
import { benchOf, perCountryLabel, BENCH_DEFAULT } from "../lib/proposal-bench";
import { customerDateWhere } from "../lib/repo/queries";
import { sectionOn, sectionMap, SECTION_DEFS } from "../lib/proposal-sections";

describe("benchOf (시딩 벤치마크 · BUG-35)", () => {
  it("미입력이면 베트남 기본값", () => {
    expect(benchOf(null)).toEqual(BENCH_DEFAULT);
    expect(benchOf(undefined).country).toBe("베트남(VN)");
  });
  it("국가·카테고리·수치를 문서별로 바꿀 수 있다", () => {
    const b = benchOf({ country: "미국(US)", category: "Supplement", content: ["1", "2", "3", "4", "5", "6"], adspend: ["$1", "$2", "$3", "$4", "$5", "$6"] });
    expect(b.country).toBe("미국(US)");
    expect(b.content[1]).toBe("2");
  });
  it("빈 칸은 기본값으로 메우고, 열 수가 어긋나면 기본값 행을 쓴다", () => {
    const b = benchOf({ country: "  ", content: ["", "992", "", "", "", ""], adspend: ["$1.4K"] });
    expect(b.country).toBe(BENCH_DEFAULT.country);
    expect(b.content[0]).toBe(BENCH_DEFAULT.content[0]);  // 빈 칸 → 기본값
    expect(b.content[1]).toBe("992");
    expect(b.adspend).toEqual(BENCH_DEFAULT.adspend);     // 6칸이 아니면 통째로 기본값
  });
});

describe("perCountryLabel (국가 표기 · BUG-36)", () => {
  it("국가 미지정이면 기존 '(국가 당)' 표기 유지", () => {
    expect(perCountryLabel(null)).toBe("(국가 당)");
    expect(perCountryLabel([])).toBe("(국가 당)");
    expect(perCountryLabel(["", "  "])).toBe("(국가 당)");
  });
  it("1개국이면 그 국가 기준으로 표기", () => {
    expect(perCountryLabel(["미국"])).toBe("(미국 기준)");
  });
  it("여러 국가면 국가명과 개국수를 함께 표기", () => {
    expect(perCountryLabel(["미국", "일본"])).toBe("(국가 당 · 미국 · 일본 2개국)");
  });
});

describe("customerDateWhere (유입일 범위 · BUG-41)", () => {
  it("빈 값이면 조건을 만들지 않는다", () => {
    const p: unknown[] = [];
    expect(customerDateWhere({}, p)).toEqual([]);
    expect(p).toEqual([]);
  });
  it("YYYY-MM-DD 가 아니면 무시한다(SQL 에 끼어들지 못하게)", () => {
    const p: unknown[] = [];
    expect(customerDateWhere({ from: "2026-9-1", to: "어제" }, p)).toEqual([]);
    expect(p).toEqual([]);
  });
  it("종료일은 그날 하루를 모두 포함한다", () => {
    const p: unknown[] = ["기존값"];
    const w = customerDateWhere({ from: "2026-09-01", to: "2026-09-22" }, p);
    expect(w[0]).toBe("b.created_at >= $2::date");
    expect(w[1]).toBe("b.created_at < ($3::date + 1)");
    expect(p).toEqual(["기존값", "2026-09-01", "2026-09-22"]);
  });
});

// ── 제안서에 넣을 칸 고르기(표시 섹션 옵션) ──
describe("sectionOn / sectionMap (표시 섹션 옵션)", () => {
  it("저장값이 없으면 기본값 — 운영·콘텐츠와 체크리스트·태그는 꺼진 상태", () => {
    expect(sectionOn(null, "ops")).toBe(false);
    expect(sectionOn(null, "features")).toBe(false);
    expect(sectionOn(null, "op_tags")).toBe(false);
    expect(sectionOn(null, "impact")).toBe(true);
    expect(sectionOn(null, "roadmap")).toBe(true);
    expect(sectionOn(undefined, "creators")).toBe(true);
  });
  it("저장값이 있으면 그 값을 따른다(다시 켤 수 있다)", () => {
    expect(sectionOn({ ops: true }, "ops")).toBe(true);
    expect(sectionOn({ impact: false }, "impact")).toBe(false);
  });
  it("모르는 키는 표시로 본다(칸이 통째로 사라지지 않게)", () => {
    expect(sectionOn({}, "없는칸")).toBe(true);
  });
  it("sectionMap 은 모든 칸의 현재 상태를 채워 준다", () => {
    const m = sectionMap({ ops: true });
    expect(m.ops).toBe(true);
    expect(m.features).toBe(false);
    expect(Object.keys(m).length).toBe(SECTION_DEFS.length);
  });
});
