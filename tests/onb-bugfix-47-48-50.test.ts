// BUG-47 / BUG-48 / BUG-50 — 온보딩 신청서 보완.
//   DB 없이, 상수와 화면 코드가 약속대로 되어 있는지 본다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  JP_LABEL_FIELD, JP_LABEL_MAX_BYTES, JP_LABEL_MAX_COUNT, JP_LABEL_MIN_PX,
  JP_LABEL_ITEMS, JP_LABEL_FORMATS, COMPANY_DOCS_FIELD,
} from "../lib/onb-constants";
import { STEP_REQUIRED_LABELS } from "../lib/onboarding";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** 설명 주석을 걷어낸 실제 코드만 남긴다. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l) && !/^\s*\{\/\*/.test(l)).join("\n");

const FORM = "../app/apply/ApplyForm.tsx";
const UPLOAD = "../app/api/apply/upload/route.ts";
const REVIEW = "../app/(dash)/onboarding/[customerId]/ReviewClient.tsx";

describe("BUG-47 · 사업자등록증(한글) 제외", () => {
  it("제출 필수 항목에서 빠졌다", () => {
    const step1 = STEP_REQUIRED_LABELS(1);
    expect(step1).not.toContain("사업자등록증(한글)");
    // 영문본과 법인등기부등본은 그대로 받는다.
    expect(step1).toContain("사업자등록증(영문)");
    expect(step1).toContain("법인등기부등본(한글)");
  });

  it("신청서 화면에서 업로드 칸이 사라졌다", () => {
    const f = code(FORM);
    expect(f).not.toContain('k="doc_biz_reg_kr_url"');
    expect(f).toContain('k="doc_biz_reg_en_url"');
  });

  it("칼럼과 과거 제출분은 지우지 않는다", () => {
    // 저장 키 목록에 남아 있어야 이미 올린 값이 저장 때 날아가지 않는다.
    expect(code(FORM)).toContain('"doc_biz_reg_kr_url"');
    // 어드민 검토 화면에서는 계속 보여준다.
    expect(code(REVIEW)).toContain("doc_biz_reg_kr_url");
  });
});

describe("BUG-48 · 첨부를 바로 내려받기", () => {
  it("신청서의 단일 첨부에도 내려받기 링크가 있다", () => {
    const f = code(FORM);
    expect(f).toContain("fileDownloadHref(url)");
    expect(f).toContain("내려받기");
  });

  it("어드민 검토 화면은 내부 첨부를 다운로드로 연다", () => {
    const r = code(REVIEW);
    expect(r).toContain("fileLinkProps");
  });

  it("다운로드 링크는 내부 첨부에만 강제한다(외부 링크는 새 창)", async () => {
    const { fileLinkProps, fileDownloadHref } = await import("../lib/onb-file-link");
    expect(fileDownloadHref("/api/apply/file/abc")).toBe("/api/apply/file/abc?dl=1");
    expect(fileDownloadHref("https://drive.example.invalid/x")).toBe("https://drive.example.invalid/x");
    expect("download" in fileLinkProps("/api/apply/file/abc")).toBe(true);
    expect("download" in fileLinkProps("https://drive.example.invalid/x")).toBe(false);
  });
});

describe("BUG-50 · 일본어 라벨 사진", () => {
  it("제보된 규격 그대로 상수에 있다", () => {
    expect(JP_LABEL_MAX_COUNT).toBe(10);
    expect(JP_LABEL_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(JP_LABEL_MIN_PX).toBe(600);
    expect(JP_LABEL_FORMATS).toBe("PDF · PNG · JPG · JPEG");
  });

  it("사진에 보여야 할 항목 6가지가 모두 있다", () => {
    expect([...JP_LABEL_ITEMS]).toEqual([
      "제품 앞·뒤·측면 및 포장 사진",
      "제품명",
      "제품 설명",
      "내용량",
      "전체 원재료 및 성분 표시",
      "제조사/판매사 명칭 및 주소",
    ]);
  });

  it("회사자료와 다른 슬롯을 쓴다(섞이지 않게)", () => {
    expect(JP_LABEL_FIELD).toBe("jp_label_photos");
    expect(JP_LABEL_FIELD).not.toBe(COMPANY_DOCS_FIELD);
  });

  it("업로드 API 가 이 슬롯의 용량·개수를 따로 적용한다", () => {
    const u = code(UPLOAD);
    // 용량: 이 슬롯만 5MB 로 갈라진다.
    expect(u).toContain("isJpLabel ? JP_LABEL_MAX_BYTES");
    // 개수: 회사자료 전용이 아니라 이 슬롯에도 상한이 걸린다.
    expect(u).toMatch(/isJpLabel \? \{ field: JP_LABEL_FIELD, max: JP_LABEL_MAX_COUNT \}/);
    // 상한 검사가 실제로 그 분기를 쓴다.
    expect(u).toContain("have.length >= multi.max");
  });

  it("신청서에 업로드 칸과 안내가 있다", () => {
    const f = code(FORM);
    expect(f).toContain("JpLabelPhotos");
    expect(f).toContain("JP_LABEL_ITEMS.map");
    expect(f).toContain('accept=".pdf,.jpg,.jpeg,.png"');
  });

  it("일본을 고른 신청서에서만 보여준다", () => {
    const f = code(FORM);
    expect(f).toContain('countries.some((c) => c.country_code === "JP")');
    expect(f).toContain("{wantsJp && <JpLabelPhotos");
  });

  it("어드민 검토 화면에서 사진을 볼 수 있다", () => {
    const r = code(REVIEW);
    expect(r).toContain("jpLabelPhotos");
    expect(r).toContain("일본어 라벨 사진");
  });

  it("클라이언트가 DB 모듈을 가져오지 않는다(상수는 별도 모듈)", () => {
    const f = read(FORM);
    expect(f).toContain('from "@/lib/onb-constants"');
    expect(f).not.toContain('from "@/lib/onboarding"');
  });
});
