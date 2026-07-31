import { query, queryOne, queryRo } from "./db";
import { brand360, insightsData } from "./repo/queries";
import { docProgress } from "./docs";
import { draftReminder as draftReminderFn } from "./brief";
import { buildBriefMarkdown } from "./brief";
import { opsTransition } from "./ops";
import { assignOwner } from "./transition";
import { touchLastContact, setFields } from "./repo/brands";
import { slackPost } from "./slack";
import { gradeFromChecks, recommendedTrack, type SelfChecks } from "./grade";
import { businessDaysBetween } from "./time";
import type { OpsActor } from "./ops-auth";
import type { Brand, OwnerField, State } from "./types";

// 도메인 MCP 툴 (06-MCP-AGENTS §1). 읽기=직접 SELECT, 쓰기=ops 경유.
// MCP 서버와 Slack /ask 가 공유. actorName 은 mcp:{agent} 또는 slack:{user}.

function actorFor(name: string): OpsActor {
  return { actor: name.startsWith("mcp:") || name.startsWith("slack:") ? name : `mcp:${name}`, role: "exec" };
}

export interface ToolDef {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, actorName: string) => Promise<unknown>;
}

export const TOOLS: Record<string, ToolDef> = {
  list_brands: {
    description: "브랜드 목록 조회(필터: state, owner, plan, grade, churn_risk, overdue_only, q).",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string" }, owner: { type: "string" }, plan: { type: "string" },
        grade: { type: "string" }, churn_risk: { type: "string" },
        overdue_only: { type: "boolean" }, q: { type: "string" }, limit: { type: "number" },
      },
    },
    async handler(a) {
      const where: string[] = ["1=1"];
      const p: unknown[] = [];
      const eq = (col: string, val: unknown) => { p.push(val); where.push(`${col}=$${p.length}`); };
      if (a.state) eq("state", a.state);
      if (a.plan) eq("plan", a.plan);
      if (a.grade) eq("grade", a.grade);
      if (a.churn_risk) eq("churn_risk", a.churn_risk);
      if (a.overdue_only) where.push("due_date < current_date");
      if (a.q) {
        p.push(`%${a.q}%`);
        where.push(`(brand_name ILIKE $${p.length} OR email ILIKE $${p.length})`);
      }
      if (a.owner) {
        p.push(a.owner);
        const n = p.length;
        where.push(`(owner_intake=$${n} OR owner_sales=$${n} OR owner_onboard=$${n} OR owner_ads=$${n})`);
      }
      const limit = Number(a.limit ?? 50);
      const rows = await query<Brand>(
        `SELECT * FROM brands WHERE ${where.join(" AND ")} ORDER BY stage_entered_at ASC LIMIT ${limit}`,
        p,
      );
      const now = new Date();
      return {
        brands: rows.map((b) => ({
          id: b.id, brand_name: b.brand_name, state: b.state, grade: b.grade, plan: b.plan,
          pay_status: b.pay_status,
          owners: { intake: b.owner_intake, sales: b.owner_sales, onboard: b.owner_onboard, ads: b.owner_ads },
          days_in_stage: businessDaysBetween(new Date(b.stage_entered_at), now),
          next_action: b.next_action, due_date: b.due_date,
        })),
      };
    },
  },

  get_brand_360: {
    description: "브랜드 360 상세(브랜드·신호·서류·결제·이력·활성알림).",
    inputSchema: { type: "object", properties: { brand_id: { type: "string" } }, required: ["brand_id"] },
    async handler(a) {
      const d = await brand360(String(a.brand_id));
      if (!d) return { error: "not_found" };
      return {
        brand: d.brand, signals: d.signals,
        doc_progress: { done: d.docs.done, total: d.docs.total, items: d.docs.items },
        payments: { subs: d.glovekSubs, manual: d.paymentsManual },
        history: d.timeline.slice(0, 20), active_alerts: d.alerts,
      };
    },
  },

  find_sla_breaches: {
    description: "활성 SLA/방치 알림.",
    inputSchema: { type: "object", properties: { tier_min: { type: "number" } } },
    async handler(a) {
      const tierMin = Number(a.tier_min ?? 0);
      const rows = await query<{ brand_id: string; brand_name: string; kind: string; tier: number; message: string; owner_intake: string | null; owner_sales: string | null; owner_onboard: string | null; owner_ads: string | null }>(
        `SELECT a.brand_id, b.brand_name, a.kind, a.tier, a.message,
                b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads
           FROM alerts a JOIN brands b ON b.id=a.brand_id
          WHERE a.resolved_at IS NULL AND a.kind IN ('sla_breach','stale') AND a.tier>=$1
          ORDER BY a.tier DESC`,
        [tierMin],
      );
      return { alerts: rows };
    },
  },

  find_gate_violations: {
    description: "최근 게이트 위반 이력.",
    inputSchema: { type: "object", properties: { since_days: { type: "number" } } },
    async handler(a) {
      const days = Number(a.since_days ?? 7);
      const rows = await query(
        `SELECT b.brand_name, sh.reason, sh.at, sh.actor
           FROM stage_history sh JOIN brands b ON b.id=sh.brand_id
          WHERE sh.gate_passed=false AND sh.at > now() - ($1 || ' days')::interval
          ORDER BY sh.at DESC LIMIT 100`,
        [days],
      );
      return { violations: rows };
    },
  },

  find_missing_docs: {
    description: "서류 미완 브랜드 목록.",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      const brands = await query<Brand>("SELECT * FROM brands WHERE state='docs'");
      const now = new Date();
      const out = [];
      for (const b of brands) {
        const prog = await docProgress(b.id);
        if (prog.total > 0 && prog.done < prog.total) {
          out.push({
            brand_id: b.id, missing_items: prog.missing,
            days_in_docs: businessDaysBetween(new Date(b.stage_entered_at), now),
            owner_onboard: b.owner_onboard,
          });
        }
      }
      return { brands: out };
    },
  },

  transition_stage: {
    description: "상태 전이(게이트 검증). 에이전트는 제안만 — 실행은 사람 권장.",
    inputSchema: {
      type: "object",
      properties: { brand_id: { type: "string" }, to_state: { type: "string" }, reason: { type: "string" } },
      required: ["brand_id", "to_state"],
    },
    async handler(a, actorName) {
      const res = await opsTransition(actorFor(actorName), {
        brand_id: String(a.brand_id), to_state: a.to_state as State, reason: a.reason as string | undefined,
      });
      return res.ok ? { ok: true } : { ok: false, failed: res.failed, error: res.error };
    },
  },

  assign_owner: {
    description: "담당 배정.",
    inputSchema: {
      type: "object",
      properties: { brand_id: { type: "string" }, role: { type: "string" }, admin_user_id: { type: "string" } },
      required: ["brand_id", "role", "admin_user_id"],
    },
    async handler(a) {
      return assignOwner(String(a.brand_id), a.role as OwnerField, String(a.admin_user_id));
    },
  },

  log_contact: {
    description: "접촉 기록.",
    inputSchema: {
      type: "object",
      properties: { brand_id: { type: "string" }, channel: { type: "string" }, note: { type: "string" } },
      required: ["brand_id"],
    },
    async handler(a) {
      await touchLastContact(String(a.brand_id));
      return { ok: true };
    },
  },

  draft_reminder: {
    description: "브랜드 발송용 리마인더 초안(한국어). 매번 새로 생성.",
    inputSchema: {
      type: "object",
      properties: { brand_id: { type: "string" }, channel: { type: "string" } },
      required: ["brand_id"],
    },
    async handler(a) {
      return draftReminderFn(String(a.brand_id), (a.channel as "email" | "sms") ?? "email");
    },
  },

  send_alert: {
    description: "Slack 채널 발송(channel_key: intake|onboard|ads|pay|leads|daily).",
    inputSchema: {
      type: "object",
      properties: { channel_key: { type: "string" }, text: { type: "string" } },
      required: ["channel_key", "text"],
    },
    async handler(a) {
      const r = await slackPost({ channelKey: String(a.channel_key), text: String(a.text) });
      return { ok: r.ok, ts: r.ts };
    },
  },

  compute_funnel_metrics: {
    description: "퍼널 전환·체류일·유입경로/등급 집계.",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      const d = await insightsData();
      return { stages: d.funnel, by_source: d.bySource };
    },
  },

  score_churn_risk: {
    description: "이탈위험 규칙기반 산정(미제출일·past_due·접촉공백·등급).",
    inputSchema: { type: "object", properties: { brand_id: { type: "string" } }, required: ["brand_id"] },
    async handler(a) {
      const b = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [a.brand_id]);
      if (!b) return { error: "not_found" };
      const factors: string[] = [];
      let score = 0;
      if (b.pay_status === "past_due") { score += 2; factors.push("정기결제 past_due"); }
      if (b.last_contact_at) {
        const gap = businessDaysBetween(new Date(b.last_contact_at), new Date());
        if (gap > 14) { score += 2; factors.push(`접촉공백 ${gap}일`); }
        else if (gap > 7) { score += 1; factors.push(`접촉공백 ${gap}일`); }
      }
      if (b.state === "docs") {
        const prog = await docProgress(b.id);
        if (prog.total > 0 && prog.done < prog.total) { score += 1; factors.push("서류 미완"); }
      }
      if (b.grade === "C") { score += 1; factors.push("등급 C"); }
      const risk = score >= 3 ? "high" : score >= 1 ? "mid" : "low";
      await setFields(b.id, { churn_risk: risk });
      return { risk, factors };
    },
  },

  enrich_brand: {
    description: "크롤러(glovek brand_shop_stats) + 국내신호 수집 → brand_signals.",
    inputSchema: { type: "object", properties: { brand_id: { type: "string" } }, required: ["brand_id"] },
    async handler(a) {
      const b = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [a.brand_id]);
      if (!b) return { error: "not_found" };
      let estGmv: number | null = null;
      if (b.glovek_user_id || b.brand_url) {
        try {
          const r = await queryRo<{ est_gmv: number }>(
            "SELECT est_gmv FROM brand_shop_stats WHERE brand_url=$1 ORDER BY collected_at DESC LIMIT 1",
            [b.brand_url],
          );
          estGmv = r[0]?.est_gmv ?? null;
        } catch { estGmv = null; }
      }
      if (estGmv != null) {
        await query(
          `INSERT INTO brand_signals (brand_id, source, metric, value_num, confidence)
           VALUES ($1,'glovek_crawler','est_gmv',$2,'high')`,
          [b.id, estGmv],
        );
      }
      return { ok: true, est_gmv: estGmv };
    },
  },

  diagnose_brand: {
    description: "checks/신호 종합 → grade 재계산 + brief_md 생성·저장.",
    inputSchema: { type: "object", properties: { brand_id: { type: "string" } }, required: ["brand_id"] },
    async handler(a) {
      const b = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [a.brand_id]);
      if (!b) return { error: "not_found" };
      // 최신 diagnosis 소스에서 checks 추출
      const diag = await queryOne<{ payload: { checks?: SelfChecks } }>(
        "SELECT payload FROM brand_sources WHERE brand_id=$1 AND event='diagnosis' ORDER BY occurred_at DESC LIMIT 1",
        [b.id],
      );
      let grade = b.grade;
      let recTrack = b.rec_track;
      if (diag?.payload?.checks) {
        grade = gradeFromChecks(diag.payload.checks);
        recTrack = recommendedTrack(grade);
      }
      const signals = await query<{ metric: string; value_num: number | null; confidence: string }>(
        "SELECT metric, value_num, confidence FROM brand_signals WHERE brand_id=$1 ORDER BY collected_at DESC",
        [b.id],
      );
      const gmv = signals.find((s) => s.metric === "est_gmv");
      const brief = buildBriefMarkdown({
        brandName: b.brand_name, category: b.category, countries: b.countries,
        grade, recTrack, state: b.state,
        domesticSignal: gmv ? `해외 est_gmv ${gmv.value_num} (신뢰도 ${gmv.confidence})` : "공개신호 수집 전 (신뢰도 low)",
        digitalPresence: "미수집",
        overseasReadiness: recTrack === "onboarding" ? "온보딩 트랙 적합" : "라이브 트랙",
        salesPoint: grade === "S" || grade === "A" ? "즉시 온보딩 제안" : "라이브 진입으로 성과 검증",
        risk: signals.length ? "신호 기반" : "정보 부족 — 미팅 검증 필요",
      });
      await setFields(b.id, { grade, rec_track: recTrack, brief_md: brief });
      return { grade, rec_track: recTrack, brief_md: brief };
    },
  },

  upsert_insight: {
    description: "주간 자가학습 인사이트 저장.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "string" }, metric: { type: "string" }, value: {},
        finding: { type: "string" }, proposed_action: { type: "string" },
      },
      required: ["week", "metric", "value"],
    },
    async handler(a) {
      await query(
        `INSERT INTO insights (week, metric, value, finding, proposed_action)
         VALUES ($1,$2,$3,$4,$5)`,
        [a.week, a.metric, JSON.stringify(a.value ?? {}), a.finding ?? "", a.proposed_action ?? ""],
      );
      return { ok: true };
    },
  },
};

export const READ_ONLY_TOOLS = new Set([
  "list_brands", "get_brand_360", "find_sla_breaches", "find_gate_violations",
  "find_missing_docs", "draft_reminder", "compute_funnel_metrics",
]);
