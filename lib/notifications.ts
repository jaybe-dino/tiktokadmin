// 상단 알림(종) — 현재 사용자의 "지금 할 일"을 실시간 집계(레이아웃에서 매 페이지 호출되므로 가볍게).
//   담당(어느 역할이든 나) 브랜드의 미해결 알림 + 승인 대기 초안을 모은다.
import { query } from "./db";

export interface NotifItem {
  id: string;
  kind: string;      // alert kind | 'draft'
  title: string;     // 브랜드명
  detail: string;    // 할 일 설명
  priority: number;  // 0=최우선
  brand_id: string | null;
  link: string;      // 이동 경로(앱 내부)
}

const ALERT_META: Record<string, { label: string; pri: number }> = {
  inbound_fwd: { label: "고객 메일 회신 필요", pri: 0 },
  reply_needed: { label: "고객 메일 회신 필요", pri: 0 },
  sla_breach: { label: "SLA 지연", pri: 0 },
  no_reply: { label: "무응답 재접촉", pri: 1 },
  gate_violation: { label: "게이트 미충족", pri: 1 },
  doc_missing: { label: "서류 보완", pri: 1 },
  pay_overdue: { label: "결제 연체", pri: 1 },
  stale: { label: "장기 방치 점검", pri: 2 },
};

/** 현재 사용자(담당) 기준 실시간 할 일 목록 + 개수. */
export async function myNotifications(userId: string): Promise<{ count: number; items: NotifItem[] }> {
  if (!userId) return { count: 0, items: [] };

  const [alerts, drafts] = await Promise.all([
    query<{ id: string; kind: string; tier: number; message: string; brand_id: string; brand_name: string }>(
      `SELECT a.id, a.kind, a.tier, a.message, b.id AS brand_id, b.brand_name
         FROM alerts a JOIN brands b ON b.id = a.brand_id
        WHERE a.resolved_at IS NULL
          AND (a.snoozed_until IS NULL OR a.snoozed_until < now())
          AND b.state NOT IN ('dropped','churned') AND coalesce(b.is_test,false)=false
          AND $1 IN (b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads, b.owner_contract)
        ORDER BY a.tier DESC, a.created_at DESC LIMIT 30`,
      [userId],
    ).catch(() => []),
    query<{ id: string; subject: string | null; kind: string; brand_id: string; brand_name: string }>(
      `SELECT d.id, d.subject, d.kind, b.id AS brand_id, b.brand_name
         FROM email_drafts d JOIN brands b ON b.id = d.brand_id
        WHERE d.status = 'draft'
          AND b.state NOT IN ('dropped','churned') AND coalesce(b.is_test,false)=false
          AND $1 IN (b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads, b.owner_contract)
        ORDER BY d.created_at DESC LIMIT 30`,
      [userId],
    ).catch(() => []),
  ]);

  const items: NotifItem[] = [];
  for (const a of alerts) {
    const meta = ALERT_META[a.kind] ?? { label: a.message || a.kind, pri: 2 };
    items.push({
      id: `al-${a.id}`, kind: a.kind, title: a.brand_name,
      detail: meta.label, priority: a.tier >= 3 ? 0 : meta.pri,
      brand_id: a.brand_id, link: `/brand/${a.brand_id}`,
    });
  }
  for (const d of drafts) {
    items.push({
      id: `dr-${d.id}`, kind: "draft", title: d.brand_name,
      detail: `AI 초안 검토·발송${d.subject ? ` — ${d.subject}` : ""}`, priority: 1,
      brand_id: d.brand_id, link: "/drafts",
    });
  }

  items.sort((a, b) => a.priority - b.priority);
  return { count: items.length, items: items.slice(0, 20) };
}
