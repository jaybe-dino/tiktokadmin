// "오늘 내 할 일" 일일 다이제스트 — 매일 12:00(KST) 에이전트가 담당자별로 생성.
//   어제까지 쌓인 열린 항목(회신 필요·SLA·마감·초안·오늘 미팅 등)을 현재 단계 담당자 기준으로
//   모아 우선순위 정리 + (AI 사용 가능 시) 자연어 요약. 홈(오늘) '내 담당만'에서 본인 몫 표시.
import { query } from "./db";
import { ownerFieldForState } from "./states";
import { STATE_LABELS, type State } from "./types";
import { aiEnabled, aiText } from "./ai";

const base = () => (process.env.ADMIN_URL || "").replace(/\/$/, "");

export interface TodoItem {
  brand_id: string | null;
  brand_name: string;
  task: string;
  reason: string;
  priority: number; // 0=최우선
  link: string;
}

export interface DailyTodo {
  admin_user_id: string;
  for_date: string;
  summary: string;
  items: TodoItem[];
  generated_by: string;
}

/** KST 기준 오늘 날짜(YYYY-MM-DD). */
function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const ALERT_TASK: Record<string, { task: string; pri: number }> = {
  inbound_fwd: { task: "고객 수신 메일 회신", pri: 0 },
  reply_needed: { task: "고객 수신 메일 회신", pri: 0 },
  sla_breach: { task: "SLA 지연 처리", pri: 0 },
  no_reply: { task: "무응답 재접촉", pri: 1 },
  gate_violation: { task: "게이트 미충족 보완", pri: 1 },
  stale: { task: "장기 방치 브랜드 점검", pri: 2 },
  doc_missing: { task: "서류 보완 요청", pri: 1 },
  pay_overdue: { task: "결제 연체 확인", pri: 1 },
};

/**
 * 매일 12:00(KST) 실행 — 담당자별 오늘 할 일 다이제스트를 생성/갱신.
 *   반환: 처리한 담당자 수 · 총 항목 수.
 */
export async function runDailyTodos(): Promise<{ users: number; items: number }> {
  const today = todayKst();

  // 활성 담당자
  const users = await query<{ id: string; name: string }>(
    "SELECT id, name FROM admin_users WHERE active = true").catch(() => []);
  if (users.length === 0) return { users: 0, items: 0 };
  const userIds = new Set(users.map((u) => u.id));

  // 진행 중 브랜드(담당·상태·마감·다음액션)
  const brands = await query<{
    id: string; brand_name: string; state: State; due_date: string | null; next_action: string | null;
    owner_intake: string | null; owner_sales: string | null; owner_onboard: string | null; owner_ads: string | null; owner_contract: string | null;
  }>(
    `SELECT id, brand_name, state, due_date, next_action,
            owner_intake, owner_sales, owner_onboard, owner_ads, owner_contract
       FROM brands
      WHERE state NOT IN ('dropped','churned') AND coalesce(is_test,false)=false`).catch(() => []);
  const brandById = new Map(brands.map((b) => [b.id, b]));

  // 현재 단계 담당자(stage owner) 판정. 없으면 null.
  const stageOwnerOf = (b: (typeof brands)[number]): string | null => {
    const f = ownerFieldForState(b.state);
    const v = f ? (b as unknown as Record<string, string | null>)[f] : null;
    return v && userIds.has(v) ? v : null;
  };

  // 담당자별 항목 수집
  const byUser = new Map<string, TodoItem[]>();
  const push = (uid: string, it: TodoItem) => {
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(it);
  };

  // 1) 열린 알림 → 현재 단계 담당자
  const alerts = await query<{ brand_id: string; kind: string; tier: number; message: string }>(
    `SELECT brand_id, kind, tier, message FROM alerts
      WHERE resolved_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < now())`).catch(() => []);
  for (const a of alerts) {
    const b = brandById.get(a.brand_id);
    if (!b) continue;
    const uid = stageOwnerOf(b);
    if (!uid) continue;
    const meta = ALERT_TASK[a.kind] ?? { task: a.message || a.kind, pri: 2 };
    push(uid, {
      brand_id: b.id, brand_name: b.brand_name, task: meta.task,
      reason: a.message || STATE_LABELS[b.state] || b.state,
      priority: a.tier >= 3 ? 0 : meta.pri, link: `${base()}/brand/${b.id}`,
    });
  }

  // 2) 승인 대기 초안(회신·발송) → 현재 단계 담당자
  const drafts = await query<{ brand_id: string; kind: string; subject: string | null }>(
    "SELECT brand_id, kind, subject FROM email_drafts WHERE status='draft'").catch(() => []);
  for (const d of drafts) {
    const b = brandById.get(d.brand_id);
    if (!b) continue;
    const uid = stageOwnerOf(b);
    if (!uid) continue;
    push(uid, {
      brand_id: b.id, brand_name: b.brand_name, task: "AI 초안 검토·발송",
      reason: d.subject || (d.kind === "followup" ? "팔로업 초안" : "회신 초안"),
      priority: 1, link: `${base()}/drafts`,
    });
  }

  // 3) 오늘 마감·지난 마감 → 현재 단계 담당자
  for (const b of brands) {
    if (!b.due_date || b.due_date > today) continue;
    const uid = stageOwnerOf(b);
    if (!uid) continue;
    push(uid, {
      brand_id: b.id, brand_name: b.brand_name, task: b.next_action || "다음 액션 처리",
      reason: b.due_date < today ? `마감 초과(${b.due_date})` : "오늘 마감",
      priority: b.due_date < today ? 0 : 1, link: `${base()}/brand/${b.id}`,
    });
  }

  // 4) 오늘 미팅 → 호스트(담당) 또는 영업 담당
  const meetings = await query<{ brand_id: string | null; topic: string | null; host_email: string | null; scheduled_at: string }>(
    `SELECT brand_id, topic, host_email, scheduled_at FROM meetings
      WHERE scheduled_at::date = ($1::date) AND coalesce(status,'') NOT IN ('canceled','error')`,
    [today]).catch(() => []);
  for (const m of meetings) {
    const b = m.brand_id ? brandById.get(m.brand_id) : null;
    const uid = (m.host_email && userIds.has(m.host_email)) ? m.host_email : (b ? stageOwnerOf(b) : null);
    if (!uid) continue;
    const t = new Date(m.scheduled_at);
    const hhmm = Number.isNaN(t.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
    push(uid, {
      brand_id: b?.id ?? null, brand_name: b?.brand_name || (m.topic || "미팅"),
      task: `오늘 미팅 ${hhmm}`.trim(), reason: m.topic || "예정된 미팅", priority: 1,
      link: b ? `${base()}/brand/${b.id}` : `${base()}/meetings`,
    });
  }

  // 담당자별로 정리·요약·저장
  let totalItems = 0;
  for (const u of users) {
    const raw = byUser.get(u.id) ?? [];
    // 브랜드+task 중복 제거, 우선순위 정렬, 상위 12개.
    const seen = new Set<string>();
    const items = raw
      .sort((a, b) => a.priority - b.priority)
      .filter((it) => { const k = `${it.brand_id}|${it.task}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 12);
    totalItems += items.length;

    let summary = "";
    let generatedBy = "rules";
    if (items.length === 0) {
      summary = "오늘 처리할 급한 항목이 없습니다. 담당 브랜드 진행 상황을 점검해 보세요.";
    } else if (aiEnabled()) {
      const lines = items.map((it, i) => `${i + 1}. [${it.brand_name}] ${it.task} — ${it.reason}`).join("\n");
      const text = await aiText({
        system: "당신은 한국 B2B 커머스 운영팀의 업무 비서입니다. 담당자의 오늘 할 일을 2~3문장으로 간결하고 실행지향적으로 요약하세요. 과장 없이, 가장 급한 것부터. 존댓말.",
        user: `담당자 ${u.name}님의 오늘 할 일 목록입니다.\n${lines}\n\n위 항목을 우선순위대로 2~3문장으로 요약해 주세요.`,
        maxTokens: 400,
      }).catch(() => null);
      if (text) { summary = text; generatedBy = "agent"; }
      else summary = `오늘 처리할 항목 ${items.length}건 — 가장 급한: ${items[0].brand_name} · ${items[0].task}`;
    } else {
      summary = `오늘 처리할 항목 ${items.length}건 — 가장 급한: ${items[0].brand_name} · ${items[0].task}`;
    }

    await query(
      `INSERT INTO daily_todos (admin_user_id, for_date, summary, items, generated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (admin_user_id, for_date)
       DO UPDATE SET summary=EXCLUDED.summary, items=EXCLUDED.items, generated_by=EXCLUDED.generated_by, created_at=now()`,
      [u.id, today, summary, JSON.stringify(items), generatedBy]).catch(() => {});
  }

  return { users: users.length, items: totalItems };
}

/** 특정 담당자의 오늘(또는 최근) 다이제스트 조회. */
export async function getMyTodos(adminUserId: string): Promise<DailyTodo | null> {
  const today = todayKst();
  const row = await query<DailyTodo & { items: unknown }>(
    `SELECT admin_user_id, for_date::text AS for_date, summary, items, generated_by
       FROM daily_todos WHERE admin_user_id=$1 AND for_date=$2 LIMIT 1`,
    [adminUserId, today]).catch(() => []);
  const r = row[0];
  if (!r) return null;
  const items = Array.isArray(r.items) ? (r.items as TodoItem[]) : [];
  return { admin_user_id: r.admin_user_id, for_date: r.for_date, summary: r.summary, items, generated_by: r.generated_by };
}
