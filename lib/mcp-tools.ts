import { query, queryOne, queryRo } from "./db";
import { brand360, insightsData } from "./repo/queries";
import { docProgress } from "./docs";
import { draftReminder as draftReminderFn } from "./brief";
import { buildBriefMarkdown } from "./brief";
import { opsTransition } from "./ops";
import { assignOwner } from "./transition";
import { touchLastContact, setFields } from "./repo/brands";
import { slackPost, slackPostDM } from "./slack";
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

  // ── Phase 2~6 확장 툴 (10·14·08·09·15·17) ─────────────────
  get_customer_card: {
    description: "고객카드 심화(회사·연락처·제품·인증·제안·계약·설문·재고·물류·미팅).",
    inputSchema: { type: "object", properties: { brand_id: { type: "string" } }, required: ["brand_id"] },
    async handler(a) {
      const { cardDeep } = await import("./repo/card");
      return cardDeep(String(a.brand_id));
    },
  },
  list_products: {
    description: "브랜드 제품·국가별 인증 목록.",
    inputSchema: { type: "object", properties: { brand_id: { type: "string" } }, required: ["brand_id"] },
    async handler(a) {
      const { listProducts, listCertsForBrand } = await import("./repo/card");
      const [products, certs] = await Promise.all([listProducts(String(a.brand_id)), listCertsForBrand(String(a.brand_id))]);
      return { products, certs };
    },
  },
  find_cert_risks: {
    description: "만료 임박(기본 30일)·미비 인증 목록(판매 리스크).",
    inputSchema: { type: "object", properties: { days_ahead: { type: "number" } } },
    async handler(a) {
      const days = Number(a.days_ahead ?? 30);
      const rows = await query(
        `SELECT pc.id, pm.brand_id, pm.name_kr AS product, pc.country, pc.cert_type, pc.status, pc.expires_at
           FROM product_certs pc JOIN products_master pm ON pm.id=pc.product_id
          WHERE pc.status IN ('none','rejected','expired')
             OR (pc.expires_at IS NOT NULL AND pc.expires_at < current_date + ($1||' days')::interval)
          ORDER BY pc.expires_at NULLS FIRST LIMIT 200`, [days]).catch(() => []);
      return { risks: rows };
    },
  },
  create_proposal: {
    description: "computeQuote 견적으로 제안서 draft 생성(수기 금액 금지).",
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string" }, plan: { type: "string" },
        countries: { type: "array", items: { type: "string" } }, term: { type: "string" },
      },
      required: ["brand_id", "plan", "countries"],
    },
    async handler(a, actorName) {
      const { computeQuote } = await import("./quote");
      const { addProposalV2 } = await import("./repo/card");
      const q = computeQuote({ plan: String(a.plan), countries: a.countries as string[], term: (a.term as "monthly" | "6month") ?? "monthly" });
      const id = await addProposalV2({
        brand_id: String(a.brand_id), plan: String(a.plan), countries: a.countries as string[],
        term: String(a.term ?? "monthly"), quote_amount: q.total, discount_note: q.breakdown, by: actorFor(actorName).actor,
      });
      return { id, quote: q.total, breakdown: q.breakdown };
    },
  },
  register_contract: {
    description: "계약 등록(kind·terms·기간). terms.fee_pct 는 정산 계산 원천.",
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string" }, kind: { type: "string" },
        fee_pct: { type: "number" }, term_months: { type: "number" },
        start_date: { type: "string" }, end_date: { type: "string" },
      },
      required: ["brand_id", "kind"],
    },
    async handler(a) {
      const { addContract } = await import("./repo/card");
      const id = await addContract({
        brand_id: String(a.brand_id), kind: String(a.kind),
        terms: { fee_pct: a.fee_pct ?? null, term_months: a.term_months ?? null },
        start_date: (a.start_date as string) || null, end_date: (a.end_date as string) || null,
      });
      return { id };
    },
  },
  list_meetings: {
    description: "미팅 목록(brand_id 또는 unmatched_only).",
    inputSchema: { type: "object", properties: { brand_id: { type: "string" }, unmatched_only: { type: "boolean" } } },
    async handler(a) {
      const { listMeetings, listUnmatchedMeetings } = await import("./meetings");
      if (a.unmatched_only) return { meetings: await listUnmatchedMeetings() };
      if (a.brand_id) return { meetings: await listMeetings(String(a.brand_id)) };
      return { meetings: await listUnmatchedMeetings() };
    },
  },
  suggest_assignee: {
    description: "역할별 담당 후보 3명 + 부하 산정(파트장 배정 보조).",
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string" },
        role: { type: "string", enum: ["owner_intake", "owner_sales", "owner_onboard", "owner_ads"] },
      },
      required: ["brand_id", "role"],
    },
    async handler(a) {
      const { suggestAssignee } = await import("./assign");
      return { candidates: await suggestAssignee(String(a.brand_id), a.role as OwnerField) };
    },
  },
  list_no_reply: {
    description: "발송 후 무응답 브랜드(no_reply 알림) 목록.",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      const rows = await query(
        `SELECT a.brand_id, b.brand_name, a.message, a.created_at
           FROM alerts a JOIN brands b ON b.id=a.brand_id
          WHERE a.kind='no_reply' AND a.resolved_at IS NULL ORDER BY a.created_at`).catch(() => []);
      return { no_reply: rows };
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

  list_bug_reports: {
    description: "기능오류 제보(개발 이슈) 목록. status 기본은 미해결(신규·확인·진행중). status='all' 전체, 'resolved' 해결됨 등. 각 항목에 티켓번호(BUG-N)·설명·URL·개발메모 포함.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "open|triaged|in_progress|resolved|wontfix|open_all(미해결 전체)|all" },
        limit: { type: "number" },
      },
    },
    async handler(a) {
      const status = String(a.status ?? "open_all");
      const limit = Math.min(200, Math.max(1, Number(a.limit) || 100));
      let where = "status NOT IN ('resolved','wontfix')"; // 기본: 미해결
      const params: unknown[] = [];
      if (status === "all") where = "1=1";
      else if (status !== "open_all") { params.push(status); where = "status=$1"; }
      const rows = await query(
        `SELECT id, ticket_no, status, description, url, reporter, dev_note, created_at
           FROM bug_reports WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`,
        params,
      ).catch(() => [] as Record<string, unknown>[]);
      return {
        count: rows.length,
        reports: (rows as Record<string, unknown>[]).map((r) => ({
          ticket: r.ticket_no != null ? `BUG-${r.ticket_no}` : `BUG-${String(r.id).slice(0, 6)}`,
          id: r.id, status: r.status, description: r.description, url: r.url,
          reporter: r.reporter, dev_note: r.dev_note, created_at: r.created_at,
        })),
      };
    },
  },

  resolve_bug_report: {
    description: "기능오류 제보 상태 변경(해결 처리 등). ticket(BUG-N) 또는 id 로 지정. status 미지정 시 'resolved'. dev_note 로 처리 메모 추가.",
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string", description: "BUG-12 형태" },
        id: { type: "string", description: "uuid (ticket 대신)" },
        status: { type: "string", description: "open|triaged|in_progress|resolved|wontfix (기본 resolved)" },
        dev_note: { type: "string" },
      },
    },
    async handler(a) {
      const status = String(a.status ?? "resolved");
      if (!["open", "triaged", "in_progress", "resolved", "wontfix"].includes(status)) return { ok: false, error: "잘못된 상태값" };
      let id = a.id ? String(a.id) : "";
      const ticket = a.ticket ? String(a.ticket).replace(/^BUG-/i, "").trim() : "";
      if (!id && /^\d+$/.test(ticket)) {
        const row = await queryOne<{ id: string }>("SELECT id FROM bug_reports WHERE ticket_no=$1", [Number(ticket)]).catch(() => null);
        if (!row) return { ok: false, error: `티켓 BUG-${ticket} 을 찾을 수 없습니다.` };
        id = row.id;
      }
      if (!id) return { ok: false, error: "ticket(BUG-N) 또는 id 가 필요합니다." };
      const dev = a.dev_note != null ? String(a.dev_note) : null;
      // 해결완료로 전이할 때만 작성자 알림(중복 방지) — 이전 상태 확인.
      const prev = status === "resolved"
        ? await queryOne<{ status: string; reporter: string | null; ticket_no: number | null; description: string; url: string | null }>(
            "SELECT status, reporter, ticket_no, description, url FROM bug_reports WHERE id=$1", [id]).catch(() => null)
        : null;
      await query(
        "UPDATE bug_reports SET status=$2, dev_note=COALESCE($3, dev_note), updated_at=now() WHERE id=$1",
        [id, status, dev],
      );
      if (status === "resolved" && prev && prev.status !== "resolved" && prev.reporter?.includes("@")) {
        const code = prev.ticket_no != null ? `BUG-${prev.ticket_no}` : `BUG-${id.slice(0, 6)}`;
        const desc = (prev.description || "").replace(/\s+/g, " ").slice(0, 300);
        const msg = [
          `✅ *[${code}] 개발 완료* — 제보하신 기능오류가 처리되었습니다.`,
          `> ${desc}`,
          dev ? `• 처리 내용: ${dev.slice(0, 500)}` : "",
          prev.url ? `• 화면: ${prev.url}` : "",
          `배포 반영 후 확인해 주세요. 이상 있으면 다시 제보해 주세요 🙏`,
        ].filter(Boolean).join("\n");
        await slackPostDM(prev.reporter!, { text: msg }).catch(() => {});
      }
      return { ok: true, id, status };
    },
  },
  proposal_img_diag: {
    description: "제안서 이미지 실측 진단 — 운영/마케팅 제안서의 레퍼런스 이미지가 왜 안 뜨는지 서버에서 직접 측정(내부파일 존재/브랜드 일치/외부 fetch/oEmbed 재조회).",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "제안서 id 또는 공개 token" } }, required: ["id"] },
    async handler(a) {
      const key = String(a.id ?? "").trim();
      const { fetchExternalImage, fetchTikTokOembedThumb } = await import("./image-fetch");
      let kind = "ops";
      let brandId: string | null = null;
      let items: { label: string; image?: string; link?: string }[] = [];
      const ops = await queryOne<{ id: string; brand_id: string | null; brand_logo_url: string | null; creators: unknown }>(
        "SELECT id, brand_id, brand_logo_url, creators FROM proposal_docs WHERE id::text=$1 OR token=$1", [key],
      ).catch(() => null);
      if (ops) {
        brandId = ops.brand_id;
        const cs = Array.isArray(ops.creators) ? (ops.creators as Record<string, unknown>[]) : [];
        items = cs.map((c) => ({ label: String(c.handle ?? c.product ?? "?"), image: c.thumb_url as string | undefined, link: c.link as string | undefined }));
        if (ops.brand_logo_url) items.unshift({ label: "(로고)", image: ops.brand_logo_url });
      } else {
        const mkt = await queryOne<{ id: string; brand_id: string | null; references_json: unknown }>(
          "SELECT id, brand_id, references_json FROM mkt_proposal_docs WHERE id::text=$1 OR token=$1", [key],
        ).catch(() => null);
        if (!mkt) return { ok: false, error: "제안서를 찾을 수 없습니다(id/token 확인)." };
        kind = "mkt";
        brandId = mkt.brand_id;
        const rs = Array.isArray(mkt.references_json) ? (mkt.references_json as Record<string, unknown>[]) : [];
        items = rs.map((r) => ({ label: String(r.creator ?? r.product ?? "?"), image: r.image_url as string | undefined, link: r.url as string | undefined }));
      }
      const out: { label: string; url_head: string; status: string }[] = [];
      for (const it of items.slice(0, 10)) {
        const image = (it.image ?? "").trim();
        let status = "";
        const m = image.match(/^\/api\/(?:brand\/import-file|apply\/file)\/([0-9a-f-]{36})/i);
        if (!image) status = "이미지 URL 없음";
        else if (m) {
          const f = await queryOne<{ brand_id: string; mime: string | null; size: number | null }>(
            "SELECT brand_id, mime, size FROM import_files WHERE id=$1", [m[1]],
          ).catch(() => null);
          status = !f ? "내부파일 없음(404 예상)"
            : String(f.brand_id) !== String(brandId) ? `내부파일 브랜드 불일치(403 예상: file.brand=${f.brand_id} vs doc.brand=${brandId})`
            : `내부파일 OK (${f.mime ?? "?"} · ${f.size ?? 0}b)`;
        } else if (/^https?:\/\//i.test(image)) {
          const r = await fetchExternalImage(image, 6000);
          status = r ? `외부 fetch OK (${r.mime} · ${r.bytes.length}b)` : "외부 fetch 실패(만료/차단)";
          if (!r) {
            if (it.link) {
              const { latestGlovekCover } = await import("./glovek-content");
              const gv = await latestGlovekCover(it.link).catch(() => null);
              if (gv) {
                const rg = await fetchExternalImage(gv, 6000);
                status += rg ? " · glovek 재조회 OK(복구 가능)" : " · glovek 재조회 URL fetch 실패";
              } else status += " · glovek 재조회 매칭 없음";
              const fresh = await fetchTikTokOembedThumb(it.link, 6000);
              if (!fresh) status += " · oEmbed 실패";
              else {
                const r2 = await fetchExternalImage(fresh, 6000);
                status += r2 ? " · oEmbed 재조회 OK(복구 가능)" : " · oEmbed URL fetch 실패";
              }
            } else status += " · 영상 link 없음(oEmbed 불가)";
          }
        } else status = `기타 경로: ${image.slice(0, 50)}`;
        out.push({ label: it.label, url_head: image.slice(0, 90), status });
      }
      return { ok: true, kind, brand_id: brandId, total: items.length, items: out };
    },
  },
  glovek_diag: {
    description: "glovek 콘텐츠 DB(레퍼런스 검색용) 연동 진단 — GLOVEK_DB_URL_RO 설정 여부, videos/products 행수, 카테고리 실값 분포, 이름 샘플. 선택: q(검색어)로 실검색 테스트.",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    async handler(a, actorName) {
      const q0 = String(a.q ?? "").trim();
      // 우회 호출 — MCP 클라이언트가 도구 목록을 캐시해 proposal_img_diag 가 아직 안 보일 때,
      // q="imgdiag:<제안서 id 또는 token>" 으로 이미 노출된 이 도구를 통해 같은 진단을 실행한다.
      if (/^imgdiag:/i.test(q0)) return TOOLS.proposal_img_diag.handler({ id: q0.replace(/^imgdiag:/i, "").trim() }, actorName);
      const { glovekDataProfile, similarContentRefs } = await import("./glovek-content");
      const profile = await glovekDataProfile();
      const q = q0;
      // 실검색 테스트는 제안서 레퍼런스가 실제로 쓰는 경로(제품→연결 영상 썸네일)와 동일하게.
      const search = q ? await similarContentRefs([q], 8).catch(() => []) : undefined;
      return {
        configured: profile.configured,
        note: profile.configured ? "GLOVEK_DB_URL_RO 설정됨" : "GLOVEK_DB_URL_RO 미설정 — 어드민 DB 폴백 상태(레퍼런스 검색 불가)",
        tables: profile.tables,
        ...(q ? { search_q: q, search_hits: search?.length ?? 0, search_sample: (search ?? []).slice(0, 3) } : {}),
      };
    },
  },
};

export const READ_ONLY_TOOLS = new Set([
  "list_brands", "get_brand_360", "find_sla_breaches", "find_gate_violations",
  "find_missing_docs", "draft_reminder", "compute_funnel_metrics",
  "get_customer_card", "list_products", "find_cert_risks", "list_meetings",
  "suggest_assignee", "list_no_reply", "list_bug_reports", "glovek_diag", "proposal_img_diag",
]);
