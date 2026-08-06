"use server";

// 브랜드360 · 1:1 사전 설문 서버액션 (기획확정 8절).
// "사전 설문 보내기" — 공개 링크 생성 + 이메일 발송 준비.
// 발송은 직접 하지 않고 초안함(email_drafts) 경유 — 승인·발송은 기존 approveAndSend(canSend 게이트).
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { createSurvey } from "@/lib/repo/card";
import { env } from "@/lib/env";
import { aiEnabled, aiText } from "@/lib/ai";
import { getQuestions } from "@/lib/survey-db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreSurveySendResult {
  ok: boolean;
  error?: string;
  url?: string;        // 공개 응답 링크(/s/{token})
  draftId?: string;    // 초안함 초안 id
  reusedDraft?: boolean; // 동일 링크 초안이 이미 있어 재사용됨
}

/**
 * 사전 설문 보내기:
 *  1) 미응답 pre_meeting 설문이 있으면 토큰 재사용, 없으면 생성(surveys.answers jsonb — 스키마 변경 없음)
 *  2) 요청 메일을 초안함에 생성(kind='doc_request': 회사정보·서류 요청 성격의 거래성 — canSend 통과)
 *  3) 실제 발송·contact_logged 기록은 초안함 승인 시 기존 경로가 수행
 */
export async function sendPreSurveyAction(brandId: string): Promise<PreSurveySendResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };

  const brand = await queryOne<{ brand_name: string; email: string | null }>(
    "SELECT brand_name, email FROM brands WHERE id=$1", [brandId]).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 1) 설문 토큰 — 미응답 사전 설문 재사용(중복 생성 방지)
  const existing = await queryOne<{ token: string }>(
    `SELECT token FROM surveys
      WHERE brand_id=$1 AND kind='pre_meeting' AND responded_at IS NULL
      ORDER BY created_at DESC LIMIT 1`, [brandId]).catch(() => null);
  const token = existing?.token ?? await createSurvey(brandId, "pre_meeting");
  const url = `${env.adminUrl}/s/${token}`;

  // 2) 수신자 — brands.email → 대표 연락처 폴백(없으면 초안함에서 수기 입력)
  let to = (brand.email ?? "").trim();
  if (!to) {
    const c = await queryOne<{ email: string | null }>(
      "SELECT email FROM brand_contacts WHERE brand_id=$1 AND is_primary AND email IS NOT NULL LIMIT 1",
      [brandId]).catch(() => null);
    to = (c?.email ?? "").trim();
  }

  // 3) 초안함 — 동일 링크의 대기 초안이 있으면 재사용(중복 초안 방지)
  const dup = await queryOne<{ id: string }>(
    "SELECT id FROM email_drafts WHERE brand_id=$1 AND status='draft' AND body_md LIKE '%'||$2||'%' LIMIT 1",
    [brandId, token]).catch(() => null);
  if (dup) {
    revalidatePath(`/brand/${brandId}`);
    return { ok: true, url, draftId: dup.id, reusedDraft: true };
  }

  const subject = `[GloveK] ${brand.brand_name} 1:1 미팅 사전 설문 요청`;
  const bodyMd = `${brand.brand_name} 담당자님, 안녕하세요. GloveK입니다.

예정된 1:1 미팅을 더 알차게 준비하기 위해 사전 설문을 부탁드립니다. (약 2분)
- 마케팅 목표 · 기존 채널 · 월 광고 예산 · 콘텐츠 보유 현황
- 회사 기본정보: 사업자등록번호 · 회사명 · 주소 · 담당자 연락처

▶ 사전 설문 링크: ${url}

응답해 주신 내용은 미팅 준비와 맞춤 제안에만 활용됩니다. 감사합니다.
GloveK 드림`;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status)
     VALUES ($1,'doc_request',$2,$3,$4,'draft') RETURNING id`,
    [brandId, to, subject, bodyMd]).catch(() => null);
  if (!row) return { ok: false, error: "메일 초안 생성 실패" };

  revalidatePath(`/brand/${brandId}`);
  return { ok: true, url, draftId: row.id };
}

// ─────────────────────────────────────────────────────────────
// AI 설문 인사이트 — 응답을 구조화 추출해 survey_insights 저장 + 브랜드 원장에 반영(빈 값만).
//   허위 생성 금지: 응답에 없는 값은 비운다. 성과·판정이 아닌 "브랜드 이해" 데이터만.
// ─────────────────────────────────────────────────────────────
export interface SurveyInsight {
  summary_md?: string;
  category?: string;
  target_countries?: string[];
  budget_band?: string;
  seeding_capacity?: string;
  certifications?: string;
  competitors?: string;
  target_customer?: string;
  goal?: string;
  content_guideline?: string;
  decision_maker?: string;
}
const COUNTRY_LABELS = ["미국", "베트남", "태국", "싱가포르", "필리핀", "말레이시아", "인도네시아", "일본"];

function looseJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { /* try slice */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as T; } catch { /* noop */ } }
  return null;
}

/** 설문(surveyId) 응답을 AI 로 추출·요약하고 survey_insights 저장 + 브랜드 빈 필드 반영. by=행위자. */
export async function extractAndApplyInsight(surveyId: string, by: string): Promise<{ ok: boolean; error?: string; insight?: SurveyInsight }> {
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };
  const s = await queryOne<{ id: string; brand_id: string; kind: string; answers: Record<string, unknown> | null }>(
    "SELECT id, brand_id, kind, answers FROM surveys WHERE id=$1", [surveyId]).catch(() => null);
  if (!s || !s.brand_id) return { ok: false, error: "설문을 찾을 수 없습니다." };
  const answers = s.answers ?? {};
  if (Object.keys(answers).length === 0) return { ok: false, error: "응답 내용이 없습니다." };

  // 문항 라벨 + 응답을 사람이 읽는 형태로.
  const questions = await getQuestions(s.kind);
  const lines = questions
    .map((q) => {
      const v = answers[q.key];
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
      return `${q.label}\n→ ${Array.isArray(v) ? v.join(", ") : String(v)}`;
    })
    .filter(Boolean)
    .join("\n\n");
  if (!lines) return { ok: false, error: "요약할 응답이 없습니다." };

  const system =
    "너는 글로벌 커머스 대행사 GloveK 의 브랜드 애널리스트다. 브랜드 사전 설문 응답을 읽고 " +
    "운영·마케팅에 쓸 핵심 정보를 구조화한다. 반드시 유효한 JSON 하나만 출력(코드펜스·설명 금지). " +
    "응답에 없는 값은 지어내지 말고 비워라(빈 문자열 또는 생략). 개인정보(연락처·사업자번호)는 담지 마라.";
  const user =
    `아래 설문 응답을 다음 JSON 스키마로 요약·구조화해줘.\n` +
    `국가는 [${COUNTRY_LABELS.join(", ")}] 중 언급된 것만 배열로.\n\n` +
    `{"summary_md":"3~5문장 한국어 요약",` +
    `"category":"제품 카테고리(예: 스킨케어)","target_countries":["국가"],` +
    `"budget_band":"월/캠페인 예산대","seeding_capacity":"시딩 가능 규모",` +
    `"certifications":"보유 인증·클레임","competitors":"경쟁/롤모델 브랜드",` +
    `"target_customer":"주요 타겟 고객","goal":"브랜드가 원하는 상태·목표",` +
    `"content_guideline":"콘텐츠 강조/금지","decision_maker":"의사결정·소통 창구"}\n\n` +
    `[설문 응답]\n${lines.slice(0, 6000)}`;

  let insight: SurveyInsight | null = null;
  try {
    const text = await aiText({ system, user, maxTokens: 1200 });
    insight = text ? looseJson<SurveyInsight>(text) : null;
  } catch (e) {
    return { ok: false, error: `AI 분석 실패: ${(e as Error).message}` };
  }
  if (!insight) return { ok: false, error: "AI 응답 파싱 실패." };

  // survey_insights 저장.
  await query(
    `INSERT INTO survey_insights (brand_id, survey_id, extracted, summary_md, applied, created_by)
     VALUES ($1,$2,$3::jsonb,$4,true,$5)`,
    [s.brand_id, s.id, JSON.stringify(insight), insight.summary_md ?? null, by],
  ).catch((e) => console.error("[survey] 인사이트 저장 실패:", (e as Error).message));

  // 브랜드 원장 반영(빈 값만 — 어드민 보정값 우선).
  if (insight.category) {
    await query("UPDATE brands SET category=$2 WHERE id=$1 AND (category IS NULL OR category='')",
      [s.brand_id, insight.category]).catch(() => {});
  }
  const countries = (insight.target_countries ?? []).filter((c) => COUNTRY_LABELS.includes(c));
  if (countries.length > 0) {
    await query(
      "UPDATE brands SET countries=$2 WHERE id=$1 AND (countries IS NULL OR cardinality(countries)=0)",
      [s.brand_id, countries]).catch(() => {});
  }
  if (insight.category || insight.target_customer) {
    await query(
      `INSERT INTO brand_company (brand_id, product_category, source)
       VALUES ($1, NULLIF($2,''), 'manual')
       ON CONFLICT (brand_id) DO UPDATE SET
         product_category = COALESCE(NULLIF(brand_company.product_category,''), EXCLUDED.product_category, brand_company.product_category),
         updated_at = now()`,
      [s.brand_id, insight.category ?? ""]).catch(() => {});
  }

  return { ok: true, insight };
}

/** 어드민 버튼 — 설문 AI 분석·반영. */
export async function extractSurveyInsightAction(surveyId: string): Promise<{ ok: boolean; error?: string; insight?: SurveyInsight }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const r = await extractAndApplyInsight(surveyId, `admin:${u.id}`);
  if (r.ok) {
    const s = await queryOne<{ brand_id: string }>("SELECT brand_id FROM surveys WHERE id=$1", [surveyId]).catch(() => null);
    if (s) revalidatePath(`/brand/${s.brand_id}`);
  }
  return r;
}
