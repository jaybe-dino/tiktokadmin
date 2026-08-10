import { query } from "./db";
import { ownerFieldForState } from "./states";
import { slackPost, slackPostDM } from "./slack";
import { brandAlertCard, sectionText } from "./blocks";
import { setAlertSlack } from "./repo/alerts";
import { STATE_LABELS, type Brand, type State } from "./types";

// 알림 종류 → 담당자가 해야 할 일(한글).
const TODO_BY_KIND: Record<string, string> = {
  sla_breach: "단계 지연 — 다음 액션 진행",
  doc_missing: "서류 수급 독촉·확인",
  stale: "접촉 공백 — 재접촉",
  pay_overdue: "결제 지연 — 결제 안내·확인",
  gate_violation: "게이트 미충족 — 필수 항목 보완",
};
const adminBase = () => (process.env.ADMIN_URL || "").replace(/\/$/, "");

// 에스컬레이션 사다리 + 일일 다이제스트 (03 §5, 05 §6).

interface AlertRow {
  id: string;
  brand_id: string;
  kind: string;
  tier: number;
  message: string;
  slack_ts: string | null;
  channel: string | null;
  brand: Brand;
}

async function activeAlertsWithBrand(): Promise<AlertRow[]> {
  const rows = await query<AlertRow & Record<string, unknown>>(
    `SELECT a.id, a.brand_id, a.kind, a.tier, a.message, a.slack_ts, a.channel,
            row_to_json(b.*) AS brand
       FROM alerts a JOIN brands b ON b.id=a.brand_id
      WHERE a.resolved_at IS NULL
        AND (a.snoozed_until IS NULL OR a.snoozed_until < now())
      ORDER BY a.tier DESC, a.created_at ASC`,
  );
  return rows.map((r) => ({ ...r, brand: r.brand as Brand }));
}

function ownerSlackField(brand: Brand): keyof Brand | null {
  return ownerFieldForState(brand.state);
}

// 담당자 Slack 타겟 — slack_user_id 가 있으면 사용, 없으면 담당자 이메일(=admin_users.id)로 DM(lookupByEmail).
async function slackIdFor(adminUserId: string | null): Promise<string | null> {
  if (!adminUserId) return null;
  const r = await query<{ slack_user_id: string | null }>(
    "SELECT slack_user_id FROM admin_users WHERE id=$1",
    [adminUserId],
  );
  if (r[0]?.slack_user_id) return r[0].slack_user_id;
  // slack_user_id 미설정 → 담당자 이메일이 곧 슬랙 ID. slackPostDM 이 이메일을 lookupByEmail 로 처리.
  return adminUserId.includes("@") ? adminUserId : null;
}

/**
 * /api/cron/escalate — 매일 09:00, 14:00 KST.
 *  tier 0/1 → 담당 DM, tier 2 → 파트장 채널, tier 3 → 대표(exec) + 데일리 적색.
 * 같은 담당의 다수 알림은 1개 다이제스트로 묶음.
 */
export async function runEscalate(): Promise<{ dm: number; leads: number; exec: number }> {
  const alerts = await activeAlertsWithBrand();
  let dm = 0, leads = 0, execCount = 0;

  // 담당별 묶음(tier<2)
  const byOwner = new Map<string, AlertRow[]>();
  const leadsAlerts: AlertRow[] = [];
  const execAlerts: AlertRow[] = [];

  for (const a of alerts) {
    if (a.tier >= 3) execAlerts.push(a);
    else if (a.tier >= 2) leadsAlerts.push(a);
    else {
      const ownerField = ownerSlackField(a.brand);
      const ownerId = ownerField ? (a.brand[ownerField] as string | null) : null;
      const key = ownerId ?? "__unassigned__";
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key)!.push(a);
    }
  }

  // 담당별 "해야 할 일" 다이제스트 — Slack DM + 이메일. 브랜드·단계·할 일·링크 포함.
  const base = adminBase();
  const stageKo = (s: string) => STATE_LABELS[s as State] ?? s;
  const todoOf = (kind: string) => TODO_BY_KIND[kind] ?? "확인 필요";
  for (const [ownerId, list] of byOwner) {
    const slackId = ownerId === "__unassigned__" ? null : await slackIdFor(ownerId);
    // Slack 라인: • *브랜드* — 단계 · 할 일 (경과) <링크|열기>
    const slackLines = list.map((a) => {
      const link = base ? ` <${base}/brand/${a.brand_id}|열기>` : "";
      return `• *${a.brand.brand_name}* — ${stageKo(a.brand.state)} · ${todoOf(a.kind)} _(${a.message})_${link}`;
    }).join("\n");
    const header = `*⏰ SLA 지연 — 오늘 처리할 일 ${list.length}건*`;
    if (slackId) {
      await slackPostDM(slackId, { text: "오늘 처리할 일", blocks: [sectionText(`${header}\n${slackLines}`)] });
      dm++;
    } else {
      // 담당 미지정 → 파트장 채널로
      await slackPost({ channelKey: "leads", blocks: [sectionText(`*담당 미지정 · 처리 필요 ${list.length}건*\n${slackLines}`)] });
    }
    // Slack 외 이메일 병행(담당자 회사 메일 = admin_users.id). RESEND 미설정 시 조용히 스킵.
    if (ownerId !== "__unassigned__" && ownerId.includes("@")) {
      const { sendEmail } = await import("./mailer");
      const emailLines = list.map((a) => {
        const link = base ? ` → ${base}/brand/${a.brand_id}` : "";
        return `- [${stageKo(a.brand.state)}] ${a.brand.brand_name} · ${todoOf(a.kind)} (${a.message})${link}`;
      }).join("\n");
      await sendEmail({
        to: ownerId,
        subject: `[GloveK] 오늘 처리할 일 ${list.length}건 (SLA 지연)`,
        text: `담당 브랜드 중 SLA 일정이 지난 항목입니다. 아래 항목을 오늘 처리해 주세요.\n\n${emailLines}\n\n워크큐: ${base}/queue`,
      }).catch(() => {});
    }
    // 첫 알림에 카드 부착(대표 1건)
    for (const a of list) {
      if (a.slack_ts) continue;
      const posted = await slackPost({
        channelKey: "intake",
        blocks: brandAlertCard(a.brand, { headline: a.message, alertId: a.id }),
      });
      if (posted.ok && posted.ts && posted.channel) await setAlertSlack(a.id, posted.ts, posted.channel);
    }
  }

  // tier2 → 파트장 채널
  for (const a of leadsAlerts) {
    const posted = await slackPost({
      channelKey: "leads",
      blocks: brandAlertCard(a.brand, { headline: `[T2] ${a.message}`, alertId: a.id }),
    });
    if (posted.ok && posted.ts && posted.channel) await setAlertSlack(a.id, posted.ts, posted.channel);
    leads++;
  }

  // tier3 → exec + 데일리 적색
  if (execAlerts.length) {
    const lines = execAlerts.map((a) => `🔴 ${a.brand.brand_name} · ${a.message}`).join("\n");
    await slackPost({ channelKey: "daily", blocks: [sectionText(`*[T3 · 대표 확인 필요] ${execAlerts.length}건*\n${lines}`)] });
    execCount = execAlerts.length;
  }

  return { dm, leads, exec: execCount };
}

/** 일일 다이제스트 (05 §6) → CH_DAILY. */
export async function runDailyDigest(): Promise<void> {
  const [tier2, dueToday, newLeads, pastDue, doneYesterday] = await Promise.all([
    query<{ n: string }>("SELECT count(*)::text n FROM alerts WHERE resolved_at IS NULL AND tier>=2"),
    query<{ n: string }>("SELECT count(*)::text n FROM brands WHERE due_date = current_date"),
    query<{ n: string }>("SELECT count(*)::text n FROM brands WHERE created_at > now() - interval '1 day'"),
    query<{ n: string }>("SELECT count(*)::text n FROM brands WHERE pay_status='past_due'"),
    query<{ n: string }>("SELECT count(*)::text n FROM stage_history WHERE gate_passed AND at > now() - interval '1 day'"),
  ]);
  const text =
    `*📋 Glovek 일일 다이제스트*\n` +
    `⚠️ tier2+ ${tier2[0].n}건 · 오늘 마감 ${dueToday[0].n} · 신규 리드 ${newLeads[0].n} · ` +
    `결제 past_due ${pastDue[0].n} · 어제 처리 ${doneYesterday[0].n}`;
  await slackPost({ channelKey: "daily", blocks: [sectionText(text)] });
}
