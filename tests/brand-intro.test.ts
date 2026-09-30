// 해외 소개자료(영문/일문/태국어/베트남어/말레이시아어) — 검증·생성·발행 규칙.
//   DB·AI 를 모두 가짜로 둔다. 실제 외부 호출·발송은 없다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  INTRO_LANGS, INTRO_LANG_LIST, isIntroLang, MARKET_NOTES, SYSTEM_PROMPT,
  INTRO_SECTIONS, AI_SECTION_KEYS, INTRO_BODY_CHARS, INTRO_MAX_EVIDENCE, INTRO_TOTAL_CHARS,
  buildIntroEvidence, validateIntro, type IntroEvidence,
} from "../lib/intro-langs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── 가짜 DB ────────────────────────────────────────────────
interface DocRow {
  id: string; brand_id: string; lang: string; token: string; status: string; mode: string;
  brand_name: string; title: string; subtitle: string; sections: unknown[]; evidence: unknown[];
  skipped_files: unknown[]; note: string; contact_email: string; generated_by: string | null;
}
const db = {
  schema: true,
  brands: [] as { id: string; brand_name: string; brand_name_en: string; category: string; brand_url: string; countries: string[] }[],
  app: null as null | { id: string; brand_id: string; company_name_kr: string; company_name_en: string; company_country: string; shop_name_en: string; product_category: string; sales_channel_url: string },
  products: [] as { application_id: string; name: string; category: string; description_kr: string }[],
  countries: [] as { application_id: string; country_code: string; product_cert_status: string; logistics_status: string; logistics_option: string }[],
  files: [] as { id: string; application_id: string; filename: string; mime: string; size: number; bytes: Buffer }[],
  docs: [] as DocRow[],
  /** 모델에 실제로 보낸 메시지(첨부 블록 검증용). */
  lastAiContent: null as unknown[] | null,
  aiReply: "" as string,
  aiThrows: false,
  hasKey: true,
  seq: 0,
};

const B = "11111111-1111-4111-8111-111111111111";
const APP = "22222222-2222-4222-8222-222222222222";

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as (string | number | boolean | null)[];
    if (sql.includes("to_regclass('public.brand_intro_docs')")) return [{ reg: db.schema ? "brand_intro_docs" : null }];
    if (sql.includes("FROM brands WHERE id=$1")) {
      const b = db.brands.find((x) => x.id === a[0]);
      return b ? [{ ...b }] : [];
    }
    if (sql.includes("FROM onb_applications a")) {
      return db.app && db.app.brand_id === a[0]
        ? [{ ...db.app, company_reg_date: null, shop_name_kr: "" }] : [];
    }
    if (sql.includes("FROM onb_products WHERE application_id=$1")) {
      return db.products.filter((p) => p.application_id === a[0]).map((p) => ({ ...p }));
    }
    if (sql.includes("FROM onb_countries WHERE application_id=$1")) {
      return db.countries.filter((c) => c.application_id === a[0])
        .map((c) => ({ ...c, shop_type: "", monthly_revenue: "", product_cert_note: "", logistics_note: "" }));
    }
    if (sql.includes("FROM products_master WHERE brand_id=$1")) return [];
    if (sql.includes("FROM onb_files") && sql.includes("company_docs")) {
      return db.files.filter((f) => f.application_id === a[0])
        .map((f) => ({ id: f.id, filename: f.filename, mime: f.mime, size: f.size }));
    }
    if (sql.includes("SELECT bytes FROM onb_files WHERE id=$1")) {
      const f = db.files.find((x) => x.id === a[0]);
      return f ? [{ bytes: f.bytes }] : [];
    }
    if (sql.includes("INSERT INTO brand_intro_docs")) {
      const [brand_id, lang, token, brand_name, title, subtitle, sections, evidence, skipped, note, contact, mode, by] = a;
      const existing = db.docs.find((d) => d.brand_id === brand_id && d.lang === lang);
      const row: DocRow = {
        id: existing?.id ?? `d${++db.seq}`,
        brand_id: String(brand_id), lang: String(lang),
        token: existing?.token ?? String(token),                 // 재생성해도 링크 유지
        status: existing?.status ?? "draft",                      // 발행 상태 유지
        mode: String(mode), brand_name: String(brand_name), title: String(title), subtitle: String(subtitle),
        sections: JSON.parse(String(sections)), evidence: JSON.parse(String(evidence)),
        skipped_files: JSON.parse(String(skipped)), note: String(note),
        // 담당자가 바꿔 둔 주소는 보존(SQL 의 CASE 와 같은 규칙)
        contact_email: existing && existing.contact_email ? existing.contact_email : String(contact),
        generated_by: by == null ? null : String(by),
      };
      if (existing) Object.assign(existing, row); else db.docs.push(row);
      return [{ token: row.token }];
    }
    if (sql.includes("jsonb_array_length(sections)")) {
      const d = db.docs.find((x) => x.brand_id === a[0] && x.lang === a[1]);
      return d ? [{ n: d.sections.length }] : [];
    }
    if (sql.includes("UPDATE brand_intro_docs SET status=")) {
      const d = db.docs.find((x) => x.brand_id === a[0] && x.lang === a[1]);
      if (!d) return [];
      d.status = String(a[2]); return [{ id: d.id }];
    }
    if (sql.includes("UPDATE brand_intro_docs SET contact_email=")) {
      const d = db.docs.find((x) => x.brand_id === a[0] && x.lang === a[1]);
      if (!d) return [];
      d.contact_email = String(a[2]); return [{ id: d.id }];
    }
    if (sql.includes("FROM brand_intro_docs WHERE brand_id=$1")) {
      return db.docs.filter((d) => d.brand_id === a[0]).map((d) => ({ ...d, generated_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" }));
    }
    if (sql.includes("FROM brand_intro_docs WHERE token=$1")) {
      const d = db.docs.find((x) => x.token === a[0]);
      return d ? [{ ...d, generated_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" }] : [];
    }
    return [];
  };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
  };
});

vi.mock("../lib/env", () => ({
  env: { get anthropicKey() { return db.hasKey ? "test-key" : ""; }, anthropicModel: "test-model" },
}));

vi.mock("../lib/ai", () => ({
  AI_MODEL: "test-model",
  aiClient: () => ({
    messages: {
      create: async (req: { messages: { content: unknown[] }[] }) => {
        db.lastAiContent = req.messages[0].content;
        if (db.aiThrows) throw new Error("모의 호출 실패");
        return { content: [{ type: "text", text: db.aiReply }] };
      },
    },
  }),
}));

const { generateIntroDoc, setIntroStatus, setIntroContact, listIntroDocs, getIntroByToken, defaultIntroContact } =
  await import("../lib/brand-intro");

// env 로 덮어쓰지 않은 상태의 기본값을 검사한다.
delete process.env.GLOVEK_PARTNER_EMAIL;

function seed() {
  db.schema = true; db.hasKey = true; db.aiThrows = false; db.lastAiContent = null; db.seq = 0;
  db.docs = []; db.files = []; db.products = []; db.countries = [];
  db.brands = [{ id: B, brand_name: "테스트브랜드", brand_name_en: "TestBrand", category: "화장품", brand_url: "https://smartstore.example/x", countries: ["TH"] }];
  db.app = { id: APP, brand_id: B, company_name_kr: "테스트주식회사", company_name_en: "Test Co., Ltd.", company_country: "KR", shop_name_en: "TestBrand", product_category: "Beauty", sales_channel_url: "https://smartstore.example/x" };
  db.products = [{ application_id: APP, name: "수분크림", category: "스킨케어", description_kr: "저자극 보습 크림" }];
  db.countries = [{ application_id: APP, country_code: "TH", product_cert_status: "preparing", logistics_status: "ready", logistics_option: "local_warehouse" }];
  db.aiReply = JSON.stringify({
    title: "TestBrand · Thailand Distribution",
    subtitle: "Korean skincare brand",
    market_heading: "ตลาดไทย",
    market_body: "แปลจากบันทึกตลาดของเรา",
    sections: [
      { key: "brand", heading: "แบรนด์", body: "เนื้อหาแบรนด์", refs: ["e1"] },
      { key: "products", heading: "สินค้า", body: "ครีมบำรุง", refs: ["e3"] },
      { key: "distribution", heading: "การจัดจำหน่าย", body: "พร้อมด้านโลจิสติกส์", refs: ["e4"] },
    ],
  });
}
beforeEach(seed);

// ── 언어·시장 정의 ─────────────────────────────────────────
describe("언어 정의", () => {
  it("요청한 5개 언어가 모두 있다", () => {
    expect(INTRO_LANG_LIST).toEqual(["en", "ja", "th", "vi", "ms"]);
    for (const l of INTRO_LANG_LIST) {
      expect(INTRO_LANGS[l].label).toBeTruthy();
      expect(INTRO_LANGS[l].name).toBeTruthy();
      expect(INTRO_LANGS[l].market).toBeTruthy();
    }
  });
  it("지원하지 않는 언어는 거부한다", () => {
    expect(isIntroLang("en")).toBe(true);
    expect(isIntroLang("zh")).toBe(false);
    expect(isIntroLang("")).toBe(false);
  });
  it("시장 노트에 근거 없는 수치를 넣지 않는다", () => {
    for (const l of INTRO_LANG_LIST) {
      expect(MARKET_NOTES[l].length).toBeGreaterThan(40);
      // 점유율·순위·금액 같은 숫자 주장을 코드로 막는다(출처 없는 통계 금지).
      expect(MARKET_NOTES[l], l).not.toMatch(/\d/);
    }
  });
  it("문서 섹션에 요청한 어필 항목이 모두 들어 있다", () => {
    const keys = INTRO_SECTIONS.map((s) => s.key);
    expect(keys).toContain("market");        // 국가별 특징
    expect(keys).toContain("fit");           // 브랜드 가능성
    expect(keys).toContain("korea");         // 한국 인지도
    expect(keys).toContain("tech");          // 기술력
    expect(keys).toContain("distribution");  // 유통 가능성
    // 시장 섹션만 우리 노트 번역이고 나머지는 모델이 근거로 쓴다.
    expect(AI_SECTION_KEYS).not.toContain("market");
  });
  it("프롬프트가 지시 실행·창작을 금지한다", () => {
    expect(SYSTEM_PROMPT).toContain("비신뢰 입력");
    expect(SYSTEM_PROMPT).toContain("실행하지");
    expect(SYSTEM_PROMPT).toMatch(/만들지 않는다/);
  });
});

// ── 응답 검증 ──────────────────────────────────────────────
describe("AI 응답 검증", () => {
  const ev: IntroEvidence[] = [
    { ref: "e1", label: "브랜드", text: "a" },
    { ref: "e2", label: "제품", text: "b" },
  ];

  it("근거를 가리키지 않은 섹션은 버린다", () => {
    const v = validateIntro({ sections: [{ key: "brand", heading: "H", body: "본문", refs: [] }] }, ev);
    expect(v.sections).toEqual([]);
    expect(v.rejected).toBe(1);
  });
  it("우리가 보내지 않은 근거 ref 는 통하지 않는다", () => {
    const v = validateIntro({ sections: [{ key: "brand", body: "본문", refs: ["e9"] }] }, ev);
    expect(v.sections).toEqual([]);
    expect(v.rejected).toBe(1);
  });
  it("허용되지 않은 섹션 키는 버린다", () => {
    const v = validateIntro({ sections: [{ key: "pricing", body: "가격", refs: ["e1"] }] }, ev);
    expect(v.sections).toEqual([]);
  });
  it("본문 없는 섹션은 버린다", () => {
    const v = validateIntro({ sections: [{ key: "brand", body: "   ", refs: ["e1"] }] }, ev);
    expect(v.sections).toEqual([]);
  });
  it("같은 섹션이 두 번 오면 하나만 남는다", () => {
    const v = validateIntro({ sections: [
      { key: "brand", body: "첫째", refs: ["e1"] },
      { key: "brand", body: "둘째", refs: ["e2"] },
    ] }, ev);
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0].body).toBe("첫째");
    expect(v.rejected).toBe(1);
  });
  it("시장 섹션은 우리 노트 번역이라 근거 없이 통과하되 본문은 있어야 한다", () => {
    const ok = validateIntro({ market_heading: "M", market_body: "번역문" }, ev);
    expect(ok.sections.map((s) => s.key)).toEqual(["market"]);
    expect(ok.sections[0].refs).toEqual([]);
    const no = validateIntro({ market_body: "" }, ev);
    expect(no.sections).toEqual([]);
  });
  it("정의된 순서대로 정렬한다", () => {
    const v = validateIntro({ sections: [
      { key: "distribution", body: "d", refs: ["e1"] },
      { key: "brand", body: "b", refs: ["e1"] },
    ], market_body: "m" }, ev);
    expect(v.sections.map((s) => s.key)).toEqual(["brand", "market", "distribution"]);
  });
  it("본문 길이를 잘라 저장 폭주를 막는다", () => {
    const v = validateIntro({ sections: [{ key: "brand", body: "가".repeat(INTRO_BODY_CHARS + 500), refs: ["e1"] }] }, ev);
    expect(v.sections[0].body.length).toBe(INTRO_BODY_CHARS);
  });
  it("깨진 응답에도 예외를 던지지 않는다", () => {
    expect(validateIntro(null, ev).sections).toEqual([]);
    expect(validateIntro({ sections: "nope" }, ev).sections).toEqual([]);
  });
});

describe("근거 묶기", () => {
  it("빈 항목은 빼고 ref 를 순서대로 붙인다", () => {
    const out = buildIntroEvidence([{ label: "a", text: "A" }, { label: "b", text: "  " }, { label: "c", text: "C" }]);
    expect(out.map((e) => e.ref)).toEqual(["e1", "e2"]);
    expect(out.map((e) => e.label)).toEqual(["a", "c"]);
  });
  it("건수·총량 상한을 지킨다", () => {
    const many = Array.from({ length: INTRO_MAX_EVIDENCE + 10 }, (_, i) => ({ label: `l${i}`, text: "x".repeat(100) }));
    const out = buildIntroEvidence(many);
    expect(out.length).toBeLessThanOrEqual(INTRO_MAX_EVIDENCE);
    expect(out.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(INTRO_TOTAL_CHARS);
  });
});

// ── 생성 흐름 ──────────────────────────────────────────────
describe("생성", () => {
  it("0102 미적용이면 만들지 않고 사유를 알려준다", async () => {
    db.schema = false;
    const r = await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("0102");
  });

  it("근거가 없으면 빈 문서를 만들지 않는다", async () => {
    db.app = null; db.products = []; db.countries = [];
    db.brands = [{ id: B, brand_name: "", brand_name_en: "", category: "", brand_url: "", countries: [] }];
    const r = await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("근거가 없습니다");
    expect(db.docs).toHaveLength(0);
  });

  it("AI 가 실제로 쓰면 mode=ai 로 저장한다", async () => {
    const r = await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("ai");
    expect(r.sections).toBeGreaterThan(0);
    const d = db.docs[0];
    expect(d.mode).toBe("ai");
    expect((d.sections as { key: string }[]).map((s) => s.key)).toContain("market");
  });

  it("AI 키가 없으면 AI 라고 적지 않고 사유를 남긴다", async () => {
    db.hasKey = false;
    const r = await generateIntroDoc({ brandId: B, lang: "en", by: "u1" });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("rules");
    expect(r.note).toContain("ANTHROPIC_API_KEY");
    expect(db.docs[0].mode).toBe("rules");
    expect(db.docs[0].sections).toEqual([]);
  });

  it("AI 호출이 실패해도 성공으로 숨기지 않는다", async () => {
    db.aiThrows = true;
    const r = await generateIntroDoc({ brandId: B, lang: "ja", by: "u1" });
    expect(r.mode).toBe("rules");
    expect(r.note).toContain("AI 호출 실패");
  });

  it("근거 없는 응답만 오면 mode=rules 이고 탈락 건수를 알린다", async () => {
    db.aiReply = JSON.stringify({ sections: [{ key: "brand", body: "근거 없는 문단", refs: [] }] });
    const r = await generateIntroDoc({ brandId: B, lang: "vi", by: "u1" });
    expect(r.mode).toBe("rules");
    expect(r.note).toContain("근거");
  });

  it("다시 생성해도 링크·발행상태·담당자가 바꾼 문의 메일은 유지된다", async () => {
    await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    const token = db.docs[0].token;
    await setIntroContact(B, "th", "partner@example.com");
    await setIntroStatus(B, "th", "published");

    await generateIntroDoc({ brandId: B, lang: "th", by: "u2" });
    expect(db.docs).toHaveLength(1);
    expect(db.docs[0].token).toBe(token);
    expect(db.docs[0].status).toBe("published");
    expect(db.docs[0].contact_email).toBe("partner@example.com");
  });

  it("유통 문의 기본값이 글로브K 해외유통 주소다", () => {
    expect(defaultIntroContact()).toBe("dino_glovek@glovek.space");
  });
});

describe("첨부 처리", () => {
  it("PDF 는 모델에 그대로 넘기고, 읽을 수 없는 형식은 이유와 함께 알린다", async () => {
    db.files = [
      { id: "f1", application_id: APP, filename: "소개서.pdf", mime: "application/pdf", size: 1000, bytes: Buffer.from("%PDF-1.4 x") },
      { id: "f2", application_id: APP, filename: "deck.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 2000, bytes: Buffer.from("PK") },
    ];
    const r = await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    expect(r.ok).toBe(true);
    expect(r.skipped?.join(" ")).toContain("deck.pptx");
    expect(r.note).toContain("읽지 못한 첨부");

    const blocks = (db.lastAiContent ?? []) as { type: string; source?: { media_type?: string } }[];
    expect(blocks.some((b) => b.type === "document" && b.source?.media_type === "application/pdf")).toBe(true);
    // 첨부에도 ref 가 붙어 모델이 어느 파일을 근거로 삼았는지 가리킬 수 있다.
    expect(blocks.some((b) => b.type === "text" && /\[ref=e\d+\] 첨부/.test(String((b as unknown as { text: string }).text)))).toBe(true);
  });

  it("용량이 큰 첨부는 보내지 않고 사유를 남긴다", async () => {
    db.files = [{ id: "f9", application_id: APP, filename: "큰파일.pdf", mime: "application/pdf", size: 40 * 1024 * 1024, bytes: Buffer.alloc(10) }];
    const r = await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    expect(r.skipped?.join(" ")).toContain("용량 한도 초과");
  });
});

describe("개인정보·내부 추정 차단", () => {
  it("근거에 담당자 연락처·서류 URL·내부 분석 메모를 넣지 않는다", () => {
    const src = read("../lib/brand-intro.ts");
    for (const bad of ["contact_email", "contact_phone", "contact_name", "rep_passport", "rep_id_front",
                       "ubo_signature", "payoneer", "deep_analysis_md", "brief_md", "access_code"]) {
      // contact_email 은 '유통 문의(우리 메일)' 컬럼으로만 쓰이고 신청서에서 읽지 않는다.
      const inSelect = new RegExp(`a\\.${bad}`).test(src) || new RegExp(`coalesce\\(a\\.${bad}`).test(src);
      expect(inSelect, bad).toBe(false);
    }
  });
});

describe("발행", () => {
  it("본문 없는 문서는 발행할 수 없다", async () => {
    db.hasKey = false;
    await generateIntroDoc({ brandId: B, lang: "en", by: "u1" });
    const r = await setIntroStatus(B, "en", "published");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("본문이 없어");
    expect(db.docs[0].status).toBe("draft");
  });
  it("없는 언어 문서는 상태를 바꿀 수 없다", async () => {
    const r = await setIntroStatus(B, "ms", "published");
    expect(r.ok).toBe(false);
  });
  it("발행·발행취소가 왕복한다", async () => {
    await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    expect((await setIntroStatus(B, "th", "published")).ok).toBe(true);
    expect(db.docs[0].status).toBe("published");
    expect((await setIntroStatus(B, "th", "draft")).ok).toBe(true);
    expect(db.docs[0].status).toBe("draft");
  });
  it("문의 메일은 형식을 검사한다", async () => {
    await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    expect((await setIntroContact(B, "th", "not-an-email")).ok).toBe(false);
    expect((await setIntroContact(B, "th", "ok@glovek.space")).ok).toBe(true);
  });
  it("토큰으로 문서를 찾을 수 있고 다른 브랜드 문서는 섞이지 않는다", async () => {
    await generateIntroDoc({ brandId: B, lang: "th", by: "u1" });
    const d = await getIntroByToken(db.docs[0].token);
    expect(d?.brand_id).toBe(B);
    expect(await getIntroByToken("없는토큰")).toBeNull();
    const list = await listIntroDocs(B);
    expect(list.every((x) => x.brand_id === B)).toBe(true);
  });
});

// ── 배선 감사 ──────────────────────────────────────────────
describe("배선", () => {
  it("0102 마이그레이션은 추가만 한다", () => {
    const sql = read("../migrations/0102_brand_intro_docs.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS brand_intro_docs");
    expect(sql).toContain("brand_intro_docs_brand_lang_uniq");
    // ON DELETE CASCADE(참조 정의)는 허용 — 기존 데이터를 지우는 문장이 없어야 한다.
    expect(sql.replace(/ON DELETE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  });
  it("모든 서버액션이 브랜드 권한 가드를 지난다", () => {
    const src = read("../app/(dash)/brand/[id]/intro-actions.ts");
    const actions = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThanOrEqual(4);
    // 각 액션 본문이 brandAccess 로 시작하는지 확인
    for (const name of actions) {
      const body = src.slice(src.indexOf(`export async function ${name}`));
      expect(body.slice(0, 600), name).toContain("brandAccess(brandId)");
    }
    // 액션은 액세스가 돌려준 brandId 로만 조회한다(호출자가 준 값 그대로 쓰지 않기).
    expect(src).toContain("a.access.brandId");
  });
  it("공개 페이지는 발행된 문서만 열고 초안은 관리자만 미리본다", () => {
    const page = read("../app/intro/[token]/page.tsx");
    expect(page).toContain('d.status !== "published"');
    expect(page).toContain("currentUser()");
    expect(page).toContain("index: false");
  });
  it("공개 링크가 로그인 리다이렉트에 걸리지 않는다", () => {
    const mw = read("../middleware.ts");
    expect(mw.match(/pathname\.startsWith\("\/intro\/"\)/g)?.length).toBe(2);
  });
  it("브랜드360 에 탭이 붙어 있다", () => {
    const page = read("../app/(dash)/brand/[id]/page.tsx");
    expect(page).toContain("BrandIntroPanel");
    expect(page).toContain("해외 소개자료");
  });
  it("패널은 발행 전 확인을 받고 고객 발송 기능을 두지 않는다", () => {
    const panel = read("../components/BrandIntroPanel.tsx");
    expect(panel).toContain("confirm(");
    expect(panel).not.toMatch(/sendEmail|sendSms|sendMail/);
  });
});
