// 온보딩 — ① 에이전시명 발급/표시 ② 회사자료(브랜드 소개서) 다중 첨부 50MB ③ 어드민 즉시 다운로드.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isInternalFileUrl, fileDownloadHref, fileLinkProps, contentDisposition,
} from "../lib/onb-file-link";
import { COMPANY_DOCS_FIELD, COMPANY_DOCS_MAX_BYTES, COMPANY_DOCS_MAX_COUNT } from "../lib/onboarding";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("첨부 다운로드 링크(순수 함수)", () => {
  it("우리 서버 첨부만 내부 파일로 본다", () => {
    expect(isInternalFileUrl("/api/apply/file/5f6a1c22-1111-2222-3333-444455556666")).toBe(true);
    expect(isInternalFileUrl("/api/brand/import-file/abc")).toBe(true);
    expect(isInternalFileUrl("https://drive.google.com/file/d/xxxx/view")).toBe(false);
    expect(isInternalFileUrl("/api/apply/file/")).toBe(false);
    expect(isInternalFileUrl("")).toBe(false);
    expect(isInternalFileUrl(null)).toBe(false);
  });

  it("내부 첨부에는 ?dl=1 을 붙이고 외부 링크는 손대지 않는다", () => {
    expect(fileDownloadHref("/api/apply/file/abc")).toBe("/api/apply/file/abc?dl=1");
    expect(fileDownloadHref("/api/apply/file/abc?v=2")).toBe("/api/apply/file/abc?v=2&dl=1");
    expect(fileDownloadHref("https://example.com/a.pdf")).toBe("https://example.com/a.pdf");
  });

  it("?dl=1 을 두 번 붙이지 않는다", () => {
    expect(fileDownloadHref("/api/apply/file/abc?dl=1")).toBe("/api/apply/file/abc?dl=1");
    expect(fileDownloadHref("/api/apply/file/abc?v=2&dl=1")).toBe("/api/apply/file/abc?v=2&dl=1");
  });

  it("내부 첨부는 download, 외부 링크는 새 창 — 새 창과 다운로드를 섞지 않는다", () => {
    const inner = fileLinkProps("/api/apply/file/abc", "브랜드 소개서.pdf");
    expect(inner).toEqual({ href: "/api/apply/file/abc?dl=1", download: "브랜드 소개서.pdf" });
    expect("target" in inner).toBe(false);

    const outer = fileLinkProps("https://example.com/a.pdf");
    expect(outer).toEqual({ href: "https://example.com/a.pdf", target: "_blank", rel: "noreferrer" });
    expect("download" in outer).toBe(false);
  });
});

describe("파일 응답 헤더", () => {
  it("dl=1 이면 attachment, 아니면 inline", () => {
    expect(contentDisposition("a.pdf", true)).toContain("attachment;");
    expect(contentDisposition("a.pdf", false)).toContain("inline;");
  });

  it("한글 파일명은 filename* 로 온전히 전달되고 ASCII 대체본도 함께 준다", () => {
    const d = contentDisposition("브랜드 소개서.pdf", true);
    expect(d).toContain(`filename*=UTF-8''${encodeURIComponent("브랜드 소개서.pdf")}`);
    expect(d).toMatch(/filename="[\x20-\x7e]+"/);
  });

  it("헤더를 깨뜨리는 문자(줄바꿈·따옴표·경로)는 제거한다", () => {
    const d = contentDisposition('a"b\r\nX-Evil: 1/..\\c.pdf', true);
    expect(d).not.toContain("\n");
    expect(d).not.toContain("\r");
    expect(d.match(/filename="([^"]*)"/)![1]).not.toContain('"');
    expect(d).not.toContain("X-Evil: 1/");
  });

  it("파일명이 비어도 이름이 남는다", () => {
    expect(contentDisposition("", true)).toContain('filename="download"');
  });
});

describe("① 에이전시명", () => {
  const form = read("../app/(dash)/onboarding/IssueForm.tsx");
  const actions = read("../app/(dash)/onboarding/actions.ts");
  const lib = read("../lib/onboarding.ts");
  const applyForm = read("../app/apply/ApplyForm.tsx");
  const reviewPage = read("../app/(dash)/onboarding/[customerId]/page.tsx");

  it("발급 폼에 에이전시 입력이 있고 발급 액션까지 전달된다", () => {
    expect(form).toContain("에이전시 (선택)");
    expect(form).toMatch(/issueCustomerAction\(.*agency/);
    expect(actions).toMatch(/issueCustomer\(.*agency/);
  });

  it("발급 시 agency_name 을 저장한다", () => {
    expect(lib).toContain("agency_name=EXCLUDED.agency_name");
  });

  it("0101 미적용이면 저장된 척하지 않고 사유를 알려준다", () => {
    expect(lib).toContain("마이그레이션 0101 적용 필요");
    expect(form).toContain("result.warn");
  });

  it("고객 신청서 화면에 에이전시명이 표시된다", () => {
    expect(applyForm).toContain('data-testid="apply-agency"');
    expect(applyForm).toContain("props.agencyName");
  });

  it("어드민 신청서 화면도 에이전시명을 읽어 표시한다", () => {
    expect(reviewPage).toContain("agency_name");
    expect(reviewPage).toContain("customer.agency_name");
  });

  it("어드민 조회는 0101 미적용 DB 에서도 뜨지만 다른 DB 오류는 숨기지 않는다", () => {
    expect(reviewPage).toContain('if (!/agency_name/.test((e as Error).message)) throw e;');
  });

  it("세션 고객 조회도 agency_name 을 가져온다(빈 값으로 굳지 않는다)", () => {
    const sel = lib.slice(lib.indexOf("export async function currentOnbCustomer"));
    expect(sel.slice(0, 700)).toContain("agency_name");
  });
});

describe("② 회사자료 다중 첨부", () => {
  const upload = read("../app/api/apply/upload/route.ts");
  const applyForm = read("../app/apply/ApplyForm.tsx");

  it("회사자료 슬롯만 50MB, 다른 슬롯은 기존 10MB 를 지킨다", () => {
    expect(COMPANY_DOCS_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(upload).toContain("const MAX = 10 * 1024 * 1024");
    expect(upload).toContain("isCompanyDocs ? COMPANY_DOCS_MAX_BYTES : MAX");
  });

  it("개수 상한이 있고 그 사유를 고객에게 알려준다", () => {
    expect(COMPANY_DOCS_MAX_COUNT).toBeGreaterThan(1);
    expect(upload).toContain("COMPANY_DOCS_MAX_COUNT");
    expect(upload).toContain("개까지 올릴 수 있습니다");
  });

  it("문서·압축 확장자는 회사자료 슬롯에서만 허용한다", () => {
    const m = upload.match(/const DOC_EXT = (\/[^\n]+\/i);/);
    expect(m, "DOC_EXT 정규식을 찾지 못했다").toBeTruthy();
    const re = new RegExp(m![1].slice(1, -2), "i");
    for (const n of ["소개서.pdf", "deck.pptx", "회사소개.ppt", "a.docx", "b.xlsx", "c.hwp", "d.zip", "e.PNG"]) {
      expect(re.test(n), n).toBe(true);
    }
    for (const n of ["a.exe", "b.sh", "c.js", "noext"]) expect(re.test(n), n).toBe(false);
    // 정형 서류 슬롯은 기존 규칙(PDF/JPG/PNG) 그대로다.
    expect(upload).toContain('/\\.(pdf|jpe?g|png)$/i.test(file.name || "")');
  });

  it("업로드 필드 이름이 코드 한 곳에서만 정의된다", () => {
    expect(COMPANY_DOCS_FIELD).toBe("company_docs");
    expect(upload).toContain("COMPANY_DOCS_FIELD");
    expect(applyForm).toContain("company_docs");
  });

  it("고객 화면에서 여러 개를 한 번에 올리고 지울 수 있다", () => {
    expect(applyForm).toContain('type="file" multiple');
    expect(applyForm).toContain("removeCompanyDocAction");
  });

  it("삭제는 해당 신청서의 파일만 가능하다(다른 신청서 ID 혼입 차단)", () => {
    const lib = read("../lib/onboarding.ts");
    expect(lib).toContain("UPDATE onb_files SET removed_at=now() WHERE id=$1 AND application_id=$2");
  });

  it("0101 마이그레이션은 추가만 한다(기존 데이터 변경 없음)", () => {
    const sql = read("../migrations/0101_onb_agency_company_docs.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS agency_name");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS removed_at");
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  });
});

describe("③ 어드민은 새 창이 아니라 바로 다운로드", () => {
  const files = [
    "../app/(dash)/onboarding/[customerId]/ReviewClient.tsx",
    "../components/OnbProductAdmin.tsx",
  ];

  it("어드민 첨부 링크에 target=_blank 를 직접 쓰지 않는다", () => {
    for (const f of files) {
      const offenders = read(f).split("\n")
        .map((text, i) => ({ text, line: i + 1 }))
        .filter((l) => l.text.includes('target="_blank"'))
        // 파일이 아닌 페이지 링크(LOA 문서 보기 등)는 새 창이 맞다.
        .filter((l) => !/\/loa|APPLY_URL/.test(l.text));
      expect(offenders.map((o) => `${f}:${o.line}`)).toEqual([]);
    }
  });

  it("첨부는 공용 FileLink(= fileLinkProps) 를 거친다", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).toContain("fileLinkProps");
      expect(src, f).toContain("<FileLink");
    }
  });

  it("회사자료 목록이 어드민 검토 화면에 내려온다", () => {
    const page = read("../app/(dash)/onboarding/[customerId]/page.tsx");
    expect(page).toContain("COMPANY_DOCS_FIELD");
    expect(page).toContain("companyDocs={companyDocs}");
    const review = read("../app/(dash)/onboarding/[customerId]/ReviewClient.tsx");
    expect(review).toContain("companyDocs");
    expect(review).toContain("클릭하면 바로 다운로드");
  });

  it("고객 화면 내려받기도 같은 규칙을 쓴다", () => {
    const applyForm = read("../app/apply/ApplyForm.tsx");
    expect(applyForm).toContain("fileDownloadHref(f.url)");
    expect(applyForm).toContain("download={f.filename}");
  });
});
