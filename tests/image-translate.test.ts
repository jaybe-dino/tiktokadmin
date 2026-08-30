import { describe, it, expect } from "vitest";
import { mergeBands, nearestRatio, padToRatio, padBands, type TextBox } from "../lib/image-translate";

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

describe("화면비 보정 (이미지 깨짐 방지)", () => {
  it("nearestRatio — 지원 화면비 중 가장 가까운 값", () => {
    expect(nearestRatio(1000, 1000)).toBe("1:1");
    expect(nearestRatio(1920, 1080)).toBe("16:9");
    expect(nearestRatio(860, 3000)).toBe("9:16");   // 아주 세로로 긴 입력
    expect(nearestRatio(2100, 900)).toBe("21:9");   // 가장 납작한 지원 비율
    expect(nearestRatio(860, 120)).toBe("21:9");    // 21:9 보다 납작해도 21:9 로 수렴
  });

  it("padToRatio — 얇은 띠를 21:9 이내로 확장하되 이미지 밖으로 나가지 않음", () => {
    const W = 900, H = 5000;
    const need = Math.ceil(W / (21 / 9)); // ≈ 386
    const p = padToRatio(1000, 100, W, H);
    expect(p.height).toBeGreaterThanOrEqual(need);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + p.height).toBeLessThanOrEqual(H);

    // 상단 경계 — 위로 못 넓히면 아래로 넓힌다
    const top0 = padToRatio(0, 100, W, H);
    expect(top0.top).toBe(0);
    expect(top0.height).toBeGreaterThanOrEqual(need);

    // 하단 경계 — 아래로 못 넓히면 위로 넓힌다
    const bottom = padToRatio(H - 100, 100, W, H);
    expect(bottom.top + bottom.height).toBeLessThanOrEqual(H);
    expect(bottom.height).toBeGreaterThanOrEqual(need);

    // 이미지 자체가 띠보다 작으면 그대로
    expect(padToRatio(0, 200, W, 200)).toEqual({ top: 0, height: 200 });

    // 이미 충분히 두꺼우면 변경 없음
    expect(padToRatio(500, 800, W, H)).toEqual({ top: 500, height: 800 });
  });

  it("padBands — 확장 후 겹치는 밴드는 합쳐서 덮어쓰기 방지", () => {
    const W = 900, H = 5000;
    const bands = [
      { top: 1000, height: 60, texts: ["a"] },
      { top: 1120, height: 60, texts: ["b"] }, // 확장하면 위 밴드와 겹침
      { top: 4000, height: 60, texts: ["c"] },
    ];
    const out = padBands(bands, W, H);
    expect(out.length).toBe(2);
    expect(out[0].texts).toEqual(["a", "b"]);
    expect(out[1].texts).toEqual(["c"]);
    // 결과 구역끼리 겹치지 않는다
    for (let i = 0; i + 1 < out.length; i++) {
      expect(out[i].top + out[i].height).toBeLessThanOrEqual(out[i + 1].top);
    }
    // 모든 구역이 이미지 범위 안
    for (const b of out) {
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.top + b.height).toBeLessThanOrEqual(H);
    }
  });
});
