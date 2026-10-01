// PM 규칙 점검·KPI 계산 — DB 없는 순수 로직.
import { describe, it, expect } from "vitest";
import { kpiProgress, kpiRisk, rulesSuggestions, nextActionLine, dayDiff, type PmFacts } from "../lib/pm-analyze";

const base = (over: Partial<PmFacts> = {}): PmFacts => ({
  brandId: "b1", brandName: "예시브랜드", state: "onboarding", today: "2026-09-27",
  lastContactAt: "2026-09-26T00:00:00Z",
  lastRecordAt: null, lastRecordKind: null, lastRecordChannel: null,
  channelErrors: [], channelsNotConnected: ["Slack", "카카오톡"],
  commCount: 5, kpis: [], openTasks: [], meetingsWithoutTranscript: [], ...over,
});

describe("KPI 달성률 — 값 없음과 0 을 구분한다", () => {
  it("목표가 없으면 null(0% 아님)", () => {
    expect(kpiProgress({ target: null, current: 50, direction: "up" })).toBeNull();
  });
  it("현재값이 없으면 null", () => {
    expect(kpiProgress({ target: 100, current: null, direction: "up" })).toBeNull();
  });
  it("현재값 0 은 실제 0% 로 계산한다", () => {
    expect(kpiProgress({ target: 100, current: 0, direction: "up" })).toBe(0);
  });
  it("목표가 0 이면 비율을 정의하지 않는다", () => {
    expect(kpiProgress({ target: 0, current: 5, direction: "up" })).toBeNull();
  });
  it("역방향 지표는 목표 이하일 때 100%", () => {
    expect(kpiProgress({ target: 3, current: 2, direction: "down" })).toBe(100);
    expect(kpiProgress({ target: 3, current: 3, direction: "down" })).toBe(100);
  });
  it("역방향 지표가 목표를 넘으면 깎인다", () => {
    const p = kpiProgress({ target: 3, current: 6, direction: "down" });
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(100);
    expect(p!).toBeGreaterThanOrEqual(0);
  });
});

describe("KPI 위험 판정", () => {
  const t = "2026-09-27";
  it("목표 없으면 unknown", () => {
    expect(kpiRisk({ target: null, current: 1, measuredAt: t, periodEnd: null, direction: "up", today: t })).toBe("unknown");
  });
  it("측정값·측정일 없으면 no_measure", () => {
    expect(kpiRisk({ target: 10, current: null, measuredAt: null, periodEnd: null, direction: "up", today: t })).toBe("no_measure");
    expect(kpiRisk({ target: 10, current: 5, measuredAt: null, periodEnd: null, direction: "up", today: t })).toBe("no_measure");
  });
  it("기한이 지났고 목표 미달이면 overdue", () => {
    expect(kpiRisk({ target: 10, current: 4, measuredAt: t, periodEnd: "2026-09-20", direction: "up", today: t })).toBe("overdue");
  });
  it("기한이 지났지만 목표를 채웠으면 on_track", () => {
    expect(kpiRisk({ target: 10, current: 10, measuredAt: t, periodEnd: "2026-09-20", direction: "up", today: t })).toBe("on_track");
  });
  it("기한 내 70% 미만이면 at_risk", () => {
    expect(kpiRisk({ target: 10, current: 5, measuredAt: t, periodEnd: "2026-12-31", direction: "up", today: t })).toBe("at_risk");
  });
  it("역방향 지표도 목표 이하면 정상", () => {
    expect(kpiRisk({ target: 3, current: 1, measuredAt: t, periodEnd: "2026-12-31", direction: "down", today: t })).toBe("on_track");
  });
  it("날짜 차이는 일 단위로 센다", () => {
    expect(dayDiff("2026-09-27", "2026-09-20")).toBe(7);
  });
});

describe("규칙 점검 — 근거 없는 사실을 만들지 않는다", () => {
  it("채널 조회 실패는 그 사실 자체를 문제로 올린다", () => {
    const out = rulesSuggestions(base({ channelErrors: ["이메일(Gmail 수집)"] }));
    const hit = out.find((s) => s.dedupeKey.startsWith("rules:channel_error"));
    expect(hit).toBeTruthy();
    expect(hit!.kind).toBe("issue");
    expect(hit!.detail).toContain("완전하지 않");
  });

  it("대화 0건은 '수집 미연결'을 함께 알린다 — 대화 없음으로 단정하지 않는다", () => {
    const out = rulesSuggestions(base({ commCount: 0 }));
    const hit = out.find((s) => s.dedupeKey === "rules:no_comms");
    expect(hit).toBeTruthy();
    expect(hit!.detail).toContain("Slack");
  });

  it("조회 실패가 있으면 '대화 0건' 제안을 만들지 않는다(오판 방지)", () => {
    const out = rulesSuggestions(base({ commCount: 0, channelErrors: ["이메일"] }));
    expect(out.find((s) => s.dedupeKey === "rules:no_comms")).toBeUndefined();
  });

  it("마지막 접촉이 없으면 일수를 만들어 내지 않는다", () => {
    const out = rulesSuggestions(base({ lastContactAt: null }));
    const hit = out.find((s) => s.dedupeKey === "rules:no_contact_record");
    expect(hit).toBeTruthy();
    expect(out.find((s) => s.dedupeKey === "rules:stale_contact")).toBeUndefined();
  });

  it("접촉 공백은 실제 기록 날짜로만 계산한다", () => {
    const out = rulesSuggestions(base({ lastContactAt: "2026-09-01T00:00:00Z" }));
    const hit = out.find((s) => s.dedupeKey === "rules:stale_contact");
    expect(hit).toBeTruthy();
    expect(hit!.title).toContain("26일");
    expect(hit!.detail).toContain("2026-09-01");
  });

  it("최근 접촉이 있으면 접촉 제안이 없다", () => {
    expect(rulesSuggestions(base()).find((s) => s.dedupeKey === "rules:stale_contact")).toBeUndefined();
  });

  it("KPI 상태별로 다른 제안을 만든다", () => {
    const out = rulesSuggestions(base({
      kpis: [
        { id: "k1", name: "목표없음", unit: "", target: null, current: 1, measuredAt: null, direction: "up", periodEnd: null, owner: null },
        { id: "k2", name: "미측정", unit: "건", target: 10, current: null, measuredAt: null, direction: "up", periodEnd: null, owner: null },
        { id: "k3", name: "위험", unit: "만원", target: 100, current: 10, measuredAt: "2026-09-20", direction: "up", periodEnd: "2026-12-31", owner: null },
      ],
    }));
    expect(out.find((s) => s.dedupeKey === "rules:kpi_no_target:k1")?.kind).toBe("question");
    expect(out.find((s) => s.dedupeKey === "rules:kpi_no_measure:k2")?.kind).toBe("todo");
    const risk = out.find((s) => s.dedupeKey === "rules:kpi_risk:k3");
    expect(risk?.kind).toBe("issue");
    expect(risk!.detail).toContain("목표 100만원");    // 입력 값만 인용
  });

  it("지연·미배정 업무를 각각 올린다(사람이 확정한 업무만)", () => {
    const out = rulesSuggestions(base({
      openTasks: [{ id: "t1", title: "서류 요청", dueDate: "2026-09-20", owner: null, status: "open", confirmed: true }],
    }));
    expect(out.find((s) => s.dedupeKey === "rules:task_overdue:t1")).toBeTruthy();
    expect(out.find((s) => s.dedupeKey === "rules:task_no_owner:t1")).toBeTruthy();
  });

  it("미확정 제안은 위생 점검 대상이 아니다 — 제안이 제안을 낳지 않는다", () => {
    const out = rulesSuggestions(base({
      openTasks: [{ id: "s1", title: "규칙이 만든 제안", dueDate: "2026-09-20", owner: null, status: "open", confirmed: false }],
    }));
    expect(out.find((s) => s.dedupeKey === "rules:task_overdue:s1")).toBeUndefined();
    expect(out.find((s) => s.dedupeKey === "rules:task_no_owner:s1")).toBeUndefined();
  });

  it("같은 입력이면 같은 dedupeKey — 반복 실행에 중복이 생기지 않는다", () => {
    const f = base({ lastContactAt: "2026-08-01T00:00:00Z" });
    const a = rulesSuggestions(f).map((s) => s.dedupeKey).sort();
    const b = rulesSuggestions(f).map((s) => s.dedupeKey).sort();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("담당자·기한을 제안에 만들어 넣지 않는다", () => {
    for (const s of rulesSuggestions(base({ commCount: 0, lastContactAt: null }))) {
      expect(Object.keys(s)).not.toContain("owner");
      expect(Object.keys(s)).not.toContain("dueDate");
    }
  });

  it("다음 액션은 가장 급한 항목을 그대로 인용한다", () => {
    const out = rulesSuggestions(base({ channelErrors: ["이메일"] }));
    expect(nextActionLine(out, [])).toContain("문제:");
    expect(nextActionLine([], [])).toBe("");
  });
});

describe("접촉 공백 — 발송 기록과 대화 기록을 함께 본다", () => {
  const stale = (over: Partial<PmFacts> = {}) =>
    rulesSuggestions(base({ today: "2026-10-01", ...over }));
  const find = (list: ReturnType<typeof rulesSuggestions>, key: string) =>
    list.find((x) => x.dedupeKey === key);

  it("발송 기록만 오래됐어도 더 최근 대화 기록이 있으면 연락 없음으로 보지 않는다", () => {
    const out = stale({
      lastContactAt: "2026-09-03T00:00:00Z",
      lastRecordAt: "2026-09-30T09:44:00Z", lastRecordKind: "stored", lastRecordChannel: "카카오톡",
    });
    expect(find(out, "rules:stale_contact")).toBeUndefined();
  });

  it("대신 발송 기록과 대화 기록의 시점 차이를 질문으로 알린다", () => {
    const out = stale({
      lastContactAt: "2026-09-03T00:00:00Z",
      lastRecordAt: "2026-09-30T09:44:00Z", lastRecordKind: "stored", lastRecordChannel: "카카오톡",
    });
    const gap = find(out, "rules:contact_record_gap");
    expect(gap).toBeTruthy();
    expect(gap!.detail).toContain("2026-09-03");
    expect(gap!.detail).toContain("2026-09-30");
  });

  it("대화 기록도 오래됐으면 그 시각을 기준으로 일수를 센다", () => {
    const out = stale({
      lastContactAt: "2026-09-03T00:00:00Z",
      lastRecordAt: "2026-09-05T00:00:00Z", lastRecordKind: "stored", lastRecordChannel: "카카오톡",
    });
    const s = find(out, "rules:stale_contact");
    expect(s).toBeTruthy();
    expect(s!.title).toContain("26일");          // 9/5 → 10/1
    // 저장 시각 기준임을 문구에 그대로 적는다(실제 대화 시각이라고 말하지 않는다).
    expect(s!.detail).toContain("기록을 남긴 시각 기준");
    expect(s!.detail).toContain("확인이 필요");
  });

  it("사람이 적어 넣은 대화 시각이면 저장 시각이라고 적지 않는다", () => {
    const out = stale({
      lastContactAt: null,
      lastRecordAt: "2026-09-05T00:00:00Z", lastRecordKind: "conversation", lastRecordChannel: "수동 등록 대화",
    });
    const s = find(out, "rules:stale_contact");
    expect(s!.detail).toContain("마지막 대화 기록은 2026-09-05");
    expect(s!.detail).not.toContain("기록을 남긴 시각 기준");
  });

  it("발송 기록이 더 최근이면 기존 문구 그대로다", () => {
    const out = stale({
      lastContactAt: "2026-09-05T00:00:00Z",
      lastRecordAt: "2026-09-01T00:00:00Z", lastRecordKind: "stored", lastRecordChannel: "카카오톡",
    });
    const s = find(out, "rules:stale_contact");
    expect(s!.detail).toContain("기록상 마지막 접촉은 2026-09-05");
    expect(find(out, "rules:contact_record_gap")).toBeUndefined();
  });

  it("둘 다 없으면 수치를 만들지 않고 질문만 남긴다", () => {
    const out = stale({ lastContactAt: null, lastRecordAt: null, lastRecordKind: null });
    expect(find(out, "rules:stale_contact")).toBeUndefined();
    expect(find(out, "rules:no_contact_record")).toBeTruthy();
  });
});
