import { describe, it, expect } from "vitest";
import { mergeBands, type TextBox } from "../lib/image-translate";

const box = (ymin: number, ymax: number, text = "t"): TextBox => ({ ymin, xmin: 0, ymax, xmax: 1000, text });

describe("mergeBands (이미지 번역 — 텍스트 밴드 병합)", () => {
  it("빈 입력 → 빈 배열", () => {
    expect(mergeBands([], 800, 4000)).toEqual([]);
  });

  it("가까운 박스는 한 밴드로 병합, 먼 박스는 분리", () => {
    // 높이 4000px: 0~1000 정규화 → 100 = 400px
    const bands = mergeBands([box(100, 150, "a"), box(155, 200, "b"), box(700, 750, "c")], 800, 4000);
    expect(bands.length).toBe(2);
    expect(bands[0].texts).toEqual(["a", "b"]);
    expect(bands[1].texts).toEqual(["c"]);
    // 패딩 포함 좌표는 이미지 범위 안
    for (const b of bands) {
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.top + b.height).toBeLessThanOrEqual(4000);
    }
  });

  it("밴드 수 상한 초과 시 가장 가까운 이웃끼리 병합(텍스트 유실 없음)", () => {
    const boxes = Array.from({ length: 20 }, (_, i) => box(i * 50, i * 50 + 20, `t${i}`));
    const bands = mergeBands(boxes, 800, 8000, 5);
    expect(bands.length).toBeLessThanOrEqual(5);
    expect(bands.flatMap((b) => b.texts).length).toBe(20);
  });

  it("순서는 위→아래 정렬 유지", () => {
    const bands = mergeBands([box(800, 850, "low"), box(100, 150, "high")], 800, 4000);
    expect(bands[0].texts).toEqual(["high"]);
    expect(bands[1].texts).toEqual(["low"]);
  });
});
