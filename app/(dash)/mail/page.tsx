import ScreenHeader from "@/components/ScreenHeader";
import { query } from "@/lib/db";
import MailClient, { type MailThread, type MailMessage } from "./MailClient";

export const dynamic = "force-dynamic";

// 메일함 3분할 — 서버에서 데이터 조회 후 MailClient(클라이언트)로 주입.
// 데이터: email_messages(없으면 brand_emails 폴백) thread_id별 최신 스레드 + 스레드별 메시지 + brands 조인.
// 모든 조회는 .catch/폴백으로 방어(테이블 없어도 500 금지).

const NO_REPLY_MS = 48 * 60 * 60 * 1000;

function elapsedMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Date.now() - t;
}

const BRAND_COLS = `
  b.brand_name, b.grade, b.state, b.plan, b.pay_status, b.churn_risk,
  b.category, b.owner_sales`;

// email_messages 기반: thread_id별 최신 메시지 1건 + 브랜드 컨텍스트 + 메시지 수
async function loadPrimaryThreads(): Promise<MailThread[]> {
  return query<MailThread>(
    `SELECT x.* FROM (
       SELECT DISTINCT ON (m.thread_id)
         m.thread_id, m.brand_id, m.direction, m.from_addr, m.subject,
         m.snippet, m.sent_at,
         (SELECT count(*)::int FROM email_messages m2 WHERE m2.thread_id = m.thread_id) AS msg_count,
         ${BRAND_COLS}
       FROM email_messages m
       LEFT JOIN brands b ON b.id = m.brand_id
       ORDER BY m.thread_id, m.sent_at DESC
     ) x
     ORDER BY x.sent_at DESC
     LIMIT 40`
  ).catch(() => [] as MailThread[]);
}

// email_messages 기반: 주어진 thread_id들의 모든 메시지(오래된순)
async function loadPrimaryMessages(threadIds: string[]): Promise<Record<string, MailMessage[]>> {
  if (threadIds.length === 0) return {};
  const rows = await query<MailMessage & { thread_id: string }>(
    `SELECT thread_id, direction, from_addr, to_addrs, subject, snippet, body_text, sent_at
       FROM email_messages
      WHERE thread_id = ANY($1::text[])
      ORDER BY sent_at ASC`,
    [threadIds]
  ).catch(() => [] as (MailMessage & { thread_id: string })[]);

  const byThread: Record<string, MailMessage[]> = {};
  for (const r of rows) {
    (byThread[r.thread_id] ??= []).push({
      direction: r.direction,
      from_addr: r.from_addr,
      to_addrs: r.to_addrs ?? null,
      subject: r.subject,
      snippet: r.snippet,
      body_text: r.body_text,
      sent_at: r.sent_at,
    });
  }
  return byThread;
}

// 폴백: brand_emails — 브랜드 단위를 하나의 스레드로 취급
async function loadFallback(): Promise<{ threads: MailThread[]; messages: Record<string, MailMessage[]> }> {
  const rows = await query<Record<string, unknown>>(
    `SELECT e.brand_id, e.direction, e.from_addr, e.to_addr, e.subject, e.snippet,
            e.occurred_at AS sent_at,
            ${BRAND_COLS}
       FROM brand_emails e
       LEFT JOIN brands b ON b.id = e.brand_id
      ORDER BY e.brand_id, e.occurred_at ASC`
  ).catch(() => [] as Record<string, unknown>[]);

  const messages: Record<string, MailMessage[]> = {};
  const latest: Record<string, MailThread> = {};

  for (const r of rows) {
    const tid = String(r.brand_id ?? "");
    if (!tid) continue;
    const sentAt = String(r.sent_at ?? "");
    (messages[tid] ??= []).push({
      direction: (r.direction as string | null) ?? null,
      from_addr: (r.from_addr as string | null) ?? null,
      to_addrs: r.to_addr ? [String(r.to_addr)] : null,
      subject: (r.subject as string | null) ?? null,
      snippet: (r.snippet as string | null) ?? null,
      body_text: null,
      sent_at: sentAt,
    });
    // 오래된순 정렬이므로 마지막으로 본 것이 최신 → 스레드 요약 갱신
    latest[tid] = {
      thread_id: tid,
      brand_id: (r.brand_id as string | null) ?? null,
      brand_name: (r.brand_name as string | null) ?? null,
      grade: (r.grade as string | null) ?? null,
      state: (r.state as string | null) ?? null,
      plan: (r.plan as string | null) ?? null,
      pay_status: (r.pay_status as string | null) ?? null,
      churn_risk: (r.churn_risk as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      owner_sales: (r.owner_sales as string | null) ?? null,
      direction: (r.direction as string | null) ?? null,
      from_addr: (r.from_addr as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
      snippet: (r.snippet as string | null) ?? null,
      sent_at: sentAt,
      msg_count: (messages[tid] ?? []).length,
    };
  }

  const threads = Object.values(latest).sort(
    (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
  );
  return { threads, messages };
}

async function loadMail(): Promise<{ threads: MailThread[]; messages: Record<string, MailMessage[]> }> {
  const primary = await loadPrimaryThreads();
  if (primary.length > 0) {
    const messages = await loadPrimaryMessages(primary.map((t) => t.thread_id));
    return { threads: primary, messages };
  }
  return loadFallback();
}

export default async function MailPage() {
  const { threads, messages } = await loadMail();

  const noReplyCount = threads.filter(
    (t) => t.direction === "in" && elapsedMs(t.sent_at) >= NO_REPLY_MS
  ).length;

  return (
    <div>
      <ScreenHeader
        title="메일함"
        desc="브랜드 매칭된 메일만 자동 수집 · 질문은 QnA로 답장 초안 · 무응답 감시"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="chip">스레드 {threads.length}</span>
            {noReplyCount > 0 && <span className="chip red">무응답 48h+ {noReplyCount}</span>}
          </div>
        }
      />

      {threads.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✉️</div>
          <b style={{ fontSize: 14 }}>수집된 메일 없음</b>
          <p className="note" style={{ display: "inline-block", marginTop: 12 }}>
            브랜드에 매칭된 메일이 아직 없습니다. Gmail 연동·수집이 실행되면 여기에 스레드가 표시됩니다.
          </p>
        </div>
      ) : (
        <MailClient threads={threads} messages={messages} />
      )}
    </div>
  );
}
