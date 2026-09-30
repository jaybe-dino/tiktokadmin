// PM 1차 확장의 순수 계산(DB·네트워크 의존 없음 — 클라이언트에서도 import 가능).
//   · KPI 분류/합의 상태 · 계약 조건 종류 · 대화 추출 종류의 라벨
//   · 계약 대조 결과 판정
//   · 업무 버킷(오늘/이번주/지연/고객대기/내부대기)
//   · 브랜드360 상단 요약(핵심 KPI · 우선 업무 3개 · 장애물 · 답변대기)
//   · AI 추출 응답 검증(근거 ID 를 가리키지 않으면 버린다)
//
//   원칙: 미확인 실적을 0 으로 적지 않는다. 값이 없으면 null 로 두고 화면에 "미확인"으로 적는다.

// ── 라벨 ────────────────────────────────────────────────────
export const KPI_KINDS = ["contract", "expectation", "internal"] as const;
export type KpiKind = (typeof KPI_KINDS)[number];
export const KPI_KIND_LABEL: Record<KpiKind, string> = {
  contract: "계약 의무",
  expectation: "브랜드 기대",
  internal: "내부 실행",
};
export const KPI_KIND_HINT: Record<KpiKind, string> = {
  contract: "계약서·합의문에 적힌 우리 의무",
  expectation: "고객이 말한 기대치(합의 아님)",
  internal: "우리가 스스로 잡은 실행 지표",
};

export const AGREEMENTS = ["candidate", "proposed", "expected", "agreed"] as const;
export type Agreement = (typeof AGREEMENTS)[number];
export const AGREEMENT_LABEL: Record<Agreement, string> = {
  candidate: "후보(확인 전)",
  proposed: "우리 제안",
  expected: "고객 기대",
  agreed: "양측 합의",
};

export const TERM_KINDS = ["scope", "quantity", "period", "exclusion", "cooperation"] as const;
export type TermKind = (typeof TERM_KINDS)[number];
export const TERM_KIND_LABEL: Record<TermKind, string> = {
  scope: "범위", quantity: "수량", period: "기간", exclusion: "제외", cooperation: "협조사항",
};

export const TERM_STATUSES = ["candidate", "agreed", "disputed", "void"] as const;
export type TermStatus = (typeof TERM_STATUSES)[number];
export const TERM_STATUS_LABEL: Record<TermStatus, string> = {
  candidate: "후보(확인 전)", agreed: "확정", disputed: "인식 불일치", void: "무효",
};

export const EXTRACT_KINDS = ["question", "request", "promise", "decision", "open"] as const;
export type ExtractKind = (typeof EXTRACT_KINDS)[number];
export const EXTRACT_KIND_LABEL: Record<ExtractKind, string> = {
  question: "질문", request: "요청", promise: "약속", decision: "결정", open: "미해결",
};

export const CONTRACT_CHECKS = ["unknown", "within", "outside", "conflict"] as const;
export type ContractCheck = (typeof CONTRACT_CHECKS)[number];
export const CONTRACT_CHECK_LABEL: Record<ContractCheck, string> = {
  unknown: "대조 불가", within: "계약 범위 안", outside: "계약 범위 밖", conflict: "계약과 충돌",
};

export const WAITING_LABEL: Record<string, string> = {
  none: "진행 중", customer: "고객 회신 대기", internal: "내부 확인 대기",
};

export const EXTRACT_STATUS_LABEL: Record<string, string> = {
  new: "확인 전", confirmed: "담당 확인", answered: "처리 완료", dismissed: "해당 없음",
};

// ── 날짜 ────────────────────────────────────────────────────
export function kstDay(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
export function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400_000) : 0;
}
/** today 가 속한 주(월~일)의 마지막 날(일요일). KST 기준. */
export function weekEnd(today: string): string {
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = new Date(t).getUTCDay();          // 0=일
  const toSunday = dow === 0 ? 0 : 7 - dow;
  return new Date(t + toSunday * 86400_000).toISOString().slice(0, 10);
}

// ── KPI ─────────────────────────────────────────────────────
export interface BriefKpi {
  id: string; name: string; unit: string;
  kind: KpiKind; agreement: Agreement;
  target: number | null; current: number | null;
  measuredAt: string | null;
  direction: "up" | "down";
  periodStart: string | null; periodEnd: string | null;
  owner: string | null;
  sourceQuote: string; evidenceLabel: string;
  status: string;
}

/**
 * 목표와 현재값의 차이. 어느 쪽이든 값이 없으면 null(0 으로 적지 않는다).
 *   방향을 반영해 "남은 양"으로 돌려준다 — 양수면 아직 모자라고, 0 이하면 달성이다.
 */
export function kpiGap(k: Pick<BriefKpi, "target" | "current" | "direction">): number | null {
  if (k.target === null || k.current === null) return null;
  return k.direction === "down" ? k.current - k.target : k.target - k.current;
}

/** 표시용 기간 문구. 한쪽만 있어도 그대로 보여준다. */
export function periodLabel(k: Pick<BriefKpi, "periodStart" | "periodEnd">): string {
  if (k.periodStart && k.periodEnd) return `${k.periodStart} ~ ${k.periodEnd}`;
  if (k.periodEnd) return `~ ${k.periodEnd}`;
  if (k.periodStart) return `${k.periodStart} ~`;
  return "기간 미정";
}

/**
 * 상단에 올릴 핵심 KPI 고르기.
 *   계약 의무 → 브랜드 기대 → 내부 실행 순, 같은 분류 안에서는 기한이 가까운 것부터.
 *   후보(확인 전)는 합의된 것 뒤로 밀되 버리지 않는다 — 확인이 필요한 것도 보여야 한다.
 */
export function pickKeyKpis(kpis: BriefKpi[], limit = 3): BriefKpi[] {
  const rank = (k: BriefKpi) =>
    KPI_KINDS.indexOf(k.kind) * 10 + (k.agreement === "agreed" ? 0 : 1);
  return [...kpis]
    .filter((k) => k.status === "active")
    .sort((a, b) => rank(a) - rank(b) ||
      (a.periodEnd ?? "9999-12-31").localeCompare(b.periodEnd ?? "9999-12-31") ||
      a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ── 업무 버킷 ───────────────────────────────────────────────
export interface BriefTask {
  id: string; kind: string; title: string;
  priority: number; owner: string | null; dueDate: string | null;
  status: string; waitingOn: string;
  origin: string; confirmedBy: string | null;
  kpiId: string | null;
}
const OPEN = new Set(["open", "doing", "reopened"]);

export interface TaskBuckets {
  today: BriefTask[]; week: BriefTask[]; overdue: BriefTask[];
  waitingCustomer: BriefTask[]; waitingInternal: BriefTask[]; unassigned: BriefTask[];
}

/**
 * 열린 업무를 화면 버킷으로 나눈다.
 *   대기 중인 업무는 오늘/이번주에서 빼고 대기 칸에만 둔다 — 우리가 지금 할 일과 섞이지 않게.
 *   지연은 대기와 무관하게 따로 세운다(대기라도 기한이 지나면 지연이다).
 */
export function taskBuckets(tasks: BriefTask[], today = kstDay()): TaskBuckets {
  const open = tasks.filter((t) => OPEN.has(t.status));
  const sunday = weekEnd(today);
  const waiting = (t: BriefTask) => t.waitingOn === "customer" || t.waitingOn === "internal";
  return {
    overdue: open.filter((t) => t.dueDate && t.dueDate < today),
    today: open.filter((t) => !waiting(t) && t.dueDate === today),
    week: open.filter((t) => !waiting(t) && t.dueDate && t.dueDate > today && t.dueDate <= sunday),
    waitingCustomer: open.filter((t) => t.waitingOn === "customer"),
    waitingInternal: open.filter((t) => t.waitingOn === "internal"),
    unassigned: open.filter((t) => !t.owner),
  };
}

/** 지금 손대야 할 업무 3개 — 지연 → 오늘 → 우선순위 순. 대기 중인 건 제외한다. */
export function pickTop3(tasks: BriefTask[], today = kstDay()): BriefTask[] {
  const b = taskBuckets(tasks, today);
  const seen = new Set<string>();
  const out: BriefTask[] = [];
  const push = (list: BriefTask[]) => {
    for (const t of [...list].sort((x, y) => x.priority - y.priority ||
      (x.dueDate ?? "9999-12-31").localeCompare(y.dueDate ?? "9999-12-31"))) {
      if (out.length >= 3 || seen.has(t.id)) continue;
      seen.add(t.id); out.push(t);
    }
  };
  push(b.overdue.filter((t) => t.waitingOn === "none"));
  push(b.today);
  push(b.week);
  push(tasks.filter((t) => OPEN.has(t.status) && t.waitingOn === "none"));
  return out.slice(0, 3);
}

// ── 장애물 · 답변대기 ───────────────────────────────────────
export interface BriefExtraction {
  id: string; kind: ExtractKind; title: string;
  contractCheck: ContractCheck; status: string;
  occurredAt: string | null; sourceAuthor: string;
  evidenceLabel: string; hasReplyDraft: boolean;
}

export interface Blocker {
  label: string;
  /** 왜 장애물인지 — 근거 없이 단정하지 않는다. */
  reason: string;
  severity: 1 | 2 | 3;
  ref?: { kind: "task" | "kpi" | "extraction"; id: string };
}

/**
 * 진행을 막고 있는 것. 모두 저장된 사실에서만 만들고, 추측을 넣지 않는다.
 */
export function pickBlockers(input: {
  kpis: BriefKpi[]; tasks: BriefTask[]; extractions: BriefExtraction[];
  contractDisputes: { id: string; label: string }[];
  today?: string;
}): Blocker[] {
  const today = input.today ?? kstDay();
  const out: Blocker[] = [];

  for (const d of input.contractDisputes) {
    out.push({ label: `계약 인식 불일치 · ${d.label}`, reason: "계약 조건이 '인식 불일치'로 표시돼 있습니다.", severity: 1, ref: { kind: "task", id: d.id } });
  }
  for (const e of input.extractions.filter((x) => x.contractCheck === "conflict" && x.status !== "dismissed")) {
    out.push({ label: `계약 충돌 · ${e.title}`, reason: "대화 내용이 계약 조건과 충돌한다고 표시됐습니다.", severity: 1, ref: { kind: "extraction", id: e.id } });
  }
  const b = taskBuckets(input.tasks, today);
  for (const t of b.overdue.slice(0, 5)) {
    out.push({ label: `마감 지남 · ${t.title}`, reason: `마감 ${t.dueDate} 이 지났습니다.`, severity: t.priority === 1 ? 1 : 2, ref: { kind: "task", id: t.id } });
  }
  for (const t of b.unassigned.slice(0, 3)) {
    out.push({ label: `담당 미배정 · ${t.title}`, reason: "담당자가 지정되지 않았습니다.", severity: 2, ref: { kind: "task", id: t.id } });
  }
  // KPI 미확정 — 후보로 남아 있으면 목표가 정해지지 않은 상태다.
  for (const k of input.kpis.filter((x) => x.status === "active" && x.agreement === "candidate").slice(0, 3)) {
    out.push({ label: `KPI 미확정 · ${k.name}`, reason: "대화에서 뽑은 후보로, 담당 확인 전입니다.", severity: 2, ref: { kind: "kpi", id: k.id } });
  }
  // 계약 의무인데 현재값이 없으면 이행 여부를 알 수 없다(0 으로 적지 않는다).
  for (const k of input.kpis.filter((x) => x.status === "active" && x.kind === "contract" && x.current === null).slice(0, 3)) {
    out.push({ label: `계약 KPI 실적 미확인 · ${k.name}`, reason: "현재값이 입력되지 않아 이행 여부를 알 수 없습니다(0 으로 보지 않습니다).", severity: 2, ref: { kind: "kpi", id: k.id } });
  }
  return out.sort((a, z) => a.severity - z.severity).slice(0, 8);
}

export interface AwaitingItem {
  label: string; who: "customer" | "internal"; since: string | null;
  ref: { kind: "task" | "extraction"; id: string };
}

/** 답변대기 — 고객 회신 대기와 내부 확인 대기를 나눠 보여준다. */
export function pickAwaiting(input: { tasks: BriefTask[]; extractions: BriefExtraction[] }): AwaitingItem[] {
  const out: AwaitingItem[] = [];
  const b = taskBuckets(input.tasks);
  for (const t of b.waitingCustomer) out.push({ label: t.title, who: "customer", since: t.dueDate, ref: { kind: "task", id: t.id } });
  for (const t of b.waitingInternal) out.push({ label: t.title, who: "internal", since: t.dueDate, ref: { kind: "task", id: t.id } });
  // 아직 답하지 않은 고객 질문·요청
  for (const e of input.extractions) {
    if (e.status === "answered" || e.status === "dismissed") continue;
    if (e.kind !== "question" && e.kind !== "request") continue;
    out.push({ label: e.title, who: "customer", since: e.occurredAt ? e.occurredAt.slice(0, 10) : null, ref: { kind: "extraction", id: e.id } });
  }
  return out.slice(0, 12);
}

// ── 상단 요약 ───────────────────────────────────────────────
export interface PmHeaderSummary {
  /** 0099/0104 미적용 · 권한 없음 등으로 볼 수 없을 때의 사유. */
  unavailable?: string;
  keyKpis: BriefKpi[];
  top3: BriefTask[];
  blockers: Blocker[];
  awaiting: AwaitingItem[];
  counts: { openTasks: number; overdue: number; waitingCustomer: number; waitingInternal: number; unconfirmedKpis: number };
  /** 이 요약이 어느 시점 기준인지 — 화면에 그대로 적는다. */
  asOf: string;
  /** 수집이 연결되지 않은 채널 등, 요약이 놓칠 수 있는 범위. */
  caveats: string[];
}

export function buildHeaderSummary(input: {
  kpis: BriefKpi[]; tasks: BriefTask[]; extractions: BriefExtraction[];
  contractDisputes: { id: string; label: string }[];
  caveats?: string[];
  today?: string;
  asOf?: string;
}): PmHeaderSummary {
  const today = input.today ?? kstDay();
  const b = taskBuckets(input.tasks, today);
  return {
    keyKpis: pickKeyKpis(input.kpis),
    top3: pickTop3(input.tasks, today),
    blockers: pickBlockers({ ...input, today }),
    awaiting: pickAwaiting(input),
    counts: {
      openTasks: input.tasks.filter((t) => OPEN.has(t.status)).length,
      overdue: b.overdue.length,
      waitingCustomer: b.waitingCustomer.length,
      waitingInternal: b.waitingInternal.length,
      unconfirmedKpis: input.kpis.filter((k) => k.status === "active" && k.agreement === "candidate").length,
    },
    asOf: input.asOf ?? new Date().toISOString(),
    caveats: input.caveats ?? [],
  };
}

// ── 계약 대조 ───────────────────────────────────────────────
export interface TermForCheck {
  id: string; kind: TermKind; label: string; detail: string;
  quantity: number | null; unit: string; status: TermStatus;
}

/**
 * 요청 하나를 계약 조건과 대조한다. 규칙 기반이라 단정하지 않고,
 *   근거가 약하면 unknown 으로 둔다 — 없는 판단을 만들지 않기 위해서다.
 *     · 제외 항목에 걸리면 conflict
 *     · 확정 조건의 라벨과 맞으면 within
 *     · 확정 조건이 하나도 없으면 unknown(대조 불가)
 */
export function checkAgainstTerms(text: string, terms: TermForCheck[]):
  { check: ContractCheck; termId: string | null; note: string } {
  const hay = (text ?? "").toLowerCase();
  if (!hay.trim()) return { check: "unknown", termId: null, note: "대조할 내용이 없습니다." };
  const live = terms.filter((t) => t.status === "agreed" || t.status === "disputed");
  if (live.length === 0) {
    return { check: "unknown", termId: null, note: "확정된 계약 조건이 등록되지 않아 대조할 수 없습니다." };
  }
  const hit = (t: TermForCheck) => {
    const words = `${t.label} ${t.detail}`.toLowerCase().split(/[\s,·/()]+/).filter((w) => w.length >= 2);
    return words.some((w) => hay.includes(w));
  };
  const excluded = live.find((t) => t.kind === "exclusion" && hit(t));
  if (excluded) {
    return { check: "conflict", termId: excluded.id, note: `계약 제외 항목과 겹칩니다 — ${excluded.label}` };
  }
  const disputed = live.find((t) => t.status === "disputed" && hit(t));
  if (disputed) {
    return { check: "conflict", termId: disputed.id, note: `인식 불일치로 표시된 조건입니다 — ${disputed.label}` };
  }
  const within = live.find((t) => t.status === "agreed" && t.kind !== "exclusion" && hit(t));
  if (within) {
    return { check: "within", termId: within.id, note: `계약 조건과 맞습니다 — ${within.label}` };
  }
  return { check: "unknown", termId: null, note: "등록된 계약 조건과 맞는 항목을 찾지 못했습니다 — 담당 확인이 필요합니다." };
}

// ── AI 추출 응답 검증 ───────────────────────────────────────
export interface ExtractEvidence {
  ref: string; sourceId: string; channel: string; at: string;
  author: string; title: string; body: string;
}
export const EXTRACT_MAX = 10;
export const EXTRACT_TITLE_CHARS = 300;
export const EXTRACT_TEXT_CHARS = 2000;

export interface ValidatedExtraction {
  kind: ExtractKind; title: string; detail: string;
  quote: string;
  replyDraft: string; internalChecks: string;
  evidenceRef: string; sourceId: string;
  author: string; occurredAt: string; channel: string; evidenceTitle: string;
  dedupeKey: string;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * 모델 응답 검증 — 우리가 보낸 근거 ref 를 가리키고 종류가 맞는 것만 남긴다.
 *   인용(quote)은 그 근거 본문에 실제로 있는 문구여야 한다(지어낸 인용 차단).
 *   같은 근거에서 같은 종류는 1건으로 묶어 반복 실행 시 중복을 막는다.
 */
export function validateExtractions(raw: unknown, evidence: ExtractEvidence[]):
  { items: ValidatedExtraction[]; rejected: number } {
  const byRef = new Map(evidence.map((e) => [e.ref, e]));
  const list = Array.isArray((raw as { items?: unknown })?.items)
    ? ((raw as { items: Record<string, unknown>[] }).items) : [];
  const out: ValidatedExtraction[] = [];
  const seen = new Set<string>();
  let rejected = 0;

  for (const r of list) {
    if (out.length >= EXTRACT_MAX) { rejected++; continue; }
    const kind = String(r.kind ?? "") as ExtractKind;
    const title = clean(r.title, EXTRACT_TITLE_CHARS);
    const ref = String(r.evidence_ref ?? "").trim();
    const ev = byRef.get(ref);
    if (!(EXTRACT_KINDS as readonly string[]).includes(kind) || !title || !ev) { rejected++; continue; }

    // 인용 검증 — 근거 본문에 없는 문구는 버린다.
    const quote = clean(r.quote, 600);
    const body = ev.body.replace(/\s+/g, " ");
    if (quote && !body.includes(quote.slice(0, Math.min(40, quote.length)))) { rejected++; continue; }

    const key = `ai:${ev.sourceId}:${kind}`;
    if (seen.has(key)) { rejected++; continue; }
    seen.add(key);

    out.push({
      kind, title, detail: clean(r.detail, EXTRACT_TEXT_CHARS),
      quote,
      replyDraft: clean(r.reply_draft, EXTRACT_TEXT_CHARS),
      internalChecks: clean(r.internal_checks, EXTRACT_TEXT_CHARS),
      evidenceRef: ref, sourceId: ev.sourceId,
      author: ev.author, occurredAt: ev.at, channel: ev.channel, evidenceTitle: ev.title,
      dedupeKey: key,
    });
  }
  return { items: out, rejected };
}

/** 업무 중복 방지 키 — 추출 1건에서 만든 업무는 1개다. */
export function taskKeyForExtraction(extractionId: string): string {
  return `ext:${extractionId}`;
}
