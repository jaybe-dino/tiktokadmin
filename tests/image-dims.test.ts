// 이미지 가로·세로 판독 + 일본어 라벨 사진 최소 해상도 검사(BUG-50 마무리).
//   헤더만 보고 읽으므로 실제 픽셀 데이터 없이 합성 바이트로 검증한다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { imageDimensions, checkMinPixels } from "../lib/image-dims";
import { JP_LABEL_MIN_PX } from "../lib/onb-constants";

/** 최소 PNG — 서명 + IHDR(width·height). 뒤 청크는 판독에 필요 없다. */
function png(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);            // IHDR 길이
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return new Uint8Array(b);
}

/** 최소 JPEG — SOI + (선택)앞 세그먼트 + SOF0(height·width). */
function jpeg(width: number, height: number, opts: { withApp0?: boolean; marker?: number } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (opts.withApp0) {
    // APP0(JFIF) 세그먼트 — SOF 앞에 길이 있는 세그먼트가 와도 따라가는지 본다.
    const body = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0, 1, 0, 1, 0, 0];
    parts.push(0xff, 0xe0, 0x00, body.length + 2, ...body);
  }
  const m = opts.marker ?? 0xc0;
  parts.push(0xff, m, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  return new Uint8Array(parts);
}

describe("가로·세로 판독", () => {
  it("PNG 크기를 읽는다", () => {
    expect(imageDimensions(png(800, 600))).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(png(1, 1))).toEqual({ width: 1, height: 1 });
  });

  it("JPEG 크기를 읽는다(앞 세그먼트가 있어도)", () => {
    expect(imageDimensions(jpeg(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(imageDimensions(jpeg(1024, 768, { withApp0: true }))).toEqual({ width: 1024, height: 768 });
  });

  it("progressive JPEG(SOF2)도 읽는다", () => {
    expect(imageDimensions(jpeg(640, 640, { marker: 0xc2 }))).toEqual({ width: 640, height: 640 });
  });

  it("SOF 가 아닌 마커(DHT 0xC4)를 크기로 착각하지 않는다", () => {
    // 0xC4 는 허프만 테이블이지 프레임 헤더가 아니다.
    expect(imageDimensions(jpeg(640, 640, { marker: 0xc4 }))).toBeNull();
  });

  it("이미지가 아니면 null — 실패가 아니라 '검사 대상 아님'이다", () => {
    expect(imageDimensions(new Uint8Array(Buffer.from("%PDF-1.7\n...", "latin1")))).toBeNull();
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageDimensions(new Uint8Array(0))).toBeNull();
  });

  it("잘린 PNG 헤더에 터지지 않는다", () => {
    expect(imageDimensions(png(800, 600).slice(0, 20))).toBeNull();
  });
});

describe("최소 해상도 검사", () => {
  it("기준 이상이면 통과한다", () => {
    for (const [w, h] of [[600, 600], [800, 600], [600, 900], [4000, 3000]]) {
      const r = checkMinPixels(png(w, h), 600);
      expect(r.ok, `${w}x${h}`).toBe(true);
    }
  });

  it("한 변이라도 모자라면 막고 실제 크기를 알려준다", () => {
    const r = checkMinPixels(png(599, 1200), 600);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.dims).toEqual({ width: 599, height: 1200 });

    const r2 = checkMinPixels(jpeg(1200, 480), 600);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.dims).toEqual({ width: 1200, height: 480 });
  });

  it("PDF 는 픽셀 크기가 없어 통과시킨다(제보 규격이 PDF 를 허용한다)", () => {
    const r = checkMinPixels(new Uint8Array(Buffer.from("%PDF-1.7", "latin1")), 600);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dims).toBeNull();
  });
});

describe("업로드 경로 배선", () => {
  const route = readFileSync(new URL("../app/api/apply/upload/route.ts", import.meta.url), "utf8");
  const code = route.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

  it("일본어 라벨 슬롯에만 해상도 검사를 건다", () => {
    expect(code).toContain("if (isJpLabel) {");
    expect(code).toContain("checkMinPixels(bytes, JP_LABEL_MIN_PX)");
    // 회사자료·정형 서류 슬롯은 해상도를 보지 않는다(기존 동작 보존).
    const i = code.indexOf("checkMinPixels");
    const before = code.slice(Math.max(0, i - 400), i);
    expect(before).toContain("isJpLabel");
  });

  it("기준값은 제보된 600px 이다", () => {
    expect(JP_LABEL_MIN_PX).toBe(600);
  });

  it("저장 전에 막는다(작은 사진이 DB 에 들어가지 않게)", () => {
    // import 줄이 아니라 실제 호출부와 견준다.
    const save = code.indexOf("await saveOnbFile(");
    const check = code.indexOf("checkMinPixels");
    expect(save).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(save);
  });
});
