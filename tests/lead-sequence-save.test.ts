// 연속 안내 저장/조회 버그 — DB 오류를 빈 값으로 숨기지 않는지, 승인 문안이 온전한지.
import { describe, it, expect } from "vitest";
import { seqDbError, SEQ_MIGRATION } from "../lib/lead-sequence";
import { APPROVED_COPY, approvedCopy, CONSULT_URL } from "../lib/lead-sequence-copy";

describe("seqDbError (저장 실패 원인 표시)", () => {
  it("테이블 없음(42P01) → 어떤 마이그레이션을 적용해야 하는지 알려준다", () => {
    const m = seqDbError({ code: "42P01", message: 'relation "lead_sequence_steps" does not exist' });
    expect(m).toContain(SEQ_MIGRATION);
    expect(m).toContain("DB 준비 안 됨");
    expect(m).toContain("lead_sequence_steps");   // 원문도 남긴다
  });
  it("컬럼 없음(42703)도 같은 안내", () => {
    expect(seqDbError({ code: "42703", message: 'column "send_hour" does not exist' })).toContain(SEQ_MIGRATION);
  });
  it("코드 없이 메시지만 있어도 스키마 오류를 알아본다", () => {
    expect(seqDbError(new Error('relation "lead_sequence_config" does not exist'))).toContain(SEQ_MIGRATION);
  });
  it("그 밖의 오류는 원문을 그대로 남긴다(빈 값으로 숨기지 않음)", () => {
    const m = seqDbError({ code: "23505", message: "duplicate key value violates unique constraint" });
    expect(m).toContain("duplicate key");
    expect(m).not.toContain(SEQ_MIGRATION);
  });
});

describe("승인 문안(1~4일차)", () => {
  it("1~4일차만 있고 5일차는 없다(회사소개 단독 발송 제외)", () => {
    expect(APPROVED_COPY.map((c) => c.day_no)).toEqual([1, 2, 3, 4]);
    expect(approvedCopy(5)).toBeUndefined();
  });
  it("모든 회차에 문자·메일 제목·본문이 채워져 있다", () => {
    for (const c of APPROVED_COPY) {
      expect(c.email_subject.trim().length).toBeGreaterThan(0);
      expect(c.email_body.trim().length).toBeGreaterThan(0);
      expect(c.sms_body.trim().length).toBeGreaterThan(0);
    }
  });
  it("모든 회차에 상담 예약 링크가 문자·메일 양쪽에 들어 있다", () => {
    for (const c of APPROVED_COPY) {
      expect(c.email_body).toContain(CONSULT_URL);
      expect(c.sms_body).toContain(CONSULT_URL);
    }
  });
  it("모든 회차에 자료 링크가 들어 있다", () => {
    const material: Record<number, string> = {
      1: "https://glovek.space/guidebook",
      2: "https://app.notion.com/p/Glovek-01-3d7193cdf133809c825bd00acfc9f79b?source=copy_link",
      3: "https://app.notion.com/p/Glovek-02-120-15-600-3d7193cdf13380b1aec6e946cca3503f?source=copy_link",
      4: "https://glovek.space/tts/qna",
    };
    for (const c of APPROVED_COPY) {
      expect(c.email_body).toContain(material[c.day_no]);
      expect(c.sms_body).toContain(material[c.day_no]);
    }
  });
  it("줄바꿈이 보존돼 있다", () => {
    for (const c of APPROVED_COPY) {
      expect(c.email_body.split("\n").length).toBeGreaterThan(5);
      expect(c.sms_body.split("\n").length).toBeGreaterThan(3);
    }
  });
  it("인사에 치환변수를 쓰지 않는다 — 브랜드명 없는 리드도 있으므로", () => {
    for (const c of APPROVED_COPY) {
      expect(c.email_subject).not.toMatch(/\{[^}]+\}/);
      expect(c.email_body).not.toMatch(/\{[^}]+\}/);
      expect(c.sms_body).not.toMatch(/\{[^}]+\}/);
    }
  });
});
