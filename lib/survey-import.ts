// 설문 CSV 이관 — 응답행(회사·담당자·이메일 + 문항들)을 브랜드에 매칭해 surveys.answers 로 저장.
//   · 매칭: 회사명(정규화) → 이메일 순. 사내 브랜드 원장(brands)·brand_company 기준.
//   · 멱등: 브랜드당 CSV 설문 1건(token=csvsurvey_<brandId>) — 재실행 시 answers 갱신.
import { query } from "./db";

// ── CSV 파서(따옴표·개행 포함 필드·이스케이프 "" 처리) ──
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, ""); // BOM 제거
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === ",") { row.push(cur); cur = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** 특정 브랜드에 설문 응답 저장(수동 배정용). token=csvsurvey_<brandId> 로 멱등. */
export async function saveSurveyAnswers(brandId: string, answers: Record<string, string>): Promise<void> {
  await query(
    `INSERT INTO surveys (brand_id, kind, token, answers, sent_at, responded_at)
     VALUES ($1,'marketing_survey',$2,$3,now(),now())
     ON CONFLICT (token) DO UPDATE SET answers=EXCLUDED.answers, responded_at=now()`,
    [brandId, `csvsurvey_${brandId}`, JSON.stringify(answers ?? {})],
  );
}

/** 브랜드 선택 목록(수동 배정 드롭다운용). */
export async function listBrandOptions(): Promise<{ id: string; name: string }[]> {
  return query<{ id: string; name: string }>(
    "SELECT id, brand_name AS name FROM brands WHERE state NOT IN ('dropped','churned') ORDER BY brand_name",
  ).catch(() => []);
}

// 회사명 정규화 — 괄호 병기(영문) 제거 → 법인격 제거 → 공백·기호 제거 후 소문자.
function normCo(v: string): string {
  return (v || "")
    .replace(/[([<{][^)\]>}]*[)\]>}]/g, " ")   // (Medi N Research)·[...] 등 병기 제거((주)도 제거됨)
    .toLowerCase()
    .replace(/㈜|주식회사|유한회사|inc\.?|co\.?,?\s*ltd\.?|ltd\.?|corp\.?/gi, "")
    .replace(/[\s.,\-_()·&]/g, "")
    .trim();
}
const normEmail = (v: string): string => (v || "").trim().toLowerCase();

export interface SurveyImportReport {
  dryRun: boolean;
  total: number;
  matched: { company: string; brand: string; by: string; answers: number }[];
  unmatched: { company: string; email: string; candidates: string[]; answers: Record<string, string> }[];
  errors: { company: string; error: string }[];
}

interface BrandRef { id: string; brand_name: string; email: string | null }

/** CSV 텍스트를 파싱해 브랜드에 설문을 매칭·저장. dryRun 이면 매칭만. */
export async function importSurveyCsv(csvText: string, opts: { dryRun: boolean }): Promise<SurveyImportReport> {
  const report: SurveyImportReport = { dryRun: opts.dryRun, total: 0, matched: [], unmatched: [], errors: [] };
  const rows = parseCsv(csvText);
  if (rows.length < 2) return report;

  const header = rows[0].map((h) => h.trim());
  // 앞 3열: 회사 · 담당자 · 이메일. 문항은 4열째부터(값 있는 헤더만).
  const qCols: { idx: number; label: string }[] = [];
  for (let i = 3; i < header.length; i++) if (header[i]) qCols.push({ idx: i, label: header[i] });

  // 매칭용 원장 로드(수백 건 — 메모리 매칭).
  interface CoRow { brand_id: string; company_name_kr: string | null; shop_name_kr: string | null; company_name_en: string | null; contact_email: string | null }
  const brands = await query<BrandRef>("SELECT id, brand_name, email FROM brands").catch(() => [] as BrandRef[]);
  const companies = await query<CoRow>(
    "SELECT brand_id, company_name_kr, shop_name_kr, company_name_en, contact_email FROM brand_company",
  ).catch(() => [] as CoRow[]);

  const byName = new Map<string, string>();   // normCo → brandId
  const byEmail = new Map<string, string>();  // email → brandId
  const nameList: { id: string; label: string; norm: string }[] = []; // 부분포함 매칭·후보 제시용
  const addName = (id: string, label: string) => {
    const n = normCo(label); if (!n) return;
    if (!byName.has(n)) byName.set(n, id);
    nameList.push({ id, label, norm: n });
  };
  for (const b of brands) {
    addName(b.id, b.brand_name);
    if (b.email) byEmail.set(normEmail(b.email), b.id);
  }
  for (const c of companies) {
    for (const nm of [c.company_name_kr, c.shop_name_kr, c.company_name_en]) if (nm) addName(c.brand_id, String(nm));
    if (c.contact_email) { const e = normEmail(c.contact_email); if (e && !byEmail.has(e)) byEmail.set(e, c.brand_id); }
  }

  // 부분포함 매칭: 한쪽 이름이 다른 쪽을 포함(3자 이상)하고 브랜드가 유일하면 매칭.
  function fuzzyName(cn: string): { id?: string; candidates: string[] } {
    if (cn.length < 3) return { candidates: [] };
    const hits = nameList.filter((x) => x.norm.length >= 3 && (cn.includes(x.norm) || x.norm.includes(cn)));
    const ids = new Set(hits.map((h) => h.id));
    const candidates = Array.from(new Set(hits.map((h) => h.label))).slice(0, 3);
    return { id: ids.size === 1 ? hits[0].id : undefined, candidates };
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const company = (row[0] ?? "").trim();
    const contact = (row[1] ?? "").trim();
    const email = (row[2] ?? "").trim();
    if (!company && !email) continue;
    report.total++;

    // answers 구성(값 있는 문항만) + 응답자 정보 — 미매칭 수동배정에도 필요하므로 먼저 구성.
    const answers: Record<string, string> = {};
    if (contact) answers["응답자 담당자"] = contact;
    if (email) answers["응답자 이메일"] = email;
    for (const q of qCols) { const v = (row[q.idx] ?? "").trim(); if (v) answers[q.label] = v; }

    // 매칭: 회사명 완전일치 → 이메일(복수 "a@x / b@y" 각각) → 회사명 부분포함.
    const cn = normCo(company);
    let brandId = byName.get(cn) ?? "";
    let by = brandId ? `회사명 ${company}` : "";
    if (!brandId && email) {
      for (const tok of email.split(/[\s,;/]+/)) {
        const m = byEmail.get(normEmail(tok));
        if (m) { brandId = m; by = `이메일 ${tok}`; break; }
      }
    }
    let candidates: string[] = [];
    if (!brandId) {
      const fz = fuzzyName(cn);
      candidates = fz.candidates;
      if (fz.id) { brandId = fz.id; by = `회사명(부분일치) ${company}`; }
    }

    if (!brandId) { report.unmatched.push({ company, email, candidates, answers }); continue; }

    if (opts.dryRun) { report.matched.push({ company, brand: company, by, answers: Object.keys(answers).length }); continue; }

    try {
      const token = `csvsurvey_${brandId}`;
      await query(
        `INSERT INTO surveys (brand_id, kind, token, answers, sent_at, responded_at)
         VALUES ($1,'marketing_survey',$2,$3,now(),now())
         ON CONFLICT (token) DO UPDATE SET answers=EXCLUDED.answers, responded_at=now()`,
        [brandId, token, JSON.stringify(answers)],
      );
      report.matched.push({ company, brand: company, by, answers: Object.keys(answers).length });
    } catch (e) {
      report.errors.push({ company, error: (e as Error).message.slice(0, 140) });
    }
  }
  return report;
}
