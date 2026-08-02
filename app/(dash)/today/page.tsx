import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge, StateBadge } from "@/components/badges";
import { query, queryOne } from "@/lib/db";
import type { Grade, State } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function num(v: unknown): number {
  return Number(v ?? 0);
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  try {
    return new Date(v as string).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  } catch {
    return "—";
  }
}

function fmtDateTime(v: unknown): string {
  if (!v) return "—";
  try {
    return new Date(v as string).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

async function count(sql: string): Promise<number> {
  const r = await queryOne<{ c: string }>(sql).catch(() => null);
  return num(r?.c);
}

export default async function TodayPage() {
  const todayLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  // ── 상단 4개 타일 (인라인 count) ──────────────────────────────
  const [meetingsToday, unassigned, slaBreach, approvalsPending] = await Promise.all([
    count(
      `SELECT count(*) c FROM meetings
        WHERE scheduled_at::date = CURRENT_DATE
          AND coalesce(status,'') NOT IN ('canceled','error')`,
    ),
    count(
      `SELECT count(*) c FROM brands
        WHERE coalesce(is_test,false) = false
          AND state NOT IN ('dropped','churned')
          AND owner_sales IS NULL AND owner_intake IS NULL
          AND owner_onboard IS NULL AND owner_ads IS NULL`,
    ),
    count(
      `SELECT count(*) c FROM alerts
        WHERE kind = 'sla_breach' AND resolved_at IS NULL`,
    ),
    count(
      `SELECT count(*) c FROM approval_requests WHERE status = 'pending'`,
    ),
  ]);

  // ── 좌: 오늘 할 일 (기한 도래 + 진행중) ────────────────────────
  const todos = (await query(
    `SELECT id, brand_name, grade, state, next_action, due_date
       FROM brands
      WHERE coalesce(is_test,false) = false
        AND state NOT IN ('dropped','churned')
        AND due_date IS NOT NULL
        AND due_date <= CURRENT_DATE
      ORDER BY due_date ASC
      LIMIT 12`,
  ).catch(() => [])) as Row[];

  // ── 좌: SLA 위반 알림 ─────────────────────────────────────────
  const slaAlerts = (await query(
    `SELECT a.brand_id, a.tier, a.message, a.created_at,
            b.brand_name, b.grade, b.state
       FROM alerts a
       LEFT JOIN brands b ON b.id = a.brand_id
      WHERE a.kind = 'sla_breach' AND a.resolved_at IS NULL
      ORDER BY a.tier DESC NULLS LAST, a.created_at DESC
      LIMIT 10`,
  ).catch(() => [])) as Row[];

  // ── 우: 오늘/이번주 미팅 ──────────────────────────────────────
  const meetings = (await query(
    `SELECT m.id, m.topic, m.scheduled_at, m.status, m.host_email,
            m.brand_id, b.brand_name, b.grade
       FROM meetings m
       LEFT JOIN brands b ON b.id = m.brand_id
      WHERE m.scheduled_at IS NOT NULL
        AND m.scheduled_at::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 6
        AND coalesce(m.status,'') NOT IN ('canceled','error')
      ORDER BY m.scheduled_at ASC
      LIMIT 12`,
  ).catch(() => [])) as Row[];

  // ── 우: 최근 유입 리드 ────────────────────────────────────────
  const recentLeads = (await query(
    `SELECT id, brand_name, grade, state, category, created_at
       FROM brands
      WHERE coalesce(is_test,false) = false
      ORDER BY created_at DESC NULLS LAST
      LIMIT 5`,
  ).catch(() => [])) as Row[];

  return (
    <div>
      <ScreenHeader
        title={`오늘 — ${todayLabel}`}
        desc="오늘 처리해야 할 미팅·할 일·SLA 위반·승인 대기를 한눈에 확인하세요."
      />

      {/* 상단 4개 타일 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-3.5">
        <div className="tile">
          <div className="tile-k">오늘 미팅</div>
          <div className="tile-v">{meetingsToday}</div>
        </div>
        <div className="tile">
          <div className="tile-k">담당 미배정</div>
          <div className="tile-v" style={{ color: unassigned > 0 ? "var(--warn)" : undefined }}>{unassigned}</div>
        </div>
        <div className={`tile${slaBreach > 0 ? " alert" : ""}`}>
          <div className="tile-k">SLA 위반</div>
          <div className="tile-v" style={{ color: slaBreach > 0 ? "var(--danger)" : undefined }}>{slaBreach}</div>
        </div>
        <div className="tile">
          <div className="tile-k">승인 대기</div>
          <div className="tile-v" style={{ color: approvalsPending > 0 ? "var(--acc)" : undefined }}>{approvalsPending}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* 좌측 컬럼 */}
        <div className="grid gap-3.5 content-start">
          {/* 오늘 할 일 */}
          <div className="card">
            <div className="card-hd">
              <b>오늘 할 일</b>
              <span className="chip chip-amb">{todos.length}건</span>
              <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: 11 }}>기한 도래 · 진행 중</span>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              {todos.length === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>기한이 도래한 할 일이 없습니다.</p>}
              {todos.map((t) => (
                <div className="row" key={t.id as string}>
                  <span className="ico i-amb">⏰</span>
                  <div>
                    <div className="tt">
                      <Link href={`/brand/${t.id}`} className="hover:underline">{(t.brand_name as string) || "이름 없음"}</Link>{" "}
                      <GradeBadge grade={(t.grade as Grade) ?? null} />
                    </div>
                    <div className="ss">
                      {(t.next_action as string) || "다음 액션 미지정"}
                      {" · "}기한 {fmtDate(t.due_date)}
                    </div>
                  </div>
                  <div className="rt">
                    <StateBadge state={t.state as State} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SLA 위반 알림 */}
          <div className="card">
            <div className="card-hd">
              <b>SLA 위반 알림</b>
              <span className="chip chip-red">{slaAlerts.length}건</span>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              {slaAlerts.length === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>미해소 SLA 위반이 없습니다.</p>}
              {slaAlerts.map((a, i) => (
                <div className="row" key={`${a.brand_id as string}-${i}`}>
                  <span className="ico i-red">🚨</span>
                  <div>
                    <div className="tt">
                      {a.brand_id ? (
                        <Link href={`/brand/${a.brand_id}`} className="hover:underline">{(a.brand_name as string) || "브랜드"}</Link>
                      ) : (
                        <span>브랜드 미상</span>
                      )}{" "}
                      <span className={`sla t${Math.min(3, Math.max(1, num(a.tier) || 1))}`}>T{num(a.tier) || 1}</span>
                    </div>
                    <div className="ss">{(a.message as string) || "SLA 위반"} · {fmtDateTime(a.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 우측 컬럼 */}
        <div className="grid gap-3.5 content-start">
          {/* 오늘/이번주 미팅 */}
          <div className="card">
            <div className="card-hd">
              <b>오늘·이번 주 미팅</b>
              <span className="chip">{meetings.length}건</span>
              <div className="rt" style={{ marginLeft: "auto" }}>
                <Link href="/meetings" className="btn btn-sm">캘린더 →</Link>
              </div>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              {meetings.length === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>예정된 미팅이 없습니다.</p>}
              {meetings.map((m) => (
                <div className="row" key={m.id as string}>
                  <span className="ico i-blu">📹</span>
                  <div>
                    <div className="tt">
                      {fmtDateTime(m.scheduled_at)}{" "}
                      {m.brand_id ? (
                        <Link href={`/brand/${m.brand_id}`} className="hover:underline">{(m.brand_name as string) || "브랜드"}</Link>
                      ) : (
                        <span style={{ color: "var(--warn)" }}>매칭 필요</span>
                      )}{" "}
                      {m.grade ? <GradeBadge grade={m.grade as Grade} /> : null}
                    </div>
                    <div className="ss">{(m.topic as string) || "주제 미정"}{m.host_email ? ` · ${m.host_email as string}` : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 최근 유입 리드 */}
          <div className="card">
            <div className="card-hd">
              <b>최근 유입 리드</b>
              <div className="rt" style={{ marginLeft: "auto" }}>
                <Link href="/customers" className="btn btn-sm">전체 →</Link>
              </div>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              {recentLeads.length === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>최근 유입된 리드가 없습니다.</p>}
              {recentLeads.map((b) => (
                <div className="row" key={b.id as string}>
                  <span className="ico i-grn">🆕</span>
                  <div>
                    <div className="tt">
                      <Link href={`/brand/${b.id}`} className="hover:underline">{(b.brand_name as string) || "이름 없음"}</Link>{" "}
                      <GradeBadge grade={(b.grade as Grade) ?? null} />
                    </div>
                    <div className="ss">
                      {(b.category as string) || "카테고리 미상"} · {fmtDate(b.created_at)}
                    </div>
                  </div>
                  <div className="rt">
                    <StateBadge state={b.state as State} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
