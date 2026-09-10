import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { blendStrategy, blendChangedOnly, DIFF_THRESHOLD } from "../lib/image-translate";

describe("blendStrategy (합성 전략)", () => {
  it("거의 안 바뀌면 원본 유지, 대부분 바뀌면 통째 교체, 그 사이는 부분 합성", () => {
    expect(blendStrategy(0)).toBe("keep");
    expect(blendStrategy(0.0005)).toBe("keep");
    expect(blendStrategy(0.05)).toBe("blend");   // 글자만 바뀐 일반적인 경우
    expect(blendStrategy(0.5)).toBe("blend");
    expect(blendStrategy(0.9)).toBe("replace");
  });
});

// 화질 보존의 핵심: 글자가 없는 영역(제품 사진)은 편집본이 아니라 "원본 픽셀"이 남아야 한다.
describe("blendChangedOnly (바뀐 곳만 합성)", () => {
  const W = 240, H = 120;

  // 왼쪽 절반 = 사진(대각 그라디언트), 오른쪽 절반 = 흰 배경 위 검은 글자 블록
  async function makeBase(textDark: boolean) {
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (x < W / 2) { raw[i] = (x * 2) % 256; raw[i + 1] = (y * 2) % 256; raw[i + 2] = 128; }
        else {
          const inText = y > 40 && y < 80 && x > W / 2 + 10 && x < W - 10;
          const v = inText ? (textDark ? 0 : 255) : 255;
          raw[i] = v; raw[i + 1] = v; raw[i + 2] = v;
        }
      }
    }
    return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  }

  it("글자 영역은 편집본을 따르고, 사진 영역은 원본이 보존된다", async () => {
    const orig = await makeBase(true);    // 글자 있음
    // 편집본: 글자는 지워지고(흰색), 사진 영역은 모델이 미세하게 다르게 재렌더링(±6)
    const editedRaw = await sharp(await makeBase(false)).removeAlpha().raw().toBuffer();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) {
        const i = (y * W + x) * 3;
        editedRaw[i] = Math.min(255, editedRaw[i] + 6);
        editedRaw[i + 1] = Math.max(0, editedRaw[i + 1] - 6);
      }
    }
    const edited = await sharp(editedRaw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();

    const out = await blendChangedOnly(sharp as never, orig, edited, W, H);
    const o = await sharp(orig).removeAlpha().raw().toBuffer();
    const e = await sharp(edited).removeAlpha().raw().toBuffer();
    const r = await sharp(out).removeAlpha().raw().toBuffer();

    // 사진 영역(왼쪽) — 원본에 가깝고 편집본보다 원본 쪽이어야 한다
    const at = (x: number, y: number) => (y * W + x) * 3;
    const photo = at(40, 60);
    expect(Math.abs(r[photo] - o[photo])).toBeLessThan(3);
    expect(Math.abs(r[photo] - o[photo])).toBeLessThan(Math.abs(r[photo] - e[photo]) + 1);

    // 글자 중심(오른쪽) — 편집본(글자 지워진 흰색)을 따라야 한다
    const text = at(W - 40, 60);
    expect(Math.abs(r[text] - e[text])).toBeLessThan(40);
    expect(r[text]).toBeGreaterThan(o[text] + 100); // 검정(0) → 흰색 쪽으로 이동
  });

  it("변화가 없으면 원본을 그대로 돌려준다(불필요한 재인코딩·열화 방지)", async () => {
    const orig = await makeBase(true);
    const out = await blendChangedOnly(sharp as never, orig, orig, W, H);
    const o = await sharp(orig).removeAlpha().raw().toBuffer();
    const r = await sharp(out).removeAlpha().raw().toBuffer();
    expect(Buffer.compare(o, r)).toBe(0);
  });

  it("임계값은 미세한 재렌더링 흔들림보다 크게 잡혀 있다", () => {
    expect(DIFF_THRESHOLD).toBeGreaterThan(3 * 20); // 채널당 20 미만 흔들림은 무시
  });
});
