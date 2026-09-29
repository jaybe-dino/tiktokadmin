// BUG-43~46 회귀.
import { describe, it, expect } from "vitest";
import { SOURCE_GROUPS, SOURCE_LABELS, SOURCES, sourceGroup } from "../lib/types";
import { LOGISTICS_OPTIONS, LOGISTICS_LABELS, CROSS_BORDER_LABEL } from "../lib/onboarding";
import { geminiReason, httpError } from "../lib/image-translate";
import { readFileSync } from "node:fs";

describe("BUG-43 · 세미나 리드를 한 번에 본다", () => {
  it("세미나 묶음이 두 갈래 소스를 모두 포함한다", () => {
    expect(sourceGroup("group_seminar")).toEqual(["apply_seminar", "tp_seminar"]);
  });
  it("묶음에 든 소스는 실제 소스 목록에 있는 값이다", () => {
    for (const s of SOURCE_GROUPS.group_seminar.sources) {
      expect(SOURCES as readonly string[], s).toContain(s);
      expect(SOURCE_LABELS[s]).toBeTruthy();
    }
  });
  it("일반 소스는 묶음이 아니다(기존 단일 필터 그대로)", () => {
    expect(sourceGroup("apply_seminar")).toBeNull();
    expect(sourceGroup("")).toBeNull();
    expect(sourceGroup(undefined)).toBeNull();
    expect(sourceGroup("없는값")).toBeNull();
  });
  it("목록 조회가 묶음이면 ANY, 아니면 단일 비교를 쓴다", () => {
    const src = readFileSync(new URL("../lib/repo/queries.ts", import.meta.url), "utf8");
    expect(src).toContain("b.source = ANY(");
    expect(src).toContain("sourceGroup(f.source)");
  });
});

describe("BUG-44 · 상세페이지 영문 칸", () => {
  const form = readFileSync(new URL("../app/apply/ApplyForm.tsx", import.meta.url), "utf8");
  it("영문 칸과 안내 문구가 있다", () => {
    expect(form).toContain("상세페이지(영문)");
    expect(form).toContain("영문이 있으면 영문으로 부탁드립니다");
  });
  it("한글 칸은 그대로 남아 있다", () => {
    expect(form).toContain("상세페이지(한글)");
    expect(form).toContain("detail_page_kr");
  });
  it("업로드 필드 키가 언어별로 달라 서로 덮어쓰지 않는다", () => {
    expect(form).toContain("`detail_en_${country}`");
    expect(form).toContain("`detail_${country}`");
  });
  it("저장 쿼리에 영문 컬럼이 들어간다", () => {
    const onb = readFileSync(new URL("../lib/onboarding.ts", import.meta.url), "utf8");
    expect(onb).toContain("detail_page_en");
  });
  it("마이그레이션이 추가만 한다(기존 컬럼 변경 없음)", () => {
    const sql = readFileSync(new URL("../migrations/0100_apply_form_fields.sql", import.meta.url), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS detail_page_en");
    expect(sql).not.toMatch(/DROP |ALTER COLUMN |TRUNCATE|DELETE FROM/i);
  });
});

describe("BUG-45 · 크로스보더 범위 표기 · FBT 체크", () => {
  it("크로스보더 라벨에 동남아시아만 해당이 적힌다", () => {
    expect(CROSS_BORDER_LABEL).toContain("동남아시아만 해당");
    expect(LOGISTICS_LABELS.cross_border).toBe(CROSS_BORDER_LABEL);
    expect(LOGISTICS_OPTIONS.find(([v]) => v === "cross_border")?.[1]).toBe(CROSS_BORDER_LABEL);
  });
  it("다른 물류 방식 라벨은 바뀌지 않았다", () => {
    expect(LOGISTICS_LABELS.fba).toBe("FBA (아마존 물류)");
    expect(LOGISTICS_LABELS.local_warehouse).toBe("현지 물류창고 계약");
  });
  it("신청 폼에도 같은 표기와 FBT 체크란이 있다", () => {
    const form = readFileSync(new URL("../app/apply/ApplyForm.tsx", import.meta.url), "utf8");
    expect(form).toContain("동남아시아만 해당");
    expect(form).toContain("FBT(Fulfilled by TikTok)");
    expect(form).toContain("setCountryFbtInterestAction");
  });
  it("FBT 저장 실패를 성공으로 표시하지 않는다", () => {
    const onb = readFileSync(new URL("../lib/onboarding.ts", import.meta.url), "utf8");
    expect(onb).toContain("마이그레이션 0100 적용 필요");
  });
  it("마이그레이션이 기본값을 두어 기존 행을 깨지 않는다", () => {
    const sql = readFileSync(new URL("../migrations/0100_apply_form_fields.sql", import.meta.url), "utf8");
    expect(sql).toContain("fbt_interest boolean NOT NULL DEFAULT false");
  });
});

describe("BUG-46 · 번역 실패 사유를 알 수 있게", () => {
  const err = (status: number, body: string) =>
    httpError(Object.assign(new Error(`HTTP ${status}`), { status, body }));

  it("401·403 은 키·권한 문제로 안내한다", () => {
    expect(err(401, "").error).toContain("인증 실패");
    expect(err(403, "").error).toContain("권한 거부");
  });
  it("404 는 모델 문제로 안내한다 — 예전엔 원인을 알 수 없었다", () => {
    const e = err(404, JSON.stringify({ error: { status: "NOT_FOUND", message: "models/gemini-3-pro-image-preview is not found" } }));
    expect(e.error).toContain("모델을 찾을 수 없습니다");
    expect(e.error).toContain("gemini-3-pro-image-preview");
  });
  it("429 는 한도 초과로 구분한다", () => {
    expect(err(429, "").error).toContain("한도 초과");
  });
  it("Google 이 준 사유를 함께 보여준다", () => {
    const e = err(403, JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Generative Language API has not been used" } }));
    expect(e.error).toContain("PERMISSION_DENIED");
    expect(e.error).toContain("Generative Language API");
  });
  it("오류 문구에 API 키가 섞여 나오지 않는다", () => {
    const leak = JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API key AIzaSyA1234567890abcdefg is invalid" } });
    const e = err(400, leak);
    expect(e.error).not.toContain("AIzaSyA1234567890abcdefg");
    expect(e.error).toContain("[키생략]");
    expect(geminiReason(leak)).not.toContain("AIzaSyA1234567890abcdefg");
  });
  it("상태코드가 없으면 원인 메시지를 남긴다", () => {
    expect(httpError(new Error("connect ETIMEDOUT")).error).toContain("ETIMEDOUT");
    expect(httpError(new Error("The operation was aborted")).error).toContain("시간 초과");
  });
  it("JSON 이 아닌 본문도 안전하게 다룬다", () => {
    expect(geminiReason("<html>502</html>")).toContain("502");
    expect(geminiReason("")).toBe("");
  });
});
