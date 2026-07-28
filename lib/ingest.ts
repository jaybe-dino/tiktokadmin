import { z } from "zod";
import { getPool, query, queryOne, tx } from "./db";
import { extractKeys, findBrand, hasDedupKey, type DedupKeys } from "./dedup";
import { advanceStateIfAhead, getBrand, setFields, touchLastContact } from "./repo/brands";
import { resolveAlert, upsertAlert } from "./repo/alerts";
import { ensureDocTemplate, syncApplyStep } from "./docs";
import type { Brand, ContractType, PayStatus, Plan, Source, State } from "./types";

// Ingest 이벤트 처리 (02-INGEST-API). 사이트 → 어드민.

export type IngestEventName =
  | "lead" | "diagnosis" | "payment" | "doc_progress" | "contact_logged" | "onboarding";
export const INGEST_EVENTS: IngestEventName[] = [
  "lead", "diagnosis", "payment", "doc_progress", "contact_logged", "onboarding",
];

export interface IngestResult {
  http: number;
  body: Record<string, unknown>;
}

// 공통 payload
const Common = z.object({
  site: z.enum(["glovek", "apply", "tpartners", "manual"]),
  occurred_at: z.string(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  biz_no: z.string().optional().nullable(),
  brand_name: z.string().optional().nullable(),
  brand_url: z.string().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  source_ref: z.string().optional().nullable(),
  source_url: z.string().optional().nullable(),
});
type Common = z.infer<typeof Common>;

// lead → 초기 후보 state (새 퍼널)
const LEAD_STATE: Record<string, State> = {
  glovek_consult: "contact",
  apply_consult: "contact",
  glovek_inquiry: "inquiry",
  glovek_signup: "inquiry",
  apply_qna: "inquiry",
  apply_smr: "inquiry",
  tp_ebook: "inquiry",
  referrer: "inquiry",
  apply_seminar: "seminar",
  tp_seminar: "seminar",
};

/**
 * 결제 이벤트 → 브랜드에 적용할 효과(순수). 02 §3-3.
 *  · subscribe_first + live_focus_490k(멀티몰 정기) → 계약(mall), 퍼널 contract_done 전진
 *  · subscribe_first + pro_89k(Pro SaaS, 별도 상품군) → 구독 표시만, 퍼널 전진/계약 없음
 *  · once(apply 온보딩 일회) → 계약(onboarding), contract_done 전진
 *  · renew/fail → pay_status 만, 상태 불변 / cancel → canceled
 */
export function resolvePaymentEffect(
  payKind: string,
  plan: Plan | undefined,
  result?: string,
): { contractType?: ContractType; payStatus?: PayStatus; candidate?: State } {
  switch (payKind) {
    case "subscribe_first":
      // Pro 는 별도 상품군 — 계약 퍼널로 밀지 않는다.
      if (plan === "pro_89k") return { payStatus: "subscribed" };
      return { contractType: "glovek", payStatus: "subscribed", candidate: "contract_done" };
    case "subscribe_renew":
      return { payStatus: result === "fail" ? "past_due" : "subscribed" };
    case "cancel":
      return { payStatus: "canceled" };
    case "once":
      return { contractType: "onboarding", payStatus: "once_paid", candidate: "contract_done" };
    case "fail":
      return { payStatus: "past_due" };
    default:
      return {};
  }
}

function validateCommon(payload: unknown): { data: Common } | { error: string[] } {
  const parsed = Common.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const d = parsed.data;
  // occurred_at 범위 검증 (02 §5)
  const t = new Date(d.occurred_at).getTime();
  if (Number.isNaN(t)) return { error: ["occurred_at: invalid date"] };
  const now = Date.now();
  if (t > now + 5 * 60_000) return { error: ["occurred_at: 미래값 거부"] };
  if (t < now - 365 * 86_400_000) return { error: ["occurred_at: 1년 이전 거부"] };
  return { data: d };
}

/** 브랜드명 기본값 도출 */
function brandNameFrom(d: Common, keys: DedupKeys): string {
  if (d.brand_name?.trim()) return d.brand_name.trim();
  if (d.contact_name?.trim()) return `${d.contact_name.trim()}(개인)`;
  if (keys.email) return keys.email.split("@")[0];
  if (keys.phone) return `phone:${keys.phone.slice(-4)}`;
  return "(미상)";
}

/** dedup 후 브랜드 확보(find or insert). 트랜잭션 내부에서 FOR UPDATE. */
async function resolveBrand(
  d: Common,
  keys: DedupKeys,
  initialState: State,
  extra: Partial<Record<string, unknown>>,
): Promise<{ brand: Brand; created: boolean }> {
  return tx(async (client) => {
    let found = await findBrand(client, keys);
    if (found) return { brand: found, created: false };

    try {
      const r = await client.query<Brand>(
        `INSERT INTO brands (brand_name, email, phone, biz_no, contact_name, category, brand_url, source, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          brandNameFrom(d, keys),
          keys.email,
          keys.phone,
          keys.biz_no,
          d.contact_name ?? "",
          d.category ?? "",
          d.brand_url ?? "",
          (extra.source as string) ?? "etc",
          initialState,
        ],
      );
      return { brand: r.rows[0], created: true };
    } catch (err) {
      // 동시성 유니크 충돌 → 재조회
      if ((err as { code?: string }).code === "23505") {
        found = await findBrand(client, keys);
        if (found) return { brand: found, created: false };
      }
      throw err;
    }
  });
}

async function recordSource(
  brandId: string,
  site: string,
  event: string,
  sourceRef: string | null,
  sourceUrl: string | null,
  payload: unknown,
  occurredAt: string,
): Promise<void> {
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, source_ref, source_url, payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (site, event, source_ref) DO NOTHING`,
    [brandId, site, event, sourceRef, sourceUrl, JSON.stringify(payload ?? {}), occurredAt],
  );
}

// ── 메인 진입점 ──────────────────────────────────────────────
export async function processIngest(
  event: string,
  idemKey: string,
  payload: unknown,
): Promise<IngestResult> {
  if (!INGEST_EVENTS.includes(event as IngestEventName)) {
    return { http: 400, body: { error: "unknown_event", event } };
  }

  const v = validateCommon(payload);
  if ("error" in v) return { http: 400, body: { error: "validation", fields: v.error } };
  const d = v.data;

  const keys = extractKeys(d);
  if (!hasDedupKey(keys)) {
    return { http: 400, body: { error: "validation", fields: ["email/phone/biz_no 중 최소 하나 필요"] } };
  }

  // 멱등: ingest_events 기록. 이미 있으면 dup.
  const idem = await queryOne<{ id: string }>(
    `INSERT INTO ingest_events (site, event, idem_key, payload, status)
     VALUES ($1,$2,$3,$4,'ok')
     ON CONFLICT (site, event, idem_key) DO NOTHING
     RETURNING id`,
    [d.site, event, idemKey, JSON.stringify(payload)],
  );
  if (!idem) {
    return { http: 200, body: { ok: true, dedup: true } };
  }

  try {
    const out = await handleEvent(event as IngestEventName, d, keys, payload);
    return out;
  } catch (err) {
    await query("UPDATE ingest_events SET status='error', error=$2 WHERE site=$1 AND event=$3 AND idem_key=$4", [
      d.site, (err as Error).message, event, idemKey,
    ]).catch(() => {});
    console.error("[ingest] error", event, (err as Error).message);
    return { http: 500, body: { error: "internal", message: (err as Error).message } };
  }
}

async function handleEvent(
  event: IngestEventName,
  d: Common,
  keys: DedupKeys,
  raw: unknown,
): Promise<IngestResult> {
  const p = raw as Record<string, unknown>;

  switch (event) {
    case "lead": {
      const source = (p.source as Source) ?? "etc";
      const candidate = LEAD_STATE[source] ?? "inquiry";
      const { brand, created } = await resolveBrand(d, keys, candidate, { source });
      if (!created) {
        await advanceStateIfAhead(brand, candidate, d.site);
        // 비어있던 소스/카테고리 채움
        if (source !== "etc") await setFields(brand.id, { source: brand.source === "etc" ? source : brand.source });
      }
      if (p.referral_code) await setFields(brand.id, { referral_code: p.referral_code });
      await recordSource(brand.id, d.site, "lead", d.source_ref ?? null, d.source_url ?? null, p, d.occurred_at);
      return { http: 200, body: { ok: true, brand_id: brand.id, created, need_brief: created } };
    }

    case "diagnosis": {
      const { brand, created } = await resolveBrand(d, keys, "inquiry", { source: "glovek_consult" });
      const grade = p.grade as Brand["grade"];
      const recTrack = p.rec_track as Brand["rec_track"];
      const countries = (p.countries as string[]) ?? [];
      // 진단이 더 최신 → 덮어씀
      await setFields(brand.id, {
        grade: grade ?? brand.grade,
        rec_track: recTrack ?? brand.rec_track,
        countries: countries.length ? countries : brand.countries,
        glovek_onb_id: p.glovek_onb_id ?? brand.glovek_onb_id,
        brief_md: null, // 브리프 재생성 큐(⑤ 에이전트가 채움)
      });
      await recordSource(brand.id, d.site, "diagnosis", d.source_ref ?? null, d.source_url ?? null, p, d.occurred_at);
      return { http: 200, body: { ok: true, brand_id: brand.id, created, need_brief: true } };
    }

    case "payment": {
      const payKind = p.pay_kind as string;
      const plan = p.plan as Plan | undefined;
      const amount = Number(p.amount ?? 0);
      if (amount < 0) return { http: 400, body: { error: "validation", fields: ["amount 음수"] } };

      const { brand, created } = await resolveBrand(d, keys, "inquiry", { source: "glovek_consult" });

      const { contractType, payStatus, candidate } = resolvePaymentEffect(
        payKind, plan, p.result as string | undefined,
      );

      await setFields(brand.id, {
        plan: plan ?? brand.plan,
        pay_status: payStatus ?? brand.pay_status,
        contract_type: contractType ?? brand.contract_type,
        glovek_user_id: p.glovek_user_id ?? brand.glovek_user_id,
        apply_customer_id: p.apply_customer_id ?? brand.apply_customer_id,
      });

      const reloaded = (await getBrand(brand.id))!;
      if (candidate) {
        await advanceStateIfAhead(reloaded, candidate, d.site);
        // contract_done 도달 → 서류 템플릿
        const ct = contractType ?? reloaded.contract_type;
        if (reloaded.state === "contract_done" && ct) await ensureDocTemplate(reloaded.id, ct);
      }

      // 알림 처리
      if (payStatus === "past_due") await upsertAlert(brand.id, "pay_overdue", 1, `${reloaded.brand_name} · 결제 실패/연체`);
      if (payStatus === "subscribed") await resolveAlert(brand.id, "pay_overdue");
      if (payStatus === "canceled") await resolveAlert(brand.id, "pay_overdue");

      await recordSource(brand.id, d.site, "payment", d.source_ref ?? (p.pg_ref as string) ?? null, d.source_url ?? null, p, d.occurred_at);
      return { http: 200, body: { ok: true, brand_id: brand.id, created, pay_status: payStatus } };
    }

    case "doc_progress": {
      const stepNo = Number(p.step_no);
      const stepStatus = p.step_status as "submitted" | "approved" | "rejected";
      const { brand, created } = await resolveBrand(d, keys, "setup", { source: "apply_consult" });
      await setFields(brand.id, {
        apply_app_id: p.apply_app_id ?? brand.apply_app_id,
        contract_type: brand.contract_type ?? "onboarding",
      });
      const ct = brand.contract_type ?? "onboarding";
      if (ct === "onboarding") await ensureDocTemplate(brand.id, "onboarding");
      if (stepNo >= 1 && stepNo <= 5) await syncApplyStep(brand.id, stepNo, stepStatus);
      if (stepStatus === "rejected") {
        await upsertAlert(brand.id, "doc_missing", 1, `${brand.brand_name} · STEP${stepNo} 반려`);
      }
      await recordSource(brand.id, d.site, "doc_progress", d.source_ref ?? `step:${p.apply_app_id}:${stepNo}:${stepStatus}`, d.source_url ?? null, p, d.occurred_at);
      return { http: 200, body: { ok: true, brand_id: brand.id, created } };
    }

    case "contact_logged": {
      const { brand, created } = await resolveBrand(d, keys, "inquiry", { source: "etc" });
      await touchLastContact(brand.id, d.occurred_at);
      await resolveAlert(brand.id, "stale");
      await recordSource(brand.id, d.site, "contact_logged", d.source_ref ?? null, d.source_url ?? null, p, d.occurred_at);
      return { http: 200, body: { ok: true, brand_id: brand.id, created } };
    }

    case "onboarding": {
      // glovek 온보딩 스냅샷 수신(선택). 등급·트랙·국가가 있으면 갱신, 원본은 소스 이력에 보관.
      const { brand, created } = await resolveBrand(d, keys, "inquiry", { source: "glovek_consult" });
      const grade = p.grade as Brand["grade"] | undefined;
      const recTrack = p.rec_track as Brand["rec_track"] | undefined;
      const countries = (p.countries as string[]) ?? [];
      await setFields(brand.id, {
        grade: grade ?? brand.grade,
        rec_track: recTrack ?? brand.rec_track,
        countries: countries.length ? countries : brand.countries,
        glovek_onb_id: p.glovek_onb_id ?? brand.glovek_onb_id,
      });
      await recordSource(brand.id, d.site, "onboarding", d.source_ref ?? (p.glovek_onb_id as string) ?? null, d.source_url ?? null, p, d.occurred_at);
      return { http: 200, body: { ok: true, brand_id: brand.id, created } };
    }

    default:
      return { http: 400, body: { error: "unknown_event" } };
  }
}

/** ingest secret 검증 (route 에서 사용). 미설정 환경에서도 안전하게 비교. */
export function verifyIngestSecret(provided: string | null, expected: string): boolean {
  if (!expected) return false;
  return provided === expected;
}

// getPool 은 tx 워밍업용 재export (route 트리에서 참조)
export { getPool };
