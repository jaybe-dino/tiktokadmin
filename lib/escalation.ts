import { query } from "./db";
import { ownerFieldForState } from "./states";
import { slackPost, slackPostDM } from "./slack";
import { brandAlertCard, sectionText } from "./blocks";
import { setAlertSlack } from "./repo/alerts";
import type { Brand } from "./types";

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

async function slackIdFor(adminUserId: string | null): Promise<string | null> {
  if (!adminUserId) return null;
  const r = await query<{ slack_user_id: string | null }>(
    "SELECT slack_user_id FROM admin_users WHERE id=$1",
    [adminUserId],
  );
  return r[0]?.slack_user_id ?? null;
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

  // 담당 DM (묶음)
  for (const [ownerId, list] of byOwner) {
    const slackId = ownerId === "__unassigned__" ? null : await slackIdFor(ownerId);
    const lines = list.map((a) => `• ${a.message} (${a.kind})`).join("\n");
    if (slackId) {
      await slackPostDM(slackId, {
        text: "오늘 챙길 알림",
        blocks: [sectionText(`*오늘 챙길 알림 ${list.length}건*\n${lines}`)],
      });
      dm++;
    } else {
      // 담당 미지정 → 파트장 채널로
      await slackPost({ channelKey: "leads", blocks: [sectionText(`*담당 미지정 알림 ${list.length}건*\n${lines}`)] });
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
