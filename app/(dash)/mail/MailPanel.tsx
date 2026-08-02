"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GradeBadge, StateBadge, PlanBadge, PayBadge } from "@/components/badges";
import type { Grade, State, Plan } from "@/lib/types";

// 메일함 3분할 클라이언트 (.mail3 .ml .it) — 프로토타입 s-mail 레이아웃.
// 데이터(스레드 목록·스레드별 메시지·브랜드 컨텍스트)는 서버 page.tsx 에서 주입.

export type MailMessage = {
  direction: string | null;
  from_addr: string | null;
  to_addrs: string[] | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  sent_at: string;
};

export type MailThread = {
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
  // 최신 메시지 요약 (목록·무응답 판정용)
  direction: string | null;
  from_addr: string | null;
  subject: string | null;
  snippet: string | null;
  sent_at: string;
  msg_count: number;
};

const NO_REPLY_MS = 48 * 60 * 60 * 1000;

function elapsedMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Date.now() - t;
}

// 무응답: 최신 메시지가 수신(in)이고 48시간 이상 경과
function isNoReply(t: MailThread): boolean {
  return t.direction === "in" && elapsedMs(t.sent_at) >= NO_REPLY_MS;
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
  return addr.split("@")[0] ?? addr;
}

export default function MailPanel({
  threads,
  messages,
}: {
  threads: MailThread[];
  messages: Record<string, MailMessage[]>;
}) {
  // .bar 담당 필터 — 실데이터(owner_sales) 기반. 전체 / 미배정 / 담당자별
  const owners = useMemo(
    () => Array.from(new Set(threads.map((t) => t.owner_sales).filter((o): o is string => !!o))).sort(),
    [threads]
  );
  const [ownerFilter, setOwnerFilter] = useState<string>("__all");

  const visible = useMemo(() => {
    if (ownerFilter === "__all") return threads;
    if (ownerFilter === "__none") return threads.filter((t) => !t.owner_sales);
    return threads.filter((t) => t.owner_sales === ownerFilter);
  }, [threads, ownerFilter]);

  const [selectedId, setSelectedId] = useState<string>(threads[0]?.thread_id ?? "");

  const sel =
    visible.find((t) => t.thread_id === selectedId) ?? visible[0] ?? threads.find((t) => t.thread_id === selectedId) ?? null;
  const selMsgs: MailMessage[] = sel ? messages[sel.thread_id] ?? [] : [];

  return (
    <div>
      {/* 필터 바 (.bar) */}
      <div className="bar">
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="__all">담당: 전체</option>
          <option value="__none">미배정 스레드</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              담당: {o}
            </option>
          ))}
        </select>
        <span className="chip">스레드 {visible.length}</span>
      </div>

      <div className="mail3">
        {/* 왼: 스레드 목록 (.ml .it) */}
        <div className="ml" style={{ maxHeight: 640 }}>
          {visible.length === 0 ? (
            <div className="note" style={{ padding: 16 }}>
              해당 담당의 스레드가 없습니다.
            </div>
          ) : (
            visible.map((t, i) => {
              const on = t.thread_id === (sel?.thread_id ?? "");
              const noReply = isNoReply(t);
              return (
                <div
                  key={t.thread_id || i}
                  className={on ? "it on" : "it"}
                  onClick={() => setSelectedId(t.thread_id)}
                  style={noReply && !on ? { background: "#fff7ed" } : undefined}
                >
                  <div className="fr">
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.brand_name ?? "브랜드 미매칭"} · {senderName(t.from_addr)}
                    </span>
                    <span suppressHydrationWarning>
                      {whenLabel(t.sent_at)}
                      {noReply ? " ⚠️" : ""}
                    </span>
                  </div>
                  <div className="sj" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span className={t.direction === "out" ? "chip grn" : "chip"} style={{ fontSize: 9.5, padding: "1px 6px" }}>
                      {t.direction === "out" ? "발신" : "수신"}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.subject || "(제목 없음)"}
                    </span>
                  </div>
                  <div className="pv">{t.snippet || "미리보기 없음"}</div>
                </div>
              );
            })
          )}
        </div>

        {/* 가운데: 선택 스레드 본문 */}
        <div style={{ padding: "16px 18px", overflowY: "auto", maxHeight: 640 }}>
          {sel ? (
            <>
              <b style={{ fontSize: 14 }}>{sel.subject || "(제목 없음)"}</b>
              <div style={{ color: "var(--ink3)", fontSize: 11.5, margin: "2px 0 12px" }}>
                {senderName(sel.from_addr) || sel.from_addr || "발신자 미상"} · {whenLabel(sel.sent_at)} · 스레드 {sel.msg_count}건 ·{" "}
                {sel.brand_id ? (
                  <Link href={`/brand/${sel.brand_id}`} className="chip" style={{ fontSize: 10 }}>
                    {sel.brand_name ?? "브랜드"} 카드에 자동 기록됨
                  </Link>
                ) : (
                  <span className="chip" style={{ fontSize: 10 }}>브랜드 미매칭</span>
                )}
              </div>

              {selMsgs.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.8,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: 14,
                    background: "#fafbfd",
                  }}
                >
                  {sel.snippet || "이 스레드의 개별 메시지가 수집되지 않았습니다."}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {selMsgs.map((m, i) => {
                    const out = m.direction === "out";
                    return (
                      <div
                        key={i}
                        style={{
                          fontSize: 13,
                          lineHeight: 1.8,
                          border: "1px solid var(--line)",
                          borderRadius: 10,
                          padding: 14,
                          background: out ? "#f5f9ff" : "#fafbfd",
                          borderLeft: out ? "3px solid var(--acc)" : "3px solid var(--ink3)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--ink3)",
                            marginBottom: 8,
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span>
                            <b style={{ color: out ? "var(--acc)" : "var(--ink)" }}>{out ? "발신" : "수신"}</b> · {m.from_addr ?? "발신자 미상"}
                            {m.to_addrs && m.to_addrs.length > 0 ? ` → ${m.to_addrs.join(", ")}` : ""}
                          </span>
                          <span suppressHydrationWarning>{new Date(m.sent_at).toLocaleString("ko-KR")}</span>
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{m.body_text || m.snippet || "본문이 수집되지 않았습니다."}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                {sel.brand_id && (
                  <Link href={`/brand/${sel.brand_id}`} className="btn">
                    타임라인 보기
                  </Link>
                )}
                <button className="btn" type="button">
                  담당 이관
                </button>
              </div>
            </>
          ) : (
            <div className="note">선택된 스레드가 없습니다.</div>
          )}
        </div>

        {/* 오른: 브랜드 컨텍스트 + AI 답장 초안 */}
        <div style={{ borderLeft: "1px solid var(--line)", padding: 14, background: "#fcfaff", overflowY: "auto", maxHeight: 640 }}>
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
                      <dt>담당(영업)</dt>
                      <dd>{sel.owner_sales || "-"}</dd>
                      <dt>이탈위험</dt>
                      <dd>
                        <span
                          className={sel.churn_risk === "high" ? "chip red" : sel.churn_risk === "mid" ? "chip amb" : "chip grn"}
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
                <h5>
                  🤖 AI 답장 초안 <span className="chip" style={{ fontSize: 10 }}>QnA 매칭 대기</span>
                </h5>
                <div style={{ fontSize: 12, lineHeight: 1.75, color: "var(--ink3)" }}>
                  수신 메일의 질문을 QnA 지식베이스와 매칭해 답장 초안을 생성합니다. 승인 시 접촉 기록이 자동 갱신되어 무응답 알림이 해제됩니다.
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button className="btn" style={{ flex: 1 }} type="button">
                  ✏️ 수정
                </button>
                <button className="btn grn" style={{ flex: 1 }} type="button" disabled>
                  승인·발송
                </button>
              </div>
              <div className="note" style={{ marginTop: 10 }}>
                발송 시 접촉 기록 자동 갱신 → 방치 알림 해제
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
