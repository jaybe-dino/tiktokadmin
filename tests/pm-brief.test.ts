// PM 1차 확장 — 순수 계산(분류·차이·버킷·요약·계약 대조·추출 검증).
import { describe, it, expect } from "vitest";
import {
  KPI_KINDS, KPI_KIND_LABEL, AGREEMENTS, TERM_KINDS, EXTRACT_KINDS,
  kpiGap, periodLabel, pickKeyKpis, taskBuckets, pickTop3, pickBlockers, pickAwaiting,
  buildHeaderSummary, checkAgainstTerms, validateExtractions, weekEnd, dayDiff,
  taskKeyForExtraction,
  type BriefKpi, type BriefTask, type BriefExtraction, type TermForCheck, type ExtractEvidence,
} from "../lib/pm-brief";

const kpi = (o: Partial<BriefKpi> = {}): BriefKpi => ({
  id: "k1", name: "월 GMV", unit: "원", kind: "internal", agreement: "agreed",
  target: 100, current: 40, measuredAt: "2026-09-30", direction: "up",
  periodStart: "2026-09-01", periodEnd: "2026-09-30", owner: "a@b.c",
  sourceQuote: "", evidenceLabel: "", status: "active", ...o,
});
const task = (o: Partial<BriefTask> = {}): BriefTask => ({
  id: "t1", kind: "todo", title: "업무", priority: 2, owner: "a@b.c",
  dueDate: "2026-10-01", status: "open", waitingOn: "none", origin: "human",
  confirmedBy: "a@b.c", kpiId: null, ...o,
});
const ext = (o: Partial<BriefExtraction> = {}): BriefExtraction => ({
  id: "e1", kind: "question", title: "질문", contractCheck: "unknown", status: "new",
  occurredAt: "2026-09-28T01:00:00Z", sourceAuthor: "고객", evidenceLabel: "카톡", hasReplyDraft: false, ...o,
});

describe("분류 라벨", () => {
  it("KPI 는 계약 의무·브랜드 기대·내부 실행으로 나뉜다", () => {
    expect(KPI_KINDS).toEqual(["contract", "expectation", "internal"]);
    expect(KPI_KIND_LABEL.contract).toBe("계약 의무");
    expect(KPI_KIND_LABEL.expectation).toBe("브랜드 기대");
    expect(KPI_KIND_LABEL.internal).toBe("내부 실행");
  });
  it("합의 상태에 후보·제안·기대·합의가 모두 있다", () => {
    expect(AGREEMENTS).toEqual(["candidate", "proposed", "expected", "agreed"]);
  });
  it("계약 조건 종류와 추출 종류가 요청과 맞는다", () => {
    expect(TERM_KINDS).toEqual(["scope", "quantity", "period", "exclusion", "cooperation"]);
    expect(EXTRACT_KINDS).toEqual(["question", "request", "promise", "decision", "open"]);
  });
});

describe("KPI 차이 — 미확인을 0 으로 적지 않는다", () => {
  it("현재값이 없으면 차이도 null 이다", () => {
    expect(kpiGap(kpi({ current: null }))).toBeNull();
    expect(kpiGap(kpi({ target: null }))).toBeNull();
  });
  it("실제 0 은 0 으로 계산한다(미확인과 구분)", () => {
    expect(kpiGap(kpi({ current: 0, target: 100 }))).toBe(100);
  });
  it("역방향 지표는 부호가 뒤집힌다", () => {
    expect(kpiGap(kpi({ direction: "down", target: 10, current: 25 }))).toBe(15);
    expect(kpiGap(kpi({ direction: "down", target: 10, current: 5 }))).toBe(-5);
  });
  it("기간 표기는 한쪽만 있어도 보여준다", () => {
    expect(periodLabel({ periodStart: null, periodEnd: null })).toBe("기간 미정");
    expect(periodLabel({ periodStart: null, periodEnd: "2026-10-31" })).toBe("~ 2026-10-31");
    expect(periodLabel({ periodStart: "2026-10-01", periodEnd: null })).toBe("2026-10-01 ~");
  });
});

describe("핵심 KPI 고르기", () => {
  it("계약 의무 → 브랜드 기대 → 내부 실행 순", () => {
    const out = pickKeyKpis([
      kpi({ id: "i", kind: "internal" }), kpi({ id: "c", kind: "contract" }), kpi({ id: "e", kind: "expectation" }),
    ]);
    expect(out.map((k) => k.id)).toEqual(["c", "e", "i"]);
  });
  it("같은 분류에서는 합의된 것이 먼저, 그 뒤 기한 순", () => {
    const out = pickKeyKpis([
      kpi({ id: "cand", kind: "contract", agreement: "candidate" }),
      kpi({ id: "late", kind: "contract", periodEnd: "2026-12-31" }),
      kpi({ id: "soon", kind: "contract", periodEnd: "2026-10-05" }),
    ]);
    expect(out.map((k) => k.id)).toEqual(["soon", "late", "cand"]);
  });
  it("보관된 KPI 는 올리지 않는다", () => {
    expect(pickKeyKpis([kpi({ status: "archived" })])).toEqual([]);
  });
});

describe("업무 버킷", () => {
  const today = "2026-10-01";
  it("주 마지막 날은 일요일이다", () => {
    expect(weekEnd("2026-10-01")).toBe("2026-10-04");   // 목 → 일
    expect(weekEnd("2026-10-04")).toBe("2026-10-04");   // 일 → 그날
    expect(weekEnd("2026-10-05")).toBe("2026-10-11");   // 월 → 일
  });
  it("오늘·이번주·지연을 나눈다", () => {
    const b = taskBuckets([
      task({ id: "od", dueDate: "2026-09-30" }),
      task({ id: "td", dueDate: today }),
      task({ id: "wk", dueDate: "2026-10-03" }),
      task({ id: "later", dueDate: "2026-10-20" }),
    ], today);
    expect(b.overdue.map((t) => t.id)).toEqual(["od"]);
    expect(b.today.map((t) => t.id)).toEqual(["td"]);
    expect(b.week.map((t) => t.id)).toEqual(["wk"]);
  });
  it("대기 중인 업무는 오늘/이번주에서 빼고 대기 칸에만 둔다", () => {
    const b = taskBuckets([
      task({ id: "c", dueDate: today, waitingOn: "customer" }),
      task({ id: "i", dueDate: "2026-10-03", waitingOn: "internal" }),
    ], today);
    expect(b.today).toEqual([]);
    expect(b.week).toEqual([]);
    expect(b.waitingCustomer.map((t) => t.id)).toEqual(["c"]);
    expect(b.waitingInternal.map((t) => t.id)).toEqual(["i"]);
  });
  it("대기라도 기한이 지나면 지연으로 센다", () => {
    const b = taskBuckets([task({ id: "x", dueDate: "2026-09-20", waitingOn: "customer" })], today);
    expect(b.overdue.map((t) => t.id)).toEqual(["x"]);
  });
  it("닫힌 업무는 버킷에 들어오지 않는다", () => {
    const b = taskBuckets([task({ status: "done", dueDate: "2026-09-01" })], today);
    expect(b.overdue).toEqual([]);
  });
  it("담당 미배정을 따로 센다", () => {
    const b = taskBuckets([task({ owner: null })], today);
    expect(b.unassigned).toHaveLength(1);
  });
});

describe("지금 할 일 3개", () => {
  const today = "2026-10-01";
  it("지연 → 오늘 → 이번주 순으로 3개만", () => {
    const out = pickTop3([
      task({ id: "w", dueDate: "2026-10-03" }),
      task({ id: "o1", dueDate: "2026-09-29", priority: 1 }),
      task({ id: "t", dueDate: today }),
      task({ id: "o2", dueDate: "2026-09-30", priority: 3 }),
    ], today);
    expect(out.map((t) => t.id)).toEqual(["o1", "o2", "t"]);
  });
  it("대기 중인 업무는 올리지 않는다", () => {
    const out = pickTop3([task({ id: "c", dueDate: "2026-09-01", waitingOn: "customer" })], today);
    expect(out).toEqual([]);
  });
  it("마감이 없어도 열린 업무는 채워 넣는다", () => {
    const out = pickTop3([task({ id: "n", dueDate: null })], today);
    expect(out.map((t) => t.id)).toEqual(["n"]);
  });
});

describe("장애물", () => {
  const today = "2026-10-01";
  it("계약 충돌·인식 불일치를 가장 위에 올린다", () => {
    const out = pickBlockers({
      kpis: [], tasks: [], today,
      extractions: [ext({ contractCheck: "conflict", title: "추가 촬영 요청" })],
      contractDisputes: [{ id: "d1", label: "월 라이브 횟수" }],
    });
    expect(out[0].severity).toBe(1);
    expect(out.map((b) => b.label).join(" ")).toContain("계약");
  });
  it("KPI 미확정과 계약 실적 미확인을 장애물로 든다", () => {
    const out = pickBlockers({
      kpis: [kpi({ id: "c1", agreement: "candidate", name: "월 시딩" }),
             kpi({ id: "c2", kind: "contract", current: null, name: "월 라이브" })],
      tasks: [], extractions: [], contractDisputes: [], today,
    });
    const text = out.map((b) => b.label).join(" ");
    expect(text).toContain("KPI 미확정");
    expect(text).toContain("실적 미확인");
    expect(out.find((b) => b.label.includes("실적 미확인"))!.reason).toContain("0 으로 보지 않습니다");
  });
  it("근거 없는 장애물은 만들지 않는다(입력이 비면 빈 목록)", () => {
    expect(pickBlockers({ kpis: [], tasks: [], extractions: [], contractDisputes: [], today })).toEqual([]);
  });
  it("처리된 추출은 장애물로 남지 않는다", () => {
    const out = pickBlockers({
      kpis: [], tasks: [], contractDisputes: [], today,
      extractions: [ext({ contractCheck: "conflict", status: "dismissed" })],
    });
    expect(out).toEqual([]);
  });
});

describe("답변대기", () => {
  it("고객 대기·내부 대기·미응답 질문을 모은다", () => {
    const out = pickAwaiting({
      tasks: [task({ id: "c", waitingOn: "customer" }), task({ id: "i", waitingOn: "internal" })],
      extractions: [ext({ id: "q", kind: "question", status: "new" })],
    });
    expect(out.filter((x) => x.who === "customer").length).toBe(2);
    expect(out.filter((x) => x.who === "internal").length).toBe(1);
  });
  it("이미 답한 질문은 대기에서 빠진다", () => {
    const out = pickAwaiting({ tasks: [], extractions: [ext({ status: "answered" })] });
    expect(out).toEqual([]);
  });
  it("결정·약속은 답변대기가 아니다", () => {
    const out = pickAwaiting({ tasks: [], extractions: [ext({ kind: "decision" }), ext({ kind: "promise" })] });
    expect(out).toEqual([]);
  });
});

describe("상단 요약", () => {
  it("기준 시각과 수집 범위를 함께 담는다", () => {
    const s = buildHeaderSummary({
      kpis: [kpi()], tasks: [task()], extractions: [], contractDisputes: [],
      caveats: ["카카오톡: 자동 수집 미연결(수동 등록만)"], today: "2026-10-01", asOf: "2026-10-01T00:00:00Z",
    });
    expect(s.asOf).toBe("2026-10-01T00:00:00Z");
    expect(s.caveats[0]).toContain("미연결");
    expect(s.counts.openTasks).toBe(1);
  });
  it("미확정 KPI 수를 따로 센다", () => {
    const s = buildHeaderSummary({
      kpis: [kpi({ agreement: "candidate" }), kpi({ id: "k2" })],
      tasks: [], extractions: [], contractDisputes: [], today: "2026-10-01",
    });
    expect(s.counts.unconfirmedKpis).toBe(1);
  });
});

describe("계약 대조", () => {
  const terms: TermForCheck[] = [
    { id: "t1", kind: "quantity", label: "월 시딩 20건", detail: "시딩 콘텐츠", quantity: 20, unit: "건", status: "agreed" },
    { id: "t2", kind: "exclusion", label: "영상 촬영 제작", detail: "촬영은 제외", quantity: null, unit: "", status: "agreed" },
  ];
  it("제외 항목과 겹치면 충돌이다", () => {
    const r = checkAgainstTerms("영상 촬영 추가로 해주실 수 있나요?", terms);
    expect(r.check).toBe("conflict");
    expect(r.termId).toBe("t2");
  });
  it("확정 조건과 맞으면 범위 안이다", () => {
    const r = checkAgainstTerms("이번 달 시딩 콘텐츠 일정 공유 부탁드립니다", terms);
    expect(r.check).toBe("within");
    expect(r.termId).toBe("t1");
  });
  it("인식 불일치 조건에 걸리면 충돌로 본다", () => {
    const r = checkAgainstTerms("라이브 횟수 확인", [
      { id: "d", kind: "quantity", label: "라이브 횟수", detail: "", quantity: null, unit: "", status: "disputed" },
    ]);
    expect(r.check).toBe("conflict");
  });
  it("확정 조건이 없으면 단정하지 않고 대조 불가로 둔다", () => {
    const r = checkAgainstTerms("무엇이든", [
      { id: "c", kind: "scope", label: "후보", detail: "", quantity: null, unit: "", status: "candidate" },
    ]);
    expect(r.check).toBe("unknown");
    expect(r.note).toContain("대조할 수 없습니다");
  });
  it("맞는 조건을 못 찾아도 범위 밖이라 단정하지 않는다", () => {
    const r = checkAgainstTerms("전혀 관계없는 잡담", terms);
    expect(r.check).toBe("unknown");
    expect(r.note).toContain("담당 확인");
  });
  it("빈 내용은 대조하지 않는다", () => {
    expect(checkAgainstTerms("   ", terms).check).toBe("unknown");
  });
});

describe("AI 추출 검증", () => {
  const ev: ExtractEvidence[] = [
    { ref: "e1", sourceId: "m1", channel: "카카오톡", at: "2026-09-28 10:00", author: "고객", title: "문의", body: "인증 서류 언제까지 주시면 되나요? 다음주 월요일까지 필요합니다." },
    { ref: "e2", sourceId: "m2", channel: "메일", at: "2026-09-29 09:00", author: "우리", title: "회신", body: "촬영 일정은 내부 확인 후 회신드리겠습니다." },
  ];
  it("근거 ref 를 가리키지 않으면 버린다", () => {
    const r = validateExtractions({ items: [{ kind: "question", title: "질문", evidence_ref: "" }] }, ev);
    expect(r.items).toEqual([]);
    expect(r.rejected).toBe(1);
  });
  it("우리가 보내지 않은 ref 는 통하지 않는다", () => {
    const r = validateExtractions({ items: [{ kind: "question", title: "질문", evidence_ref: "e9" }] }, ev);
    expect(r.items).toEqual([]);
  });
  it("종류가 허용 목록에 없으면 버린다", () => {
    const r = validateExtractions({ items: [{ kind: "complaint", title: "x", evidence_ref: "e1" }] }, ev);
    expect(r.items).toEqual([]);
  });
  it("본문에 없는 인용은 버린다(지어낸 인용 차단)", () => {
    const r = validateExtractions({
      items: [{ kind: "question", title: "질문", evidence_ref: "e1", quote: "계약을 해지하겠습니다" }],
    }, ev);
    expect(r.items).toEqual([]);
    expect(r.rejected).toBe(1);
  });
  it("본문에 있는 인용은 통과한다", () => {
    const r = validateExtractions({
      items: [{ kind: "question", title: "인증 서류 기한", evidence_ref: "e1", quote: "인증 서류 언제까지 주시면 되나요?", reply_draft: "확인 후 회신드리겠습니다.", internal_checks: "인증 담당 확인" }],
    }, ev);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].author).toBe("고객");
    expect(r.items[0].sourceId).toBe("m1");
    expect(r.items[0].dedupeKey).toBe("ai:m1:question");
  });
  it("같은 근거·같은 종류는 한 건으로 묶는다", () => {
    const r = validateExtractions({
      items: [
        { kind: "question", title: "첫째", evidence_ref: "e1" },
        { kind: "question", title: "둘째", evidence_ref: "e1" },
      ],
    }, ev);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].title).toBe("첫째");
    expect(r.rejected).toBe(1);
  });
  it("같은 근거의 다른 종류는 따로 남는다", () => {
    const r = validateExtractions({
      items: [
        { kind: "question", title: "질문", evidence_ref: "e1" },
        { kind: "request", title: "요청", evidence_ref: "e1" },
      ],
    }, ev);
    expect(r.items).toHaveLength(2);
  });
  it("깨진 응답에도 예외를 던지지 않는다", () => {
    expect(validateExtractions(null, ev).items).toEqual([]);
    expect(validateExtractions({ items: "nope" }, ev).items).toEqual([]);
  });
  it("추출에서 만든 업무 키는 추출 1건당 1개다", () => {
    expect(taskKeyForExtraction("x1")).toBe("ext:x1");
    expect(taskKeyForExtraction("x1")).toBe(taskKeyForExtraction("x1"));
  });
});

describe("날짜 보조", () => {
  it("일수 차이를 센다", () => {
    expect(dayDiff("2026-10-01", "2026-10-05")).toBe(4);
    expect(dayDiff("2026-10-05", "2026-10-01")).toBe(-4);
  });
});
