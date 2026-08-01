import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge, StateBadge, PlanBadge, PayBadge } from "@/components/badges";
import { query } from "@/lib/db";
import Link from "next/link";
import type { Grade, State, Plan } from "@/lib/types";

export const dynamic = "force-dynamic";

// 메일함 3분할 — 스레드목록(왼) · 본문(가운데) · 브랜드 컨텍스트(오)
// 데이터: email_messages(없으면 brand_emails 폴백) + brands 조인. 미응답(48h+) 감시.

type Thread = {
  thread_id: string;
  brand_id: string | null;
  brand_name: string | null;
  grade: string | null;
  state: string | null;
  plan: string | null;
  pay_status: string | null;
  churn_risk: string | null;
  category: string | null;
  owner_sales: string | null;
  direction: string | null;
  from_addr: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  sent_at: string;
  msg_count: number;
};

const NO_REPLY_MS = 48 * 60 * 60 * 1000;

function elapsedMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Date.now() - t;
}

// 상대 시간 라벨 — 오늘이면 HH:mm, 어제, N일 전
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (days === 1) return "어제";
  return `${days}일 전`;
}

// 발신자 표시 이름 (이메일 로컬파트)
function senderName(addr: string | null): string {
  if (!addr) return "";
  const local = addr.split("@")[0] ?? addr;
  return local;
}

async function loadThreads(): Promise<Thread[]> {
  const brandCols = `
    b.brand_name, b.grade, b.state, b.plan, b.pay_status, b.churn_risk,
    b.category, b.owner_sales`;

  // 1차: email_messages — thread_id 별 최신 메시지 1건
  const primary = await query<Thread>(
    `SELECT x.* FROM (
       SELECT DISTINCT ON (m.thread_id)
         m.thread_id, m.brand_id, m.direction, m.from_addr, m.subject,
         m.snippet, m.body_text, m.sent_at,
         (SELECT count(*)::int FROM email_messages m2 WHERE m2.thread_id = m.thread_id) AS msg_count,
         ${brandCols}
       FROM email_messages m
       LEFT JOIN brands b ON b.id = m.brand_id
       ORDER BY m.thread_id, m.sent_at DESC
     ) x
     ORDER BY x.sent_at DESC
     LIMIT 40`
  ).catch(() => [] as Thread[]);

  if (primary.length > 0) return primary;

  // 2차 폴백: brand_emails — brand_id 별 최신 1건
  const fallback = await query<Record<string, unknown>>(
    `SELECT DISTINCT ON (e.brand_id)
       e.brand_id, e.direction, e.from_addr, e.subject, e.snippet,
       e.occurred_at AS sent_at,
       (SELECT count(*)::int FROM brand_emails e2 WHERE e2.brand_id = e.brand_id) AS msg_count,
       ${brandCols}
     FROM brand_emails e
     LEFT JOIN brands b ON b.id = e.brand_id
     ORDER BY e.brand_id, e.occurred_at DESC
     LIMIT 40`
  ).catch(() => [] as Record<string, unknown>[]);

  return fallback
    .map((r): Thread => ({
      thread_id: String(r.brand_id ?? ""),
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
      body_text: null,
      sent_at: String(r.sent_at ?? ""),
      msg_count: Number(r.msg_count ?? 1),
    }))
    .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
}

export default async function MailPage() {
  const threads = await loadThreads();

  const isNoReply = (t: Thread) => t.direction === "in" && elapsedMs(t.sent_at) >= NO_REPLY_MS;
  const noReplyCount = threads.filter(isNoReply).length;

  const sel = threads[0] ?? null;

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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "290px 1fr 300px",
            gap: 0,
            border: "1px solid var(--line)",
            borderRadius: 12,
            overflow: "hidden",
            background: "#fff",
            minHeight: 520,
          }}
        >
          {/* 왼: 스레드 목록 */}
          <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto" }}>
            {threads.map((t, i) => {
              const on = i === 0;
              const noReply = isNoReply(t);
              return (
                <div
                  key={t.thread_id || i}
                  style={{
                    padding: "11px 14px",
                    borderBottom: "1px solid #f0f3f8",
                    cursor: "pointer",
                    background: on ? "#eff6ff" : noReply ? "#fff7ed" : "#fff",
                    borderLeft: on ? "3px solid var(--acc)" : "3px solid transparent",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.brand_name ?? "브랜드 미매칭"} · {senderName(t.from_addr)}
                    </span>
                    <span style={{ color: "var(--ink3)", fontWeight: 400, fontSize: 10.5, flexShrink: 0 }}>
                      {whenLabel(t.sent_at)}
                      {noReply ? " ⚠️" : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, marginTop: 1 }}>{t.subject || "(제목 없음)"}</div>
                  <div
                    style={{
                      color: "var(--ink3)",
                      fontSize: 11,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {t.snippet || "미리보기 없음"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 가운데: 본문 */}
          <div style={{ padding: "16px 18px" }}>
            {sel && (
              <>
                <b style={{ fontSize: 14 }}>{sel.subject || "(제목 없음)"}</b>
                <div style={{ color: "var(--ink3)", fontSize: 11.5, margin: "2px 0 12px" }}>
                  {sel.from_addr ?? "발신자 미상"}
                  {sel.direction === "in" ? " → 나" : sel.direction === "out" ? " · 발신" : ""} ·{" "}
                  {new Date(sel.sent_at).toLocaleString("ko-KR")} · 스레드 {sel.msg_count}건 ·{" "}
                  {sel.brand_id ? (
                    <Link href={`/brand/${sel.brand_id}`} className="chip" style={{ fontSize: 10 }}>
                      {sel.brand_name ?? "브랜드"} 카드로 이동
                    </Link>
                  ) : (
                    <span className="chip" style={{ fontSize: 10 }}>브랜드 미매칭</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.8,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: 14,
                    background: "#fafbfd",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {sel.body_text || sel.snippet || "본문이 수집되지 않았습니다."}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  {sel.brand_id && (
                    <Link href={`/brand/${sel.brand_id}`} className="btn">
                      타임라인 보기
                    </Link>
                  )}
                  <button className="btn" type="button">담당 이관</button>
                </div>
              </>
            )}
          </div>

          {/* 오른: 브랜드 컨텍스트 + AI 답장 초안 */}
          <div style={{ borderLeft: "1px solid var(--line)", padding: 14, background: "#fcfaff" }}>
            {sel && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 700, marginBottom: 6 }}>브랜드 컨텍스트</div>
                  {sel.brand_id ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        <b style={{ fontSize: 13 }}>{sel.brand_name ?? "브랜드"}</b>
                        {sel.grade && <GradeBadge grade={sel.grade as Grade} />}
                        {sel.state && <StateBadge state={sel.state as State} />}
                      </div>
                      <dl className="kv">
                        <dt>플랜</dt>
                        <dd>{sel.plan ? <PlanBadge plan={sel.plan as Plan} /> : <span style={{ color: "var(--ink3)" }}>미정</span>}</dd>
                        <dt>결제</dt>
                        <dd>{sel.pay_status ? <PayBadge status={sel.pay_status} /> : <span style={{ color: "var(--ink3)" }}>-</span>}</dd>
                        <dt>카테고리</dt>
                        <dd>{sel.category || "-"}</dd>
                        <dt>이탈위험</dt>
                        <dd>
                          <span
                            className={
                              sel.churn_risk === "high" ? "chip red" : sel.churn_risk === "mid" ? "chip amb" : "chip grn"
                            }
                            style={{ fontSize: 10 }}
                          >
                            {sel.churn_risk === "high" ? "높음" : sel.churn_risk === "mid" ? "중간" : "낮음"}
                          </span>
                        </dd>
                      </dl>
                    </>
                  ) : (
                    <p className="note">이 스레드는 아직 브랜드에 매칭되지 않았습니다.</p>
                  )}
                </div>

                <div className="aiw">
                  <h5>🤖 AI 답장 초안 <span className="chip" style={{ fontSize: 10 }}>QnA 매칭 대기</span></h5>
                  <div style={{ fontSize: 12, lineHeight: 1.75, color: "var(--ink3)" }}>
                    수신 메일의 질문을 QnA 지식베이스와 매칭해 답장 초안을 생성합니다. 승인 시 접촉 기록이
                    자동 갱신되어 무응답 알림이 해제됩니다.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button className="btn" style={{ flex: 1 }} type="button">✏️ 수정</button>
                  <button className="btn grn" style={{ flex: 1 }} type="button">승인·발송</button>
                </div>
                <div className="note" style={{ marginTop: 10 }}>
                  발송 시 접촉 기록 자동 갱신 → 방치 알림 해제
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
