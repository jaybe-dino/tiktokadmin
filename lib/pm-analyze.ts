// PM 분석 — 규칙 기반 점검(DB·외부 호출 없는 순수 함수).
//   원칙:
//     · AI 키가 없어도 여기까지는 돌아간다. 그때 결과를 "AI 분석"이라고 적지 않는다(origin='rules').
//     · 근거 없는 사실·수치·담당·기한을 만들지 않는다. 입력에 있는 값만 인용한다.
//     · 만들어지는 것은 "제안"이다. 사람이 확정해야 업무가 된다.
//     · 대화 본문은 비신뢰 자료로 취급한다 — 지시로 읽지 않고, 본문을 근거 링크로만 가리킨다.

export type PmSuggestKind = "issue" | "todo" | "question";

export interface PmSuggestion {
  kind: PmSuggestKind;
  title: string;
  detail: string;
  priority: 1 | 2 | 3;
  /** 같은 제안을 반복 생성하지 않기 위한 키. */
  dedupeKey: string;
  evidenceKind: string;
  evidenceId: string;
  evidenceLabel: string;
}

export interface PmFacts {
  brandId: string;
  brandName: string;
  state: string;
  /** 오늘(KST 기준 날짜 문자열 YYYY-MM-DD). */
  today: string;
  /** 마지막 고객 접촉 시각(ISO) — 없으면 null. */
  lastContactAt: string | null;
  /** 채널 상태 — 확인 실패한 채널이 있으면 그 사실만 제안으로 올린다. */
  channelErrors: string[];
  channelsNotConnected: string[];
  /** 대화 건수(연결된 채널 합계). */
  commCount: number;
  kpis: {
    id: string; name: string; unit: string;
    target: number | null; current: number | null; measuredAt: string | null;
    direction: "up" | "down"; periodEnd: string | null; owner: string | null;
  }[];
  openTasks: {
    id: string; title: string; dueDate: string | null; owner: string | null; status: string;
    /** 사람이 등록했거나 확정한 업무인지 — 미확정 제안은 위생 점검 대상이 아니다. */
    confirmed: boolean;
  }[];
  /** 전사 없이 끝난 회의 — 근거 공백이므로 질문거리다. */
  meetingsWithoutTranscript: { id: string; topic: string }[];
}

/** 날짜 문자열(YYYY-MM-DD) 차이(일). a - b. */
export function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86400_000);
}

/**
 * KPI 달성률.
 *   · 목표나 현재값이 없으면 null(값 없음) — 0% 로 적지 않는다.
 *   · direction='down' 은 낮을수록 좋은 역방향 지표다.
 *   · 목표가 0 인 경우는 비율을 정의할 수 없어 null 로 둔다.
 */
export function kpiProgress(input: {
  target: number | null; current: number | null; direction: "up" | "down";
}): number | null {
  const { target, current, direction } = input;
  if (target == null || current == null) return null;
  if (direction === "up") {
    if (target === 0) return null;
    return (current / target) * 100;
  }
  // 역방향: 목표 이하면 100%, 목표를 넘으면 초과분만큼 깎는다.
  if (current <= target) return 100;
  if (target === 0) return null;
  return Math.max(0, (2 - current / target) * 100);
}

/** KPI 위험 판정 — 근거가 없으면 '알 수 없음'이다. */
export type KpiRisk = "unknown" | "no_measure" | "on_track" | "at_risk" | "overdue";

export function kpiRisk(input: {
  target: number | null; current: number | null; measuredAt: string | null;
  periodEnd: string | null; direction: "up" | "down"; today: string;
}): KpiRisk {
  if (input.target == null) return "unknown";
  if (input.current == null || input.measuredAt == null) return "no_measure";
  if (input.periodEnd && dayDiff(input.today, input.periodEnd) > 0) {
    const p = kpiProgress(input);
    return p != null && p >= 100 ? "on_track" : "overdue";
  }
  const p = kpiProgress(input);
  if (p == null) return "unknown";
  return p >= 70 ? "on_track" : "at_risk";
}

const STALE_CONTACT_DAYS = 14;

/**
 * 규칙 기반 점검 → 제안 목록.
 *   각 제안은 "왜"를 입력 사실로만 설명한다. 없는 값을 채우지 않는다.
 */
export function rulesSuggestions(f: PmFacts): PmSuggestion[] {
  const out: PmSuggestion[] = [];

  // ① 근거 공백: 채널 조회 실패 — 판단 근거가 불완전하다는 사실 자체를 올린다.
  for (const label of f.channelErrors) {
    out.push({
      kind: "issue",
      title: `대화 수집 확인 실패 — ${label}`,
      detail: `${label} 채널을 조회하지 못해 이 브랜드의 대화 이력이 완전하지 않습니다. 복구 전에는 "대화 없음"으로 판단하지 마세요.`,
      priority: 1,
      dedupeKey: `rules:channel_error:${label}`,
      evidenceKind: "channel", evidenceId: label, evidenceLabel: `${label} 조회 실패`,
    });
  }

  // ② 대화 기록이 아예 없음 — 수집 미연결과 구분해서 적는다.
  if (f.commCount === 0 && f.channelErrors.length === 0) {
    out.push({
      kind: "question",
      title: "기록된 대화가 없습니다 — 어디서 대화했는지 확인 필요",
      detail: f.channelsNotConnected.length
        ? `연결된 채널에 대화 기록이 없습니다. 수집이 연결되지 않은 채널(${f.channelsNotConnected.join(", ")})에서 대화했다면 원문을 수동 등록해 주세요.`
        : "연결된 채널에 대화 기록이 없습니다. 실제 대화가 있었다면 원문을 등록해 주세요.",
      priority: 2,
      dedupeKey: "rules:no_comms",
      evidenceKind: "channel", evidenceId: "", evidenceLabel: "대화 0건",
    });
  }

  // ③ 접촉 공백 — 마지막 접촉 시각이 있을 때만 계산한다(없으면 수치를 만들지 않는다).
  if (f.lastContactAt) {
    const days = dayDiff(f.today, f.lastContactAt.slice(0, 10));
    if (days >= STALE_CONTACT_DAYS) {
      out.push({
        kind: "todo",
        title: `마지막 접촉 후 ${days}일 — 연락 필요`,
        detail: `기록상 마지막 접촉은 ${f.lastContactAt.slice(0, 10)} 입니다. 다음 연락 계획을 잡아 주세요.`,
        priority: days >= 30 ? 1 : 2,
        dedupeKey: "rules:stale_contact",
        evidenceKind: "contact", evidenceId: "", evidenceLabel: `마지막 접촉 ${f.lastContactAt.slice(0, 10)}`,
      });
    }
  } else {
    out.push({
      kind: "question",
      title: "마지막 접촉 기록이 없습니다",
      detail: "접촉 기록이 남아 있지 않아 연락 주기를 판단할 수 없습니다. 최근 연락이 있었다면 기록해 주세요.",
      priority: 3,
      dedupeKey: "rules:no_contact_record",
      evidenceKind: "contact", evidenceId: "", evidenceLabel: "접촉 기록 없음",
    });
  }

  // ④ KPI — 값 없음/미측정/위험/기한초과를 구분한다.
  for (const k of f.kpis) {
    const risk = kpiRisk({ ...k, today: f.today });
    if (risk === "unknown") {
      out.push({
        kind: "question",
        title: `KPI 목표 미입력 — ${k.name}`,
        detail: `"${k.name}" 의 목표값이 비어 있어 달성 여부를 판단할 수 없습니다. 합의된 목표가 있으면 근거와 함께 입력해 주세요.`,
        priority: 3, dedupeKey: `rules:kpi_no_target:${k.id}`,
        evidenceKind: "kpi", evidenceId: k.id, evidenceLabel: k.name,
      });
    } else if (risk === "no_measure") {
      out.push({
        kind: "todo",
        title: `KPI 현재값 측정 필요 — ${k.name}`,
        detail: `"${k.name}" 은 목표가 있으나 현재값·측정일이 없습니다. 측정해 입력해 주세요.`,
        priority: 2, dedupeKey: `rules:kpi_no_measure:${k.id}`,
        evidenceKind: "kpi", evidenceId: k.id, evidenceLabel: k.name,
      });
    } else if (risk === "at_risk" || risk === "overdue") {
      const p = kpiProgress({ ...k });
      out.push({
        kind: "issue",
        title: risk === "overdue" ? `KPI 기한 초과 — ${k.name}` : `KPI 미달 위험 — ${k.name}`,
        detail: [
          `목표 ${k.target}${k.unit} · 현재 ${k.current}${k.unit}`,
          k.measuredAt ? `(측정 ${k.measuredAt})` : "",
          p != null ? `· 달성률 ${p.toFixed(0)}%` : "",
          k.periodEnd ? `· 기한 ${k.periodEnd}` : "",
          k.direction === "down" ? "· 낮을수록 좋은 지표" : "",
        ].filter(Boolean).join(" "),
        priority: 1, dedupeKey: `rules:kpi_risk:${k.id}`,
        evidenceKind: "kpi", evidenceId: k.id, evidenceLabel: k.name,
      });
    }
  }

  // ⑤ 업무 위생 — 지연·미배정.
  //   미확정 제안은 제외한다. 포함하면 "제안에 담당자가 없다"는 제안이 매 실행마다 새로 생겨
  //   스스로를 먹고 자라는 되먹임이 된다(사람이 확정한 업무만 본다).
  for (const t of f.openTasks.filter((x) => x.confirmed)) {
    if (t.dueDate && dayDiff(f.today, t.dueDate) > 0) {
      out.push({
        kind: "issue",
        title: `마감 지남 — ${t.title}`,
        detail: `마감 ${t.dueDate} 이 지났습니다(상태: ${t.status}). 일정을 다시 잡거나 완료 처리해 주세요.`,
        priority: 1, dedupeKey: `rules:task_overdue:${t.id}`,
        evidenceKind: "task", evidenceId: t.id, evidenceLabel: t.title,
      });
    }
    if (!t.owner) {
      out.push({
        kind: "todo",
        title: `담당자 미배정 — ${t.title}`,
        detail: "담당자가 없어 진행되지 않을 수 있습니다. 담당자를 지정해 주세요.",
        priority: 2, dedupeKey: `rules:task_no_owner:${t.id}`,
        evidenceKind: "task", evidenceId: t.id, evidenceLabel: t.title,
      });
    }
  }

  // ⑥ 회의 근거 공백 — 전사 없는 회의.
  for (const m of f.meetingsWithoutTranscript) {
    out.push({
      kind: "question",
      title: `회의 기록 없음 — ${m.topic || "(제목 없음)"}`,
      detail: "이 회의는 전사·요약이 없어 논의 내용을 확인할 수 없습니다. 회의록을 등록하거나 전사를 재수집해 주세요.",
      priority: 3, dedupeKey: `rules:meeting_no_transcript:${m.id}`,
      evidenceKind: "meeting", evidenceId: m.id, evidenceLabel: m.topic || "(제목 없음)",
    });
  }

  return out;
}

/** 다음 액션 한 줄 — 가장 급한 제안/업무를 그대로 인용한다(없으면 빈 문자열). */
export function nextActionLine(suggestions: PmSuggestion[], openTasks: PmFacts["openTasks"]): string {
  const top = [...suggestions].sort((a, b) => a.priority - b.priority)[0];
  if (top) return `${top.kind === "issue" ? "문제" : top.kind === "todo" ? "할일" : "확인"}: ${top.title}`;
  if (openTasks.length) return `할일: ${openTasks[0].title}`;
  return "";
}
