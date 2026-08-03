"use server";

// 브랜드360 화면 전용 서버액션.
// (@/app/actions.ts 는 수정 금지 규칙에 따라 이 화면 전용 파일로 분리)
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { aiText, aiEnabled } from "@/lib/ai";
import { STATE_LABELS, type State } from "@/lib/types";

export interface NextActionSuggestResult {
  ok: boolean;
  error?: string;
  draft?: string;
}

/**
 * 다음 액션 제안 AI 초안 — 해당 브랜드의 맥락(사전분석 브리프·현재 단계·기존 다음액션·
 * 최근 메일 제목/요약)을 바탕으로 담당자가 취할 "다음 액션"을 한국어로 제안한다.
 *   · 존재 테이블/컬럼(brands, brand_emails)만 사용하고 데이터를 지어내지 않는다.
 *   · 등급 판정·발송 게이트·정산 금액 산정 같은 판정은 하지 말고, 제안·문구·요약만 작성.
 *   · 개인정보(카드번호·신분증·비밀번호)는 프롬프트/출력에 포함하지 않는다.
 */
export async function suggestNextActionsAction(
  brandId: string,
): Promise<NextActionSuggestResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brandId)) {
    return { ok: false, error: "잘못된 브랜드 ID" };
  }

  // 실데이터 — 브랜드 맥락(개인정보 컬럼은 조회하지 않음).
  const brand = await queryOne<{
    brand_name: string;
    category: string;
    state: State;
    next_action: string;
    brief_md: string | null;
    due_date: string | null;
    last_contact_at: string | null;
  }>(
    `SELECT brand_name, category, state, next_action, brief_md, due_date, last_contact_at
       FROM brands WHERE id=$1`,
    [brandId],
  ).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 최근 메일 — 방향·제목·요약만(주소 등 개인정보는 프롬프트에 넣지 않음).
  const emails = await query<{
    direction: string;
    subject: string | null;
    snippet: string | null;
    occurred_at: string;
  }>(
    `SELECT direction, subject, snippet, occurred_at
       FROM brand_emails WHERE brand_id=$1 ORDER BY occurred_at DESC LIMIT 5`,
    [brandId],
  ).catch(() => [] as { direction: string; subject: string | null; snippet: string | null; occurred_at: string }[]);

  const DIR_LABEL: Record<string, string> = { in: "수신", out: "발신", unknown: "-" };
  const mailLines = emails.length
    ? emails
        .map(
          (e) =>
            `- ${e.occurred_at.slice(0, 10)} ${DIR_LABEL[e.direction] ?? e.direction} · ${e.subject || "(제목 없음)"}${e.snippet ? ` — ${e.snippet.slice(0, 120)}` : ""}`,
        )
        .join("\n")
    : "- 기록된 메일 없음";

  const briefText = brand.brief_md
    ? brand.brief_md.slice(0, 1500)
    : "(사전분석 브리프 미생성)";

  const system = `너는 GloveK(틱톡샵 해외진출 운영대행사)의 브랜드 담당 매니저를 돕는 AI 도우미다. 아래 브랜드 맥락을 바탕으로, 담당자가 지금 취하면 좋은 한국어 "다음 액션 제안"을 작성한다.
규칙:
- 제공된 맥락만 사용하고 없는 사실을 지어내지 않는다.
- 등급 판정·발송 게이트 충족 여부·정산 금액 산정 같은 판정은 하지 말고, 실무적인 다음 액션 제안·문구·요약만 작성한다.
- 개인정보(카드번호·신분증·비밀번호)는 절대 포함하지 않는다.
- 형식: 우선순위가 높은 순서로 3~5개의 구체적 액션을 번호 목록으로. 각 항목은 한 줄로 간결하게(무엇을·왜). 마지막에 한 줄 코멘트.`;

  const user = `브랜드: ${brand.brand_name}
카테고리: ${brand.category || "미상"}
현재 단계: ${STATE_LABELS[brand.state] ?? brand.state}
기존 다음 액션: ${brand.next_action || "(없음)"}${brand.due_date ? ` (기한 ${brand.due_date.slice(0, 10)})` : ""}
마지막 접촉: ${brand.last_contact_at ? brand.last_contact_at.slice(0, 10) : "기록 없음"}

사전분석 브리프:
${briefText}

최근 메일:
${mailLines}

위 맥락으로 담당자를 위한 "다음 액션 제안"을 작성해줘.`;

  const draft = await aiText({ system, user, maxTokens: 700 }).catch(() => null);
  if (!draft) return { ok: false, error: "AI 제안 생성 실패 (잠시 후 재시도)" };
  return { ok: true, draft: draft.trim() };
}

// ═══ v3.1 재정합 추가 액션 ═══════════════════════════════════
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 메모·협업 탭 코멘트 등록 — comments 테이블(0006). @멘션은 mentions 배열로 보존. */
export async function addCommentAction(
  brandId: string, body: string,
): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };
  const text = (body ?? "").trim();
  if (!text) return { ok: false, error: "내용을 입력하세요" };
  const mentions = [...text.matchAll(/@([^\s@,]+)/g)].map((m) => m[1]);
  await query(
    "INSERT INTO comments (brand_id, author, body, mentions) VALUES ($1,$2,$3,$4)",
    [brandId, u.name || u.id, text, mentions],
  );
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

/**
 * AI 기업·브랜드 심층 분석(회사정보 탭) — 브랜드·회사·시그널·제품 실데이터만으로
 * 매출/구조/채널/포지셔닝 추정 요약을 생성해 반환한다(저장 테이블 없음 → 화면 표시용).
 * 판단 참고용 문구만 작성하고 등급 판정·게이트 판정은 하지 않는다.
 */
export async function deepAnalysisAction(
  brandId: string,
): Promise<{ ok: boolean; error?: string; md?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };

  const brand = await queryOne<{
    brand_name: string; category: string; brand_url: string; biz_no: string | null;
    countries: string[]; grade: string | null; brief_md: string | null;
  }>(
    `SELECT brand_name, category, brand_url, biz_no, countries, grade, brief_md
       FROM brands WHERE id=$1`, [brandId],
  ).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  const [signals, products] = await Promise.all([
    query<{ source: string; metric: string; value_num: number | null; value_text: string | null; confidence: string }>(
      "SELECT source, metric, value_num, value_text, confidence FROM brand_signals WHERE brand_id=$1 ORDER BY collected_at DESC LIMIT 20",
      [brandId],
    ).catch(() => []),
    query<{ name_kr: string; category: string; price_band: string }>(
      "SELECT name_kr, category, price_band FROM products_master WHERE brand_id=$1 LIMIT 20",
      [brandId],
    ).catch(() => []),
  ]);

  const sigLines = signals.length
    ? signals.map((s) => `- ${s.source} · ${s.metric} = ${s.value_num ?? s.value_text ?? "-"} (신뢰도 ${s.confidence})`).join("\n")
    : "- 수집된 시그널 없음";
  const prodLines = products.length
    ? products.map((p) => `- ${p.name_kr}${p.category ? ` (${p.category})` : ""}${p.price_band ? ` · ${p.price_band}` : ""}`).join("\n")
    : "- 등록 제품 없음";

  const system = `너는 GloveK 운영 어드민의 기업·브랜드 심층 분석 도우미다. 제공된 실데이터만 사용해 한국어 분석 요약을 작성한다.
규칙:
- 제공된 데이터에 없는 수치·사실을 지어내지 않는다. 데이터가 없으면 "데이터 부족"이라고 명시한다.
- 등급 판정·게이트 판정·정산 금액 산정은 하지 않는다. 판단 참고용 요약만 작성한다.
- 형식(마크다운): **매출 추정** / **회사 구조** / **채널 구조** / **브랜드 포지셔닝** 4개 소제목 각 1~2줄 + 마지막에 💡기회 / ⚠️리스크 각 1줄.`;

  const user = `브랜드: ${brand.brand_name}
카테고리: ${brand.category || "미상"} · URL: ${brand.brand_url || "없음"} · 사업자번호: ${brand.biz_no ? "있음" : "없음"}
목표국: ${brand.countries?.length ? brand.countries.join(", ") : "미정"} · 진단 등급: ${brand.grade ?? "미진단"}

사전분석 브리프:
${brand.brief_md ? brand.brief_md.slice(0, 1200) : "(미생성)"}

수집 시그널:
${sigLines}

제품:
${prodLines}

위 실데이터만으로 심층 분석 요약을 작성해줘.`;

  const md = await aiText({ system, user, maxTokens: 900 }).catch(() => null);
  if (!md) return { ok: false, error: "AI 분석 생성 실패 (잠시 후 재시도)" };
  return { ok: true, md: md.trim() };
}

// ═══ 셋업 — 브랜드별 제품/인증/물류 보강 (PLAN 8절) ═══════════
// @/app/actions.ts 수정 금지 규칙에 따라, 기존 upsertCertAction/upsertLogisticsAction 이
// 받지 못하던 입력(서류링크=note·발급일·계약 시작일)을 이 화면 액션으로 확장한다.
// 저장처는 어드민 원장 테이블(product_certs·logistics_contracts)뿐 — glovek 원본은 읽기전용.
import { upsertCert as repoUpsertCert, upsertLogistics as repoUpsertLogistics } from "@/lib/repo/card";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CERT_STATUSES = new Set(["none", "preparing", "submitted", "ready", "rejected", "expired"]);
const LOGI_STATUSES = new Set(["none", "negotiating", "contracted", "active", "expired"]);

function dateOrNull(v?: string | null): string | null {
  const s = (v ?? "").trim();
  return DATE_RE.test(s) ? s : null;
}

/** 인증 등록·수정(전체 필드) — 기존 컬럼 범위(issued_at·expires_at·note=서류링크/메모). */
export async function upsertCertFullAction(brandId: string, input: {
  product_id: string; country: string; cert_type: string; status?: string;
  cert_number?: string; issued_at?: string | null; expires_at?: string | null; note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };
  if (!UUID_RE.test(input.product_id)) return { ok: false, error: "제품을 선택하세요" };
  const certType = (input.cert_type ?? "").trim();
  if (!certType) return { ok: false, error: "인증 종류를 입력하세요" };
  // 제품이 이 브랜드 소속인지 확인(다른 브랜드 제품에 인증이 붙는 것 방지).
  const owns = await queryOne<{ id: string }>(
    "SELECT id FROM products_master WHERE id=$1 AND brand_id=$2", [input.product_id, brandId]);
  if (!owns) return { ok: false, error: "이 브랜드의 제품이 아닙니다" };
  const status = CERT_STATUSES.has(input.status ?? "") ? input.status! : "preparing";
  await repoUpsertCert({
    product_id: input.product_id, country: input.country, cert_type: certType, status,
    cert_number: (input.cert_number ?? "").trim(),
    issued_at: dateOrNull(input.issued_at), expires_at: dateOrNull(input.expires_at),
    note: (input.note ?? "").trim(),
  });
  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/products");
  return { ok: true };
}

/** 물류 계약 등록(전체 필드) — 시작일·계약서/서류 링크(note) 포함. */
export async function upsertLogisticsFullAction(input: {
  brand_id: string; country: string; provider?: string; status?: string;
  warehouse_region?: string; start_date?: string | null; end_date?: string | null; note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(input.brand_id)) return { ok: false, error: "잘못된 브랜드 ID" };
  const country = (input.country ?? "").trim().toUpperCase();
  if (!country) return { ok: false, error: "국가를 선택하세요" };
  const status = LOGI_STATUSES.has(input.status ?? "") ? input.status! : "none";
  await repoUpsertLogistics({
    brand_id: input.brand_id, country,
    provider: (input.provider ?? "").trim(), status,
    warehouse_region: (input.warehouse_region ?? "").trim(),
    start_date: dateOrNull(input.start_date), end_date: dateOrNull(input.end_date),
    note: (input.note ?? "").trim(),
  });
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}
