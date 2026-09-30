// 브랜드 해외 소개자료 — 근거 수집 · 생성 · 발행 · 공개 조회.
//   브랜드가 올린 회사자료(PDF·이미지)와 온보딩 신청서·제품·국가 정보를 근거로
//   대상 언어 제안서를 만든다. 실제 AI 호출이 성공한 경우에만 mode='ai' 로 적는다.
//
//   하지 않는 것(의도적):
//     · 개인정보(담당자 이름·이메일·전화, 신분증·여권·주소 증빙)는 근거에 넣지 않는다.
//     · 내부 AI 분석 메모(brief_md·deep_analysis_md)는 넣지 않는다 — 추정이 고객 문서로 흘러가지 않게.
//     · 외부 발송을 하지 않는다. 공개 링크는 담당자가 '발행' 을 눌러야 열린다.
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import {
  INTRO_LANGS, MARKET_NOTES, SYSTEM_PROMPT, INTRO_DOC_BYTES, INTRO_DOC_TOTAL_BYTES, INTRO_DOC_COUNT,
  buildIntroEvidence, validateIntro,
  type IntroLang, type IntroEvidence, type IntroSection,
} from "./intro-langs";

export const INTRO_SCHEMA_MIGRATION = "0102_brand_intro_docs.sql";

/** 유통 문의 메일(글로브K 해외유통 창구). env 로 바꿀 수 있고, 문서별로도 덮어쓸 수 있다. */
export const GLOVEK_PARTNER_EMAIL_DEFAULT = "dino_glovek@glovek.space";
export function defaultIntroContact(): string {
  return (process.env.GLOVEK_PARTNER_EMAIL || GLOVEK_PARTNER_EMAIL_DEFAULT).trim();
}

export interface IntroDocRow {
  id: string; brand_id: string; lang: IntroLang; token: string;
  status: "draft" | "published"; mode: "ai" | "rules";
  brand_name: string; title: string; subtitle: string;
  sections: IntroSection[]; evidence: { ref: string; label: string }[];
  skipped_files: string[]; note: string; contact_email: string;
  generated_by: string | null; generated_at: string | null; updated_at: string;
}

const COLS = `id, brand_id, lang, token, status, mode, brand_name, title, subtitle,
  sections, evidence, skipped_files, note, contact_email, generated_by,
  generated_at::text AS generated_at, updated_at::text AS updated_at`;

/** 0102 적용 여부 — "적용됐다고 가정"하지 않는다. */
export async function getIntroSchemaState(): Promise<{ ready: boolean; error?: string }> {
  try {
    const r = await queryOne<{ reg: string | null }>(
      "SELECT to_regclass('public.brand_intro_docs')::text AS reg");
    return r?.reg ? { ready: true } : { ready: false, error: `마이그레이션 ${INTRO_SCHEMA_MIGRATION} 미적용 — brand_intro_docs 표가 없습니다.` };
  } catch (e) {
    return { ready: false, error: `스키마 확인 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

export async function listIntroDocs(brandId: string): Promise<IntroDocRow[]> {
  return query<IntroDocRow>(
    `SELECT ${COLS} FROM brand_intro_docs WHERE brand_id=$1 ORDER BY lang`, [brandId]);
}

export async function getIntroByToken(token: string): Promise<IntroDocRow | null> {
  return queryOne<IntroDocRow>(
    `SELECT ${COLS} FROM brand_intro_docs WHERE token=$1`, [token]).catch(() => null);
}

export async function setIntroStatus(brandId: string, lang: IntroLang, status: "draft" | "published"):
  Promise<{ ok: boolean; error?: string }> {
  // 본문 없는 문서는 발행하지 않는다 — 빈 페이지가 공개 링크로 나가지 않게.
  if (status === "published") {
    const cur = await queryOne<{ n: number }>(
      `SELECT jsonb_array_length(sections) AS n FROM brand_intro_docs WHERE brand_id=$1 AND lang=$2`,
      [brandId, lang]);
    if (!cur) return { ok: false, error: "해당 언어 문서가 없습니다 — 먼저 생성하세요." };
    if (Number(cur.n) === 0) return { ok: false, error: "본문이 없어 발행할 수 없습니다 — 다시 생성해 섹션을 채운 뒤 발행하세요." };
  }
  const r = await query<{ id: string }>(
    `UPDATE brand_intro_docs SET status=$3, updated_at=now()
      WHERE brand_id=$1 AND lang=$2 RETURNING id`, [brandId, lang, status]);
  if (r.length === 0) return { ok: false, error: "해당 언어 문서가 없습니다 — 먼저 생성하세요." };
  return { ok: true };
}

export async function setIntroContact(brandId: string, lang: IntroLang, email: string):
  Promise<{ ok: boolean; error?: string }> {
  const e = (email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: "이메일 형식이 아닙니다." };
  const r = await query<{ id: string }>(
    `UPDATE brand_intro_docs SET contact_email=$3, updated_at=now()
      WHERE brand_id=$1 AND lang=$2 RETURNING id`, [brandId, lang, e]);
  if (r.length === 0) return { ok: false, error: "해당 언어 문서가 없습니다 — 먼저 생성하세요." };
  return { ok: true };
}

// ── 근거 수집 ───────────────────────────────────────────────

/** 모델에 그대로 보낼 첨부 1건. */
export interface IntroAttachment { ref: string; filename: string; mime: string; bytes: Buffer }

export interface IntroFacts {
  brandName: string;
  evidence: IntroEvidence[];
  attachments: IntroAttachment[];
  /** 모델이 읽지 못한 첨부 — 화면·문서에 있는 그대로 적는다. */
  skipped: string[];
}

const READY_KO: Record<string, string> = { none: "없음", preparing: "준비중", ready: "완료" };
// Claude 가 그대로 읽을 수 있는 첨부 형식. 그 밖(PPT·워드·한글·ZIP)은 읽지 못했다고 적는다.
const AI_DOC_MIME = new Set(["application/pdf"]);
const AI_IMG_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * 브랜드 소개에 쓸 사실만 모은다. 개인정보·내부 추정 메모는 넣지 않는다.
 *   DB 오류는 삼키지 않고 올린다(빈 근거로 "자료 없음" 처럼 보이지 않게).
 */
export async function collectIntroFacts(brandId: string): Promise<IntroFacts> {
  const brand = await queryOne<{
    brand_name: string; brand_name_en: string; category: string; brand_url: string; countries: string[] | null;
  }>(`SELECT brand_name, coalesce(brand_name_en,'') AS brand_name_en, coalesce(category,'') AS category,
             coalesce(brand_url,'') AS brand_url, countries
        FROM brands WHERE id=$1`, [brandId]);
  if (!brand) throw new Error("브랜드를 찾을 수 없습니다.");

  const raw: { label: string; text: string }[] = [];
  const push = (label: string, text: string) => { if ((text ?? "").trim()) raw.push({ label, text }); };

  push("브랜드 원장 · 기본",
    [brand.brand_name && `브랜드명: ${brand.brand_name}`,
     brand.brand_name_en && `영문 브랜드명: ${brand.brand_name_en}`,
     brand.category && `카테고리: ${brand.category}`,
     brand.brand_url && `대표 판매 채널: ${brand.brand_url}`,
     (brand.countries ?? []).length ? `관심 국가: ${(brand.countries ?? []).join(", ")}` : "",
    ].filter(Boolean).join(" / "));

  // 온보딩 신청서 — 연락처·서류 URL·서명 등 개인정보 컬럼은 일부러 뽑지 않는다.
  const app = await queryOne<{
    id: string; company_name_kr: string; company_name_en: string; company_country: string;
    company_reg_date: string | null; shop_name_kr: string; shop_name_en: string;
    product_category: string; sales_channel_url: string;
  }>(`SELECT a.id,
             coalesce(a.company_name_kr,'') AS company_name_kr, coalesce(a.company_name_en,'') AS company_name_en,
             coalesce(a.company_country,'') AS company_country, a.company_reg_date::text AS company_reg_date,
             coalesce(a.shop_name_kr,'') AS shop_name_kr, coalesce(a.shop_name_en,'') AS shop_name_en,
             coalesce(a.product_category,'') AS product_category, coalesce(a.sales_channel_url,'') AS sales_channel_url
        FROM onb_applications a
       WHERE a.brand_id=$1 ORDER BY a.updated_at DESC NULLS LAST LIMIT 1`, [brandId]);

  if (app) {
    push("온보딩 신청서 · 회사",
      [app.company_name_kr && `회사명(한글): ${app.company_name_kr}`,
       app.company_name_en && `회사명(영문): ${app.company_name_en}`,
       app.company_country && `등록 국가: ${app.company_country}`,
       app.company_reg_date && `법인 등록일: ${app.company_reg_date}`,
       app.shop_name_kr && `브랜드명(한글): ${app.shop_name_kr}`,
       app.shop_name_en && `브랜드명(영문): ${app.shop_name_en}`,
       app.product_category && `제품 카테고리: ${app.product_category}`,
       app.sales_channel_url && `한국 판매 채널: ${app.sales_channel_url}`,
      ].filter(Boolean).join(" / "));

    const products = await query<{ name: string; category: string; description_kr: string }>(
      `SELECT coalesce(name,'') AS name, coalesce(category,'') AS category, coalesce(description_kr,'') AS description_kr
         FROM onb_products WHERE application_id=$1 ORDER BY created_at LIMIT 12`, [app.id]);
    for (const p of products) {
      push(`신청서 제품 · ${p.name || "(이름 없음)"}`,
        [p.name && `제품명: ${p.name}`, p.category && `카테고리: ${p.category}`,
         p.description_kr && `설명: ${p.description_kr}`].filter(Boolean).join(" / "));
    }

    const countries = await query<{
      country_code: string; shop_type: string; monthly_revenue: string;
      product_cert_status: string; product_cert_note: string;
      logistics_status: string; logistics_note: string; logistics_option: string;
    }>(`SELECT country_code, coalesce(shop_type,'') AS shop_type, coalesce(monthly_revenue,'') AS monthly_revenue,
               coalesce(product_cert_status,'') AS product_cert_status, coalesce(product_cert_note,'') AS product_cert_note,
               coalesce(logistics_status,'') AS logistics_status, coalesce(logistics_note,'') AS logistics_note,
               coalesce(logistics_option,'') AS logistics_option
          FROM onb_countries WHERE application_id=$1 ORDER BY country_code`, [app.id]);
    for (const c of countries) {
      push(`신청서 국가 준비 · ${c.country_code}`,
        [`대상 국가: ${c.country_code}`,
         c.shop_type && `현재 운영: ${c.shop_type}`,
         c.monthly_revenue && `기존 월 매출(브랜드 자기기재): ${c.monthly_revenue}`,
         c.product_cert_status && `제품 인증: ${READY_KO[c.product_cert_status] ?? c.product_cert_status}`,
         c.product_cert_note && `인증 메모: ${c.product_cert_note}`,
         c.logistics_status && `물류 준비: ${READY_KO[c.logistics_status] ?? c.logistics_status}`,
         c.logistics_option && `물류 방식: ${c.logistics_option}`,
         c.logistics_note && `물류 메모: ${c.logistics_note}`,
        ].filter(Boolean).join(" / "));
    }
  }

  // 마스터 제품(원장) — 신청서가 없는 브랜드도 대표 제품을 쓸 수 있게.
  const master = await query<{ name_kr: string; name_en: string; category: string; price_band: string }>(
    `SELECT coalesce(name_kr,'') AS name_kr, coalesce(name_en,'') AS name_en,
            coalesce(category,'') AS category, coalesce(price_band,'') AS price_band
       FROM products_master WHERE brand_id=$1 AND status='active' ORDER BY created_at LIMIT 12`, [brandId])
    .catch(() => []);
  for (const m of master) {
    push(`원장 제품 · ${m.name_kr || m.name_en || "(이름 없음)"}`,
      [m.name_kr && `제품명: ${m.name_kr}`, m.name_en && `영문명: ${m.name_en}`,
       m.category && `카테고리: ${m.category}`, m.price_band && `가격대: ${m.price_band}`].filter(Boolean).join(" / "));
  }

  const evidence = buildIntroEvidence(raw);

  // 회사자료 첨부 — PDF·이미지는 모델이 그대로 읽는다. 나머지는 읽지 못했다고 알린다.
  const attachments: IntroAttachment[] = [];
  const skipped: string[] = [];
  if (app) {
    const files = await query<{ id: string; filename: string; mime: string; size: number }>(
      `SELECT id, coalesce(filename,'') AS filename, coalesce(mime,'') AS mime, size
         FROM onb_files
        WHERE application_id=$1 AND field='company_docs' AND removed_at IS NULL
        ORDER BY created_at DESC`, [app.id])
      .catch(() => query<{ id: string; filename: string; mime: string; size: number }>(
        `SELECT id, coalesce(filename,'') AS filename, coalesce(mime,'') AS mime, size
           FROM onb_files WHERE application_id=$1 AND field='company_docs' ORDER BY created_at DESC`, [app.id])
        .catch(() => []));

    let total = 0;
    let n = evidence.length;
    for (const f of files) {
      const readable = AI_DOC_MIME.has(f.mime) || AI_IMG_MIME.has(f.mime);
      if (!readable) { skipped.push(`${f.filename} (형식 ${f.mime || "불명"} — AI 가 읽을 수 없음)`); continue; }
      if (attachments.length >= INTRO_DOC_COUNT) { skipped.push(`${f.filename} (첨부 ${INTRO_DOC_COUNT}개 한도 초과)`); continue; }
      if (f.size > INTRO_DOC_BYTES || total + f.size > INTRO_DOC_TOTAL_BYTES) {
        skipped.push(`${f.filename} (용량 한도 초과)`); continue;
      }
      const full = await queryOne<{ bytes: Buffer }>("SELECT bytes FROM onb_files WHERE id=$1", [f.id]).catch(() => null);
      if (!full?.bytes) { skipped.push(`${f.filename} (파일을 읽지 못함)`); continue; }
      total += full.bytes.length;
      n += 1;
      const ref = `e${n}`;
      attachments.push({ ref, filename: f.filename, mime: f.mime, bytes: full.bytes });
      evidence.push({ ref, label: `회사자료 · ${f.filename}`, text: `첨부 파일 ${f.filename}` });
    }
  }

  return { brandName: brand.brand_name, evidence, attachments, skipped };
}

// ── 생성 ───────────────────────────────────────────────────

export interface GenerateResult {
  ok: boolean;
  error?: string;
  mode?: "ai" | "rules";
  note?: string;
  token?: string;
  sections?: number;
  rejected?: number;
  skipped?: string[];
}

const newToken = () => randomBytes(16).toString("base64url");

/**
 * 대상 언어 소개자료 생성(재생성 포함). 브랜드 × 언어 1건을 갱신하므로 토큰·발행상태는 유지된다.
 *   AI 호출이 실패하면 저장은 하되 mode='rules' 로 적고 사유를 남긴다 — AI 라고 표시하지 않는다.
 */
export async function generateIntroDoc(input: { brandId: string; lang: IntroLang; by: string }): Promise<GenerateResult> {
  const schema = await getIntroSchemaState();
  if (!schema.ready) return { ok: false, error: schema.error };

  const facts = await collectIntroFacts(input.brandId);
  if (facts.evidence.length === 0) {
    return {
      ok: false,
      error: "소개자료를 만들 근거가 없습니다 — 브랜드 자료(회사 소개서)나 온보딩 신청서 내용이 먼저 필요합니다.",
    };
  }

  const ai = await aiIntro({ lang: input.lang, brandName: facts.brandName, evidence: facts.evidence, attachments: facts.attachments });

  const sections = ai.sections;
  const mode: "ai" | "rules" = ai.ok && sections.length > 0 ? "ai" : "rules";
  const note = [
    ai.note,
    facts.skipped.length ? `AI 가 읽지 못한 첨부 ${facts.skipped.length}건 — ${facts.skipped.join(" · ")}` : "",
    mode === "rules" ? "대상 언어 본문이 없습니다 — 발행 전 담당자 작성·검수가 필요합니다." : "",
  ].filter(Boolean).join("\n");

  const lang = INTRO_LANGS[input.lang];
  const title = ai.title || `${facts.brandName} · ${lang.market} 유통 제안`;
  const subtitle = ai.subtitle || "";

  const row = await queryOne<{ token: string }>(
    `INSERT INTO brand_intro_docs
       (brand_id, lang, token, brand_name, title, subtitle, sections, evidence, skipped_files, note,
        contact_email, mode, generated_by, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,now())
     ON CONFLICT (brand_id, lang) DO UPDATE SET
       brand_name=EXCLUDED.brand_name, title=EXCLUDED.title, subtitle=EXCLUDED.subtitle,
       sections=EXCLUDED.sections, evidence=EXCLUDED.evidence, skipped_files=EXCLUDED.skipped_files,
       note=EXCLUDED.note, mode=EXCLUDED.mode,
       -- 담당자가 바꿔 둔 유통 문의 주소는 보존한다(비어 있을 때만 기본값을 넣는다).
       contact_email=CASE WHEN coalesce(brand_intro_docs.contact_email,'')='' THEN EXCLUDED.contact_email
                          ELSE brand_intro_docs.contact_email END,
       generated_by=EXCLUDED.generated_by, generated_at=now(), updated_at=now()
     RETURNING token`,
    [input.brandId, input.lang, newToken(), facts.brandName, title, subtitle,
     JSON.stringify(sections), JSON.stringify(facts.evidence.map((e) => ({ ref: e.ref, label: e.label }))),
     JSON.stringify(facts.skipped), note, defaultIntroContact(), mode, input.by]);

  return {
    ok: true, mode, note, token: row?.token,
    sections: sections.length, rejected: ai.rejected, skipped: facts.skipped,
  };
}

interface AiIntroOutcome { ok: boolean; title: string; subtitle: string; sections: IntroSection[]; rejected: number; note: string }

/** 실제 AI 호출. 키가 없거나 실패하면 ok:false — 호출자는 mode='rules' 로 적는다. */
async function aiIntro(input: {
  lang: IntroLang; brandName: string; evidence: IntroEvidence[]; attachments: IntroAttachment[];
}): Promise<AiIntroOutcome> {
  const empty = { title: "", subtitle: "", sections: [] as IntroSection[], rejected: 0 };
  const { env } = await import("./env");
  if (!env.anthropicKey) {
    return { ok: false, ...empty, note: "AI 키(ANTHROPIC_API_KEY)가 없어 대상 언어 본문을 만들지 못했습니다." };
  }

  const lang = INTRO_LANGS[input.lang];
  try {
    const { aiClient, AI_MODEL } = await import("./ai");
    // 첨부(PDF·이미지)를 그대로 읽히되, 각 첨부 앞에 우리가 부여한 ref 를 붙여
    //   모델이 어느 파일을 근거로 삼았는지 지목할 수 있게 한다.
    const content: unknown[] = [];
    const text = input.evidence
      .filter((e) => !input.attachments.some((a) => a.ref === e.ref))
      .map((e) => `[ref=${e.ref}] (${e.label})\n${e.text}`)
      .join("\n\n---\n\n");
    content.push({
      type: "text",
      text: [
        `브랜드: ${input.brandName}`,
        `대상 언어: ${lang.name}`,
        `대상 시장: ${lang.market}`,
        "",
        "<자료>",
        text,
        "</자료>",
        "",
        "<시장노트>",
        MARKET_NOTES[input.lang],
        "</시장노트>",
      ].join("\n"),
    });
    for (const a of input.attachments) {
      content.push({ type: "text", text: `[ref=${a.ref}] 첨부 회사자료: ${a.filename}` });
      const data = a.bytes.toString("base64");
      if (a.mime === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
      } else {
        content.push({ type: "image", source: { type: "base64", media_type: a.mime, data } });
      }
    }
    content.push({ type: "text", text: "위 규칙대로 JSON 만 출력해라." });

    const resp = await aiClient().messages.create({
      model: AI_MODEL, max_tokens: 6000, system: SYSTEM_PROMPT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: "user", content: content as any }],
    });
    const out = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
    let parsed: unknown;
    try { parsed = JSON.parse(json); }
    catch { return { ok: false, ...empty, note: "AI 응답을 해석하지 못했습니다(JSON 아님)." }; }

    const v = validateIntro(parsed, input.evidence);
    if (v.sections.length === 0) {
      return { ok: false, ...empty, rejected: v.rejected, note: `AI 응답에서 근거를 가리킨 섹션이 없었습니다(검증 탈락 ${v.rejected}건).` };
    }
    return {
      ok: true, title: v.title, subtitle: v.subtitle, sections: v.sections, rejected: v.rejected,
      note: `AI 가 근거 ${input.evidence.length}건(첨부 ${input.attachments.length}건 포함)을 읽어 ${lang.label} 섹션 ${v.sections.length}개 작성${v.rejected ? ` · 근거 검증 실패 ${v.rejected}건 제외` : ""}`,
    };
  } catch (e) {
    return { ok: false, ...empty, note: `AI 호출 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}
