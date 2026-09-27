// PM AI 단계 — 근거 ID 검증, 허위 AI 표시 방지, 지시 실행 금지.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildEvidence, validateAi, aiSuggestions, AI_MAX_EVIDENCE, AI_MAX_SUGGESTIONS } from "../lib/pm-ai";

const item = (i: number, body = `본문 ${i}`) => ({
  id: `email-${i}`, channelLabel: "이메일", occurredAt: `2026-09-2${i}T01:00:00Z`,
  title: `제목 ${i}`, bodyFull: body,
});

describe("근거 묶기", () => {
  it("개수 상한을 넘기지 않는다", () => {
    const ev = buildEvidence(Array.from({ length: 30 }, (_, i) => item(i)));
    expect(ev.length).toBe(AI_MAX_EVIDENCE);
    expect(ev[0].ref).toBe("e1");
  });
  it("본문을 잘라 총량을 묶는다", () => {
    const ev = buildEvidence([item(1, "가".repeat(5000))]);
    expect(ev[0].body.length).toBeLessThanOrEqual(1500);
  });
  it("원문 레코드 id 를 근거로 함께 들고 간다", () => {
    expect(buildEvidence([item(7)])[0].sourceId).toBe("email-7");
  });
});

describe("모델 응답 검증 — 근거 없는 제안은 버린다", () => {
  const ev = buildEvidence([item(1), item(2)]);

  it("우리가 보낸 ref 만 인정한다", () => {
    const r = validateAi({ suggestions: [
      { kind: "todo", title: "정상", priority: 2, evidence_ref: "e1" },
      { kind: "todo", title: "없는 근거", priority: 2, evidence_ref: "e99" },
    ] }, ev);
    expect(r.suggestions).toHaveLength(1);
    expect(r.rejected).toBe(1);
    expect(r.suggestions[0].evidenceId).toBe("email-1");
  });

  it("근거 없는 제안(ref 누락)은 버린다", () => {
    const r = validateAi({ suggestions: [{ kind: "issue", title: "근거 없음", priority: 1 }] }, ev);
    expect(r.suggestions).toHaveLength(0);
    expect(r.rejected).toBe(1);
  });

  it("유형·우선순위가 틀리면 버린다", () => {
    const r = validateAi({ suggestions: [
      { kind: "hack", title: "나쁜 유형", priority: 1, evidence_ref: "e1" },
      { kind: "todo", title: "나쁜 우선순위", priority: 9, evidence_ref: "e1" },
      { kind: "todo", title: "", priority: 1, evidence_ref: "e1" },
    ] }, ev);
    expect(r.suggestions).toHaveLength(0);
    expect(r.rejected).toBe(3);
  });

  it("같은 근거는 하나만 — 유형이 달라도 합쳐진다(반복 실행에 불어나지 않는다)", () => {
    const r = validateAi({ suggestions: [
      { kind: "todo", title: "첫째", priority: 2, evidence_ref: "e1" },
      { kind: "todo", title: "둘째", priority: 2, evidence_ref: "e1" },
    ] }, ev);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].dedupeKey).toBe("ai:email-1");
  });

  it("키에 유형을 넣지 않는다 — 같은 원문을 다른 유형으로 재분류해도 중복이 안 생긴다", () => {
    const a = validateAi({ suggestions: [{ kind: "todo", title: "x", priority: 2, evidence_ref: "e1" }] }, ev);
    const b = validateAi({ suggestions: [{ kind: "issue", title: "y", priority: 1, evidence_ref: "e1" }] }, ev);
    expect(a.suggestions[0].dedupeKey).toBe(b.suggestions[0].dedupeKey);
    expect(a.suggestions[0].dedupeKey).not.toMatch(/:(todo|issue|question)$/);
  });

  it("한 응답에서 같은 원문을 두 유형으로 주면 하나만 받는다", () => {
    const r = validateAi({ suggestions: [
      { kind: "todo", title: "a", priority: 2, evidence_ref: "e1" },
      { kind: "issue", title: "b", priority: 1, evidence_ref: "e1" },
    ] }, ev);
    expect(r.suggestions).toHaveLength(1);
    expect(r.rejected).toBe(1);
  });

  it("제안 개수 상한을 넘기지 않는다", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: "todo", title: `t${i}`, priority: 2, evidence_ref: i % 2 ? "e1" : "e2" }));
    const r = validateAi({ suggestions: many }, ev);
    expect(r.suggestions.length).toBeLessThanOrEqual(AI_MAX_SUGGESTIONS);
  });

  it("담당자·기한 필드는 아예 만들지 않는다", () => {
    const r = validateAi({ suggestions: [
      { kind: "todo", title: "x", priority: 2, evidence_ref: "e1", owner: "someone@x.kr", due_date: "2026-01-01" },
    ] }, ev);
    expect(Object.keys(r.suggestions[0])).not.toContain("owner");
    expect(Object.keys(r.suggestions[0])).not.toContain("dueDate");
    expect(JSON.stringify(r.suggestions[0])).not.toContain("someone@x.kr");
  });

  it("응답이 배열이 아니면 아무 것도 만들지 않는다", () => {
    expect(validateAi({}, ev).suggestions).toHaveLength(0);
    expect(validateAi(null, ev).suggestions).toHaveLength(0);
    expect(validateAi({ suggestions: "nope" }, ev).suggestions).toHaveLength(0);
  });

  it("제안 본문에 근거 출처를 함께 적는다", () => {
    const r = validateAi({ suggestions: [{ kind: "issue", title: "x", detail: "설명", priority: 1, evidence_ref: "e2" }] }, ev);
    expect(r.suggestions[0].detail).toContain("근거:");
    expect(r.suggestions[0].evidenceLabel).toContain("이메일");
  });
});

describe("AI 호출 — 키 없거나 실패하면 AI 라고 하지 않는다", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => { if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev; });

  it("키가 없으면 ok:false 와 사유를 돌려준다", async () => {
    const r = await aiSuggestions({ brandName: "브랜드", evidence: buildEvidence([item(1)]) });
    expect(r.ok).toBe(false);
    expect(r.suggestions).toHaveLength(0);
    expect(r.note).toContain("AI 키");
  });

  it("보낼 근거가 없으면 호출하지 않는다", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const r = await aiSuggestions({ brandName: "브랜드", evidence: [] });
    expect(r.ok).toBe(false);
    expect(r.note).toContain("근거가 없");
  });
});
