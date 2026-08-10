"use server";

// proposals 화면 전용 서버액션.
//  - 견적 빌더: computeQuote(단일 원천)로 계산 → addProposalV2(draft) → 선택 시 sent 발송기록.
//  - 목록 행 액션: 제안 상태 스텝 이동(draft→sent, sent→accepted/rejected).
// @/app/actions.ts 는 수정하지 않고 여기에 이 화면 전용 액션만 둔다.

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { computeQuote, type QuoteTerm } from "@/lib/quote";
import { aiEnabled, aiText } from "@/lib/ai";
import { query } from "@/lib/db";
import {
  addProposalV2,
  setProposalV2Status,
} from "@/lib/repo/card";

export interface ProposalActionResult {
  ok: boolean;
  error?: string;
  quote?: number;
  breakdown?: string;
  /** 할인 20% 초과 — 발송 보류, 파트장 결재 요청됨(결재함). */
  pendingApproval?: boolean;
  /** 담당자 이메일 발송 초안이 초안함(email_drafts)에 생성됨 — 승인 후 발송. */
  draftReady?: boolean;
  /** 초안 미생성 사유 등 부가 안내. */
  note?: string;
}

// 추가 할인 결재선 기준: 20% 초과는 파트장(lead) 결재 필요.
const DISCOUNT_APPROVAL_THRESHOLD = 20;

// 견적 빌더 "제안서 생성 → 발송".
//   금액은 computeQuote 결과만 사용(수기 금액 금지). send=true 면 sent_at 기록까지.
export async function createAndSendProposalAction(input: {
  brand_id: string;
  plan: string;
  countries: string[];
  term: QuoteTerm;
  onboardingTier?: string;
  send?: boolean;
  /** 추가 할인 % (0~100). 20% 초과 시 발송 대신 파트장 결재 요청. */
  discountPct?: number;
  /** 계약서 첨부 — 구글드라이브 링크(수기). */
  contractFileUrl?: string;
  /** 계약기간(자유 텍스트, 예: "12개월"). */
  contractTerm?: string;
  /** 매월 결제일(1~31). */
  billingDay?: number;
}): Promise<ProposalActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };

  const contractFileUrl = (input.contractFileUrl ?? "").trim();
  if (contractFileUrl && !/^https:\/\//.test(contractFileUrl)) {
    return { ok: false, error: "계약서 링크는 https:// 로 시작해야 합니다." };
  }
  const contractTerm = (input.contractTerm ?? "").trim();
  const billingDay =
    input.billingDay === undefined || input.billingDay === null || Number.isNaN(input.billingDay)
      ? null
      : Number(input.billingDay);
  if (billingDay !== null && (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)) {
    return { ok: false, error: "매월 결제일은 1~31 사이여야 합니다." };
  }

  const discountPct = Number(input.discountPct ?? 0);
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return { ok: false, error: "추가 할인은 0~100% 범위여야 합니다." };
  }

  const isOnboarding = input.plan === "onboarding_onetime";
  if (!isOnboarding && input.countries.length === 0) {
    return { ok: false, error: "국가를 1개 이상 선택하세요." };
  }

  let q;
  try {
    q = computeQuote({
      plan: input.plan,
      countries: input.countries,
      term: input.term,
      onboardingTier: input.onboardingTier as
        | "3month"
        | "5month"
        | "12month"
        | undefined,
    });
  } catch {
    return { ok: false, error: "견적 계산 실패 — 트랙(플랜)을 확인하세요." };
  }

  // 추가 할인 적용가 — 저장·발송·결재 금액은 모두 이 값(할인 반영)을 사용한다.
  //   (기존 버그: 빌더는 할인가를 보여주지만 저장·이메일은 원가로 나갔음 — sales#1.)
  const finalAmount = Math.round(q.total * (1 - discountPct / 100));

  // 할인 결재선: 20% 초과는 생성·발송하지 않고 파트장 결재 요청만 남긴다.
  // 승인 후 발송은 담당이 다시 진행(자동실행 없음 — /api/ops/approve 는 기록만).
  if (discountPct > DISCOUNT_APPROVAL_THRESHOLD) {
    try {
      await query(
        `INSERT INTO approval_requests (brand_id, kind, payload, requested_by)
         VALUES ($1, 'discount', $2, $3)`,
        [
          input.brand_id,
          JSON.stringify({
            brand_id: input.brand_id,
            plan: input.plan,
            countries: input.countries,
            term: input.term,
            discountPct,
            list_amount: q.total,
            quote_amount: finalAmount,
            contract_file_url: contractFileUrl || null,
            contract_term: contractTerm || null,
            billing_day: billingDay,
            requested_by: `admin:${u.id}`,
          }),
          `admin:${u.id}`,
        ],
      );
    } catch {
      return { ok: false, error: "결재 요청 저장 실패" };
    }
    revalidatePath("/proposals");
    return { ok: true, pendingApproval: true, quote: finalAmount, breakdown: q.breakdown };
  }

  let id: string;
  try {
    id = await addProposalV2({
      brand_id: input.brand_id,
      plan: input.plan,
      countries: input.countries,
      term: input.term,
      quote_amount: finalAmount,
      discount_note:
        discountPct > 0 ? `${q.breakdown} | 추가할인 ${discountPct}% → ${finalAmount.toLocaleString("ko-KR")}원` : q.breakdown,
      by: `admin:${u.id}`,
    });
  } catch {
    return { ok: false, error: "제안서 저장 실패" };
  }

  // 계약 조건 저장(0020) — 계약서 드라이브 링크 · 계약기간 · 매월 결제일.
  await query(
    `UPDATE proposals
        SET contract_file_url = $2, contract_term = $3, billing_day = $4
      WHERE id = $1`,
    [id, contractFileUrl || null, contractTerm || null, billingDay],
  ).catch(() => {});

  // 브랜드 플랜·계약형태 반영 — 제안 시점에 트랙이 결정되므로 비어 있으면 채운다.
  //   (없으면 contact→contract_review 게이트가 "계약형태 미정/플랜 미정"으로 영구 차단됨.)
  const { contractTypeFromPlan } = await import("@/lib/track");
  await query(
    "UPDATE brands SET plan = COALESCE(plan, $2), contract_type = COALESCE(contract_type, $3), updated_at = now() WHERE id = $1",
    [input.brand_id, input.plan, contractTypeFromPlan(input.plan)],
  ).catch(() => {});

  // 미팅 직후 플로우 — 요약(summary_md)이 있는 브랜드면 타임라인에 제안 생성 로그.
  //   brand_sources site CHECK('glovek','apply','tpartners','manual') → 'manual',
  //   source_ref=proposal:{id} 로 멱등(UNIQUE(site,event,source_ref)).
  const hasMeetingSummary = await query<{ id: string }>(
    "SELECT id FROM meetings WHERE brand_id=$1 AND summary_md IS NOT NULL LIMIT 1",
    [input.brand_id],
  ).catch(() => []);
  if (hasMeetingSummary.length > 0) {
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
       VALUES ($1, 'manual', 'contact_logged', $2, $3, now())
       ON CONFLICT (site, event, source_ref) DO NOTHING`,
      [
        input.brand_id,
        `proposal:${id}`,
        JSON.stringify({ kind: "proposal_sent", proposal_id: id }),
      ],
    ).catch(() => {});
  }

  if (input.send) {
    // 발송 기록(sent_at 스탬프) — 계약검토 게이트 조건.
    await setProposalV2Status(id, "sent").catch(() => {});
    // 발송 후 2~3일 미계약 팔로업 기한 = sent_at + 3일 (간이 크론 checkProposalFollowups 가 점검).
    await query(
      "UPDATE proposals SET followup_due = (sent_at + interval '3 days')::date WHERE id=$1 AND sent_at IS NOT NULL",
      [id],
    ).catch(() => {});
  }

  // 담당자 이메일 발송 준비 — 초안함(email_drafts) 초안 생성.
  //   kind 는 email_drafts 에 CHECK 없음 → 수신동의 게이트(lifecycle TRANSACTIONAL_KINDS)에
  //   포함된 거래성 'doc_request' 사용(상담 후속 계약서류 안내). 실제 발송은 초안함 승인 경유.
  const draft = await draftProposalEmail(id, input.brand_id, {
    plan: input.plan,
    countries: input.countries,
    term: input.term,
    quote: finalAmount,
    contractFileUrl,
    contractTerm,
    billingDay,
  });

  revalidatePath("/proposals");
  revalidatePath("/drafts");
  revalidatePath(`/brand/${input.brand_id}`);
  return {
    ok: true,
    quote: finalAmount,
    breakdown: q.breakdown,
    draftReady: draft.ok,
    note: draft.ok
      ? "발송 초안이 초안함에 생성되었습니다 — 초안함에서 승인 후 실제 발송됩니다."
      : draft.note,
  };
}

// ══════════════════════════════════════════════════════════════
// 운영견적(재설계) — 트랙3종·약정/매월·수기 월금액·추가할인·계약기간(캘린더).
//   생성 → 미리보기(임시) → 발송(메일+문자). 30%↑ 추가할인은 파트장 결재.
// ══════════════════════════════════════════════════════════════
import { computeOpsQuote, OPS_TRACKS, OPS_COUNTRIES, OPS_APPROVAL_THRESHOLD, type OpsPaymentMode } from "@/lib/quote";

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 발송 내용 조립(미리보기·발송 공용). 할인 0%는 표기하지 않는다. */
function composeOpsProposal(b: { brand_name: string; contact_name: string | null }, d: {
  trackLabel: string; mode: OpsPaymentMode; months: number; monthly: number; total: number;
  totalDiscountPct: number; countries?: string[]; periodStart: string; periodEnd: string; contractFileUrl: string;
}): { subject: string; body: string } {
  const won = (n: number) => n.toLocaleString("ko-KR") + "원";
  const period = d.periodStart || d.periodEnd ? `${d.periodStart || "미정"} ~ ${d.periodEnd || "미정"}` : null;
  const countryLabels = (d.countries ?? []).map((c) => OPS_COUNTRIES.find((x) => x.code === c)?.label ?? c);
  const amountLine = d.mode === "commitment"
    ? `· 약정 ${d.months}개월 일시불 합계: ${won(d.total)} + VAT`
    : `· 월 정기결제: ${won(d.monthly)} + VAT`;
  const subject = `[GloveK] ${b.brand_name} 운영 제안서 — ${d.trackLabel}`;
  const body = [
    `안녕하세요, ${b.contact_name || b.brand_name} 담당자님.`,
    "",
    "GloveK 운영 제안 내용을 안내드립니다.",
    `· 트랙: ${d.trackLabel}`,
    countryLabels.length ? `· 대상 국가: ${countryLabels.join(", ")}` : null,
    amountLine,
    d.totalDiscountPct > 0 ? `· 적용 할인: ${d.totalDiscountPct}%` : null,   // 0%면 미표기
    period ? `· 계약기간: ${period}` : null,
    d.contractFileUrl ? `· 계약서: ${d.contractFileUrl}` : null,
    "",
    "검토 후 회신 주시면 계약 절차를 안내드리겠습니다.",
    "",
    "감사합니다.",
    "GloveK 드림",
  ].filter((l): l is string => l !== null).join("\n");
  return { subject, body };
}

export interface OpsQuoteResultOut extends ProposalActionResult {
  proposalId?: string;
  preview?: { subject: string; body: string };
}

/** 운영견적 → 제안서 생성(발송 전). 30%↑ 추가할인은 파트장 결재로 보류. */
export async function createOpsProposalAction(input: {
  brand_id: string;
  track: string;              // OPS_TRACKS.key
  monthlyAmount: number;      // 수기 월 금액(원)
  paymentMode: OpsPaymentMode;
  commitmentMonths?: number;  // 약정 3|6|12
  addlDiscountPct: number;    // 0/5/10/20/30/40/50/60
  countryDiscountPct?: number;// 국가 추가할인 (같은 티어)
  countries?: string[];       // 대상 국가(중복선택)
  periodStart?: string;       // YYYY-MM-DD
  periodEnd?: string;
  contractFileUrl?: string;
}): Promise<OpsQuoteResultOut> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };
  const track = OPS_TRACKS.find((t) => t.key === input.track);
  if (!track) return { ok: false, error: "트랙을 선택하세요." };
  const monthly = Math.round(Number(input.monthlyAmount) || 0);
  if (monthly <= 0) return { ok: false, error: "월 정기 결제 금액을 입력하세요." };
  const addl = Number(input.addlDiscountPct) || 0;
  const countryDisc = Number(input.countryDiscountPct) || 0;
  const countries = (input.countries ?? []).filter((c) => OPS_COUNTRIES.some((x) => x.code === c));
  if (addl < 0 || addl > 100) return { ok: false, error: "추가 할인이 올바르지 않습니다." };

  const ps = (input.periodStart ?? "").trim();
  const pe = (input.periodEnd ?? "").trim();
  if (ps && !isYmd(ps)) return { ok: false, error: "계약 시작일을 확인하세요." };
  if (pe && !isYmd(pe)) return { ok: false, error: "계약 종료일을 확인하세요." };
  if (ps && pe && ps > pe) return { ok: false, error: "계약 시작일이 종료일보다 늦습니다." };
  const contractFileUrl = (input.contractFileUrl ?? "").trim();
  if (contractFileUrl && !/^https:\/\//.test(contractFileUrl)) return { ok: false, error: "계약서 링크는 https:// 로 시작해야 합니다." };

  const q = computeOpsQuote({ monthlyAmount: monthly, paymentMode: input.paymentMode, commitmentMonths: input.commitmentMonths, addlDiscountPct: addl, countryDiscountPct: countryDisc, countries });

  const b = await query<{ brand_name: string; contact_name: string | null }>(
    "SELECT brand_name, contact_name FROM brands WHERE id=$1", [input.brand_id],
  ).catch(() => []);
  if (b.length === 0) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 합산 할인 30%↑ → 파트장/대표가 아니면 결재 요청만 남기고 생성 보류.
  if (q.totalDiscountPct >= OPS_APPROVAL_THRESHOLD && u.role !== "lead" && u.role !== "exec") {
    await query(
      `INSERT INTO approval_requests (brand_id, kind, payload, requested_by) VALUES ($1,'discount',$2,$3)`,
      [input.brand_id, JSON.stringify({ track: track.key, monthly, mode: input.paymentMode, months: q.months, addlDiscountPct: addl, countryDiscountPct: countryDisc, totalDiscountPct: q.totalDiscountPct, countries, total: q.total, requested_by: `admin:${u.id}` }), `admin:${u.id}`],
    ).catch(() => {});
    revalidatePath("/proposals");
    return { ok: true, pendingApproval: true, quote: q.total, breakdown: q.breakdown };
  }

  const termLabel = q.recurring ? "월 정기결제" : `약정 ${q.months}개월`;
  const contractTerm = [termLabel, ps && pe ? `${ps} ~ ${pe}` : null].filter(Boolean).join(" · ");
  // 할인 표기는 값이 있을 때만(0%는 넣지 않음).
  const discBits = [addl > 0 ? `추가할인 ${addl}%` : "", countryDisc > 0 ? `국가할인 ${countryDisc}%` : ""].filter(Boolean).join(" · ");
  const discountNote = `${q.breakdown}${discBits ? ` | ${discBits}` : ""}`;

  const row = await query<{ id: string }>(
    `INSERT INTO proposals (brand_id, kind, plan, quote_amount, amount, term, countries, period_start, period_end, contract_term, contract_file_url, discount_note, status, created_by)
     VALUES ($1,'sales',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12) RETURNING id`,
    [input.brand_id, track.plan, q.total, q.total, input.paymentMode, countries, ps || null, pe || null, contractTerm, contractFileUrl || null, discountNote, `admin:${u.id}`],
  ).catch(() => []);
  if (row.length === 0) return { ok: false, error: "제안서 저장 실패" };
  const id = row[0].id;

  // 브랜드 플랜·계약형태 반영(비어있으면).
  await query(
    "UPDATE brands SET plan=COALESCE(plan,$2), contract_type=COALESCE(contract_type,$3), updated_at=now() WHERE id=$1",
    [input.brand_id, track.plan, track.contractType],
  ).catch(() => {});

  const preview = composeOpsProposal(b[0], {
    trackLabel: track.label, mode: input.paymentMode, months: q.months, monthly: q.monthlyNet,
    total: q.total, totalDiscountPct: q.totalDiscountPct, countries, periodStart: ps, periodEnd: pe, contractFileUrl,
  });

  revalidatePath("/proposals");
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true, proposalId: id, quote: q.total, breakdown: q.breakdown, preview };
}

/** 운영 견적서 발송용 데이터 조회(공용). */
async function loadOpsProposal(proposalId: string) {
  const { queryOne } = await import("@/lib/db");
  return queryOne<{
    brand_id: string; plan: string | null; quote_amount: number | null; amount: number | null; term: string | null;
    countries: string[] | null; period_start: string | null; period_end: string | null; contract_term: string | null;
    contract_file_url: string | null; discount_note: string | null;
    brand_name: string; contact_name: string | null; email: string | null; phone: string | null;
  }>(
    `SELECT p.brand_id, p.plan, p.quote_amount, p.amount, p.term, p.countries, p.period_start, p.period_end, p.contract_term, p.contract_file_url, p.discount_note,
            b.brand_name, b.contact_name, b.email, b.phone
       FROM proposals p JOIN brands b ON b.id=p.brand_id WHERE p.id=$1`, [proposalId],
  ).catch(() => null);
}

function opsProposalContent(p: NonNullable<Awaited<ReturnType<typeof loadOpsProposal>>>) {
  const track = OPS_TRACKS.find((t) => t.plan === p.plan);
  const mode: OpsPaymentMode = p.term === "commitment" ? "commitment" : "monthly";
  const mMatch = (p.contract_term ?? "").match(/약정 (\d+)개월/);
  const months = mMatch ? Number(mMatch[1]) : 1;
  const total = Number(p.quote_amount ?? p.amount ?? 0);
  const monthly = mode === "commitment" && months > 0 ? Math.round(total / months) : total;
  return composeOpsProposal(
    { brand_name: p.brand_name, contact_name: p.contact_name },
    { trackLabel: track?.label ?? (p.plan ?? "운영"), mode, months, monthly, total, totalDiscountPct: 0, countries: p.countries ?? [], periodStart: p.period_start ?? "", periodEnd: p.period_end ?? "", contractFileUrl: p.contract_file_url ?? "" },
  );
}

/** 발송 전 미리보기 — 리스팅 발송 버튼에서 내용 확인용. */
export async function opsProposalPreviewAction(proposalId: string): Promise<{ ok: boolean; error?: string; subject?: string; body?: string; hasEmail?: boolean; hasPhone?: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const p = await loadOpsProposal(proposalId);
  if (!p) return { ok: false, error: "견적서를 찾을 수 없습니다." };
  const { subject, body } = opsProposalContent(p);
  return { ok: true, subject, body, hasEmail: !!p.email, hasPhone: !!p.phone };
}

/** 운영 견적서 발송 — 메일이 기본(항상), 문자 안내는 체크 시에만. sent 기록. */
export async function sendOpsProposalAction(proposalId: string, opts: { sendSmsNotice: boolean }): Promise<{ ok: boolean; error?: string; sentEmail?: boolean; sentSms?: boolean; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const p = await loadOpsProposal(proposalId);
  if (!p) return { ok: false, error: "견적서를 찾을 수 없습니다." };
  const { subject, body } = opsProposalContent(p);

  let sentEmail = false, sentSms = false;
  const errors: string[] = [];
  // 메일은 기본(항상 발송 시도).
  if (!p.email) errors.push("이메일 미등록");
  else {
    const { sendEmail } = await import("@/lib/mailer");
    const r = await sendEmail({ to: p.email, subject, text: body });
    if (r.ok) sentEmail = true; else errors.push(r.skipped ? "메일 미설정(Gmail/RESEND)" : (r.error || "메일 실패"));
  }
  // 문자 안내는 체크했을 때만.
  if (opts.sendSmsNotice) {
    if (!p.phone) errors.push("전화번호 미등록");
    else {
      const { sendSms } = await import("@/lib/sms");
      const smsBody = `[GloveK] ${p.brand_name} 운영 견적서를 메일로 보내드렸습니다. 확인 부탁드립니다.${p.contract_file_url ? ` ${p.contract_file_url}` : ""}`;
      const r = await sendSms({ receiver: p.phone, msg: smsBody }).catch(() => ({ ok: false } as { ok: boolean }));
      if (r.ok) sentSms = true; else errors.push("문자 실패/미설정");
    }
  }

  // 발송 기록 — sent + 팔로업 기한.
  await setProposalV2Status(proposalId, "sent").catch(() => {});
  await query("UPDATE proposals SET followup_due=(sent_at + interval '3 days')::date WHERE id=$1 AND sent_at IS NOT NULL", [proposalId]).catch(() => {});
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
     VALUES ($1,'manual','contact_logged',$2,$3,now()) ON CONFLICT (site, event, source_ref) DO NOTHING`,
    [p.brand_id, `ops_proposal_send:${proposalId}`, JSON.stringify({ kind: "ops_proposal_sent", proposal_id: proposalId, email: sentEmail, sms: sentSms })],
  ).catch(() => {});

  revalidatePath("/proposals");
  revalidatePath(`/brand/${p.brand_id}`);
  return { ok: true, sentEmail, sentSms, note: errors.length ? errors.join(" · ") : undefined };
}

// 제안서 발송용 이메일 초안 생성(초안함 경유). 실패해도 제안서 생성은 유지한다.
async function draftProposalEmail(
  proposalId: string,
  brandId: string,
  d: {
    plan: string;
    countries: string[];
    term: string;
    quote: number;
    contractFileUrl: string;
    contractTerm: string;
    billingDay: number | null;
  },
): Promise<{ ok: boolean; note?: string }> {
  const { queryOne } = await import("@/lib/db");
  const b = await queryOne<{ brand_name: string; email: string | null }>(
    "SELECT brand_name, email FROM brands WHERE id=$1",
    [brandId],
  ).catch(() => null);
  if (!b) return { ok: false, note: "브랜드 조회 실패 — 발송 초안 미생성" };
  if (!b.email) {
    return { ok: false, note: "브랜드 담당자 이메일 미등록 — 발송 초안 미생성(회사정보에서 입력)" };
  }

  // 중복 방지: 같은 제안서로 대기 중(draft) 초안이 있으면 새로 만들지 않는다.
  const dup = await queryOne<{ id: string }>(
    "SELECT id FROM email_drafts WHERE proposal_id=$1 AND status='draft'",
    [proposalId],
  ).catch(() => null);
  if (dup) return { ok: true };

  const planLabel = PLAN_KO[d.plan] ?? d.plan;
  const termLabel = d.term === "6month" ? "6개월 약정" : "3개월(월단위)";
  const subject = `[GloveK] ${b.brand_name} 글로벌 진출 제안서 안내`;
  const body = [
    `안녕하세요, ${b.brand_name} 담당자님.`,
    "",
    "GloveK 제안 내용을 안내드립니다.",
    `· 플랜: ${planLabel} (${termLabel})`,
    d.countries.length > 0 ? `· 대상 국가: ${d.countries.join(", ")}` : null,
    `· 견적: ${d.quote.toLocaleString("ko-KR")}원 + VAT`,
    d.contractTerm ? `· 계약기간: ${d.contractTerm}` : null,
    d.billingDay !== null ? `· 매월 결제일: ${d.billingDay}일` : null,
    d.contractFileUrl ? `· 계약서: ${d.contractFileUrl}` : null,
    "",
    "검토 후 회신 주시면 계약 절차를 안내드리겠습니다.",
    "",
    "감사합니다.",
    "GloveK 드림",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status, proposal_id)
     VALUES ($1, 'doc_request', $2, $3, $4, 'draft', $5) RETURNING id`,
    [brandId, b.email, subject, body, proposalId],
  ).catch(() => null);
  if (!row) return { ok: false, note: "발송 초안 저장 실패" };
  return { ok: true };
}

// 목록 행 상태 스텝 이동. 허용된 전이만 통과시킨다.
const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected"],
};

export async function setProposalStatusV2Action(
  id: string,
  status: string,
  brandId?: string,
): Promise<ProposalActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!id) return { ok: false, error: "제안서 ID 누락" };

  // 현재 상태 확인 후 허용 전이만.
  const { queryOne } = await import("@/lib/db");
  const cur = await queryOne<{ status: string; brand_id: string; kind: string | null }>(
    "SELECT status, brand_id, kind FROM proposals WHERE id=$1",
    [id],
  ).catch(() => null);
  if (!cur) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  // 마케팅 제안서는 영업 경로(초안함·수신동의 게이트 우회)로 발송 금지 — /mkt 전용.
  if ((cur.kind ?? "sales") === "marketing") {
    return { ok: false, error: "마케팅 제안서는 마케팅(/mkt) 화면에서 발송하세요." };
  }

  const next = ALLOWED_NEXT[cur.status] ?? [];
  if (!next.includes(status)) {
    return { ok: false, error: `'${cur.status}' → '${status}' 전이는 허용되지 않습니다.` };
  }

  await setProposalV2Status(id, status);

  let draftReady = false;
  let note: string | undefined;
  if (status === "sent") {
    // 발송 후 2~3일 미계약 팔로업 기한 = sent_at + 3일.
    await query(
      "UPDATE proposals SET followup_due = (sent_at + interval '3 days')::date WHERE id=$1 AND sent_at IS NOT NULL",
      [id],
    ).catch(() => {});

    // "발송" 은 상태 스탬프만이 아니라 실제 발송 초안(초안함)을 생성한다 — 빌더 경로와 동일. (sales#2·#3)
    const p = await queryOne<{ plan: string; countries: string[] | null; term: string | null; quote_amount: number | null; contract_file_url: string | null; contract_term: string | null; billing_day: number | null }>(
      "SELECT plan, countries, term, quote_amount, contract_file_url, contract_term, billing_day FROM proposals WHERE id=$1",
      [id],
    ).catch(() => null);
    if (p) {
      const draft = await draftProposalEmail(id, cur.brand_id, {
        plan: p.plan,
        countries: p.countries ?? [],
        term: p.term ?? "3month",
        quote: Number(p.quote_amount ?? 0),
        contractFileUrl: p.contract_file_url ?? "",
        contractTerm: p.contract_term ?? "",
        billingDay: p.billing_day,
      });
      draftReady = draft.ok;
      note = draft.ok
        ? "발송 초안이 초안함에 생성되었습니다 — 초안함에서 승인 후 실제 발송됩니다."
        : draft.note;
    }
  }

  revalidatePath("/proposals");
  revalidatePath("/drafts");
  revalidatePath(`/brand/${brandId ?? cur.brand_id}`);
  return { ok: true, draftReady, note };
}

// ─────────────────────────────────────────────────────────────
// AI 제안서 커스텀 문구 생성.
//   선택 브랜드의 카드 맥락(카테고리·단계·목표국·plan/grade/추천트랙)과
//   견적 빌더의 현재 선택(plan·국가·약정)을 합쳐 제안서 소개/설득 문구를 생성.
//   복사용 초안만 만든다 — 판정(등급·게이트·정산)·개인정보(연락처 등)는 다루지 않는다.
// ─────────────────────────────────────────────────────────────

// state 코드 → 한글 라벨(퍼널 단계). 프롬프트 맥락용.
const STATE_KO: Record<string, string> = {
  lead_new: "신규 리드",
  seminar: "담당자배정",
  meeting: "미팅",
  contact: "컨택",
  contract_review: "계약 검토",
  contract_done: "계약 완료",
  docs: "서류",
  setup: "셋업",
  live_mall: "몰 운영",
  live_onboarding: "온보딩 운영",
  settling: "정산",
  dropped: "이탈",
  churned: "해지",
};

const PLAN_KO: Record<string, string> = {
  live_focus_490k: "Live Focus (49만)",
  guarantee_1m: "Guarantee (100만)",
  onboarding_onetime: "온보딩(원타임)",
  pro_89k: "Pro (8.9만)",
};

export interface AiCopyResult {
  ok: boolean;
  error?: string;
  text?: string;
}

export async function generateProposalCopyAction(input: {
  brand_id: string;
  plan?: string;
  countries?: string[];
  term?: QuoteTerm;
}): Promise<AiCopyResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  // 실데이터로 카드 맥락 구성(개인정보 컬럼은 조회하지 않는다).
  const rows = await query<{
    brand_name: string;
    brand_name_en: string | null;
    category: string | null;
    state: string;
    plan: string | null;
    grade: string | null;
    rec_track: string | null;
    contract_type: string | null;
    countries: string[] | null;
  }>(
    `SELECT brand_name, brand_name_en, category, state, plan, grade, rec_track, contract_type, countries
       FROM brands WHERE id = $1`,
    [input.brand_id],
  ).catch(() => []);
  const b = rows[0];
  if (!b) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 빌더에서 고른 값이 있으면 우선, 없으면 카드 저장값.
  const plan = input.plan || b.plan || "";
  const countries =
    input.countries && input.countries.length > 0
      ? input.countries
      : b.countries ?? [];
  const planLabel = PLAN_KO[plan] ?? plan ?? "미정";
  const stateLabel = STATE_KO[b.state] ?? b.state;

  const ctxLines = [
    `브랜드: ${b.brand_name}${b.brand_name_en ? ` (${b.brand_name_en})` : ""}`,
    `카테고리: ${b.category || "미상"}`,
    `현재 단계: ${stateLabel}`,
    `목표국: ${countries.length ? countries.join(", ") : "미정"}`,
    `플랜: ${planLabel}`,
    b.rec_track ? `추천 트랙: ${b.rec_track}` : "",
    input.term ? `약정: ${input.term === "6month" ? "6개월" : "3개월"}` : "",
  ].filter(Boolean);

  const system =
    "너는 글로벌 커머스 대행사 GloveK 의 B2B 세일즈 카피라이터다. " +
    "브랜드 맥락을 바탕으로 제안서에 넣을 한국어 소개/설득 문구 초안을 쓴다. " +
    "규칙: 사실 기반으로 담백하고 신뢰감 있게, 과장·허위 수치 금지. " +
    "등급·게이트·정산 등 내부 판정이나 개인정보(담당자명·연락처·사업자번호)는 절대 언급하지 마라. " +
    "출력은 (1) 한 줄 소개 헤드라인, (2) 3문장 내 소개 단락, (3) 불릿 3개 설득 포인트 순서로만.";
  const user =
    `아래 브랜드 맥락으로 제안서 커스텀 문구를 작성해줘.\n\n` +
    ctxLines.join("\n");

  const text = await aiText({ system, user, maxTokens: 700 });
  if (!text) return { ok: false, error: "문구 생성에 실패했습니다." };
  return { ok: true, text };
}
