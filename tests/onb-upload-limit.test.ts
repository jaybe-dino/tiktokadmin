// 온보딩 첨부 업로드 — 한도와 실패 사유 표시.
//   증상: 큰 PDF 를 올리면 사유 없이 "업로드 실패"만 떴다. 플랫폼이 본문 크기로
//   요청을 끊으면(413) 응답이 우리 JSON 이 아니라 파싱이 터지고, 화면에는
//   아무 사유도 남지 않았다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ROUTE_BODY_LIMIT_BYTES, uploadLimitBytes, mbLabel,
  COMPANY_DOCS_MAX_BYTES, JP_LABEL_MAX_BYTES,
} from "../lib/onb-constants";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** 설명 주석을 걷어낸 실제 코드만 남긴다. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

const FORM = "../app/apply/ApplyForm.tsx";
const ROUTE = "../app/api/apply/upload/route.ts";

describe("실제로 통과하는 한도", () => {
  it("플랫폼 본문 한도(4.5MB) 안쪽이다", () => {
    expect(ROUTE_BODY_LIMIT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(ROUTE_BODY_LIMIT_BYTES).toBe(4 * 1024 * 1024);
  });

  it("슬롯 정책값이 커도 플랫폼 한도로 깎인다", () => {
    // 50MB·5MB 정책은 그대로 두되, 실제 검사·표기는 깎인 값을 쓴다.
    expect(COMPANY_DOCS_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(uploadLimitBytes(COMPANY_DOCS_MAX_BYTES)).toBe(ROUTE_BODY_LIMIT_BYTES);
    expect(uploadLimitBytes(JP_LABEL_MAX_BYTES)).toBe(ROUTE_BODY_LIMIT_BYTES);
  });

  it("정책값이 더 작으면 그 값을 그대로 쓴다", () => {
    expect(uploadLimitBytes(1024 * 1024)).toBe(1024 * 1024);
  });

  it("용량 표기가 사람이 읽는 형태다", () => {
    expect(mbLabel(4 * 1024 * 1024)).toBe("4MB");
    expect(mbLabel(4.5 * 1024 * 1024)).toBe("4.5MB");
    expect(mbLabel(6 * 1024 * 1024 + 500 * 1024)).toBe("6.5MB");
  });
});

describe("보내기 전에 막는다", () => {
  const f = code(FORM);

  it("크기를 먼저 보고 한도를 넘으면 올리지 않는다", () => {
    const i = f.indexOf("async function uploadFile");
    const body = f.slice(i, i + 2200);
    // fetch 보다 앞에서 크기를 검사해야 한다.
    expect(body).toContain("file.size > limit");
    expect(body.indexOf("file.size > limit")).toBeLessThan(body.indexOf("await fetch("));
  });

  it("사유에 한도와 실제 크기를 함께 적는다", () => {
    expect(f).toContain("mbLabel(limit)");
    expect(f).toContain("mbLabel(file.size)");
  });
});

describe("실패 사유를 숨기지 않는다", () => {
  const f = code(FORM);

  it("응답이 우리 JSON 이 아니면 상태 코드로 사유를 만든다", () => {
    expect(f).toContain("res.status === 413");
    expect(f).toContain("res.status === 401");
    expect(f).toContain("res.status === 504");
    // 마지막 폴백에도 상태 코드가 들어간다 — 맨 "업로드 실패"로 끝나지 않는다.
    expect(f).toContain("업로드 실패 (서버 응답 ${res.status})");
  });

  it("네트워크 실패와 서버 거절을 구분한다", () => {
    expect(f).toContain("서버에 보내지 못했습니다");
  });

  it("사유 없는 기본 문구가 더는 없다", () => {
    const i = f.indexOf("async function uploadFile");
    const body = f.slice(i, i + 2200);
    // 예전 코드: res.json().catch(() => ({ ok:false, error:"업로드 실패" }))
    expect(body).not.toMatch(/error:\s*"업로드 실패"\s*\}/);
  });
});

describe("서버도 같은 한도를 쓴다", () => {
  const r = code(ROUTE);

  it("정책값이 아니라 깎인 한도로 검사한다", () => {
    expect(r).toContain("uploadLimitBytes(");
    expect(r).not.toMatch(/const limit = isCompanyDocs \? COMPANY_DOCS_MAX_BYTES : isJpLabel \? JP_LABEL_MAX_BYTES : MAX;/);
  });
});

describe("화면 문구가 실제 한도와 어긋나지 않는다", () => {
  const f = code(FORM);

  it("하드코딩한 용량 숫자가 없다", () => {
    // 10MB·50MB 는 플랫폼이 받지 않는 값이라 안내로 띄우면 안 된다.
    expect(f).not.toContain("PDF/JPG/PNG · 10MB");
    expect(f).not.toContain("<b>50MB</b>");
    expect(f).not.toContain("<b>5MB</b>");
  });

  it("표기를 한도에서 뽑아 쓴다", () => {
    expect(f).toContain("mbLabel(uploadLimitBytes(");
  });
});
