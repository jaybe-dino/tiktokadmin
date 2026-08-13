"use client";

// v3.1 회사정보 탭 — AI 심층 분석 + 사업자/세금계산서/정산 계좌/브랜드 정보 카드.
// brand_company(0007)·brands 실데이터. 편집: saveCompanyAction / updateBrandAction / setCountriesAction.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveCompanyAction, setCountriesAction, updateBrandAction } from "@/app/actions";
import { deepAnalysisAction } from "@/app/(dash)/brand360/actions";
import type { Brand } from "@/lib/types";
import type { Asset, BrandCompany } from "@/lib/repo/card";
import { kstDateTime } from "@/lib/time";

const D = (v: string | null | undefined): string => (v && v.trim() ? v : "—");

export default function Brand360Company({ brand, company, assets, categories = [] }: {
  brand: Brand; company: BrandCompany | null; assets: Asset[]; categories?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<"biz" | "tax" | "bank" | "brand" | null>(null);
  const [msg, setMsg] = useState("");
  // 저장 직후 즉시 반영(낙관적) — 저장에 성공한 값만 얹으므로 항상 실제 저장값과 일치.
  //   router.refresh() 로 새 prop 이 와도 같은 값이라 무해(자기치유).
  const [ov, setOv] = useState<Partial<Brand>>({});
  const [cov, setCov] = useState<Record<string, unknown>>({});
  const bv = { ...brand, ...ov } as Brand;
  const cv = { ...(company ?? {}), ...cov } as BrandCompany;
  // 저장된 심층분석을 초기값으로 — 재실행 없이 열람.
  const savedMd = (brand as Brand & { deep_analysis_md?: string | null }).deep_analysis_md ?? null;
  const savedAt = (brand as Brand & { deep_analysis_at?: string | null }).deep_analysis_at ?? null;
  const savedSrc = (brand as Brand & { deep_analysis_src?: string | null }).deep_analysis_src ?? null;
  const [aiMd, setAiMd] = useState<string | null>(savedMd);
  const [aiErr, setAiErr] = useState("");
  const [fetched, setFetched] = useState<string[]>(savedSrc ? savedSrc.split(", ").filter(Boolean) : []);

  function saveCompany(patch: Record<string, unknown>) {
    start(async () => {
      const r = await saveCompanyAction(bv.id, patch);
      setMsg(r.ok ? "저장됨" : r.error ?? "실패");
      if (r.ok) { setCov((p) => ({ ...p, ...patch })); setEdit(null); }
      router.refresh();
    });
  }

  const bizAsset = assets.find((a) => a.kind === "biz_cert");
  const bankAsset = assets.find((a) => a.kind === "bank_cert");
  const brandAssets = assets.filter((a) => a.kind === "logo" || a.kind === "brand_guide");
  const canAnalyze = Boolean(bv.biz_no) || Boolean(bv.brand_url);

  return (
    <div>
      {/* ── AI 기업·브랜드 심층 분석 ── */}
      <div className="card" style={{ marginBottom: 14, borderColor: "#e9d5ff" }}>
        <div className="hd" style={{ background: "linear-gradient(90deg,#faf5ff,#fff)", flexWrap: "wrap" }}>
          <b>🤖 AI 기업·브랜드 심층 분석</b>
          <span className={`chip ${canAnalyze ? "grn" : "amb"}`}>
            {canAnalyze
              ? `실행 가능 — 사업자번호 ${bv.biz_no ? "✓" : "✗"} · 자사몰 ${bv.brand_url ? "✓" : "✗"}`
              : "사업자번호·자사몰 URL 입력 후 실행 가능"}
          </span>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>공개 데이터 기반 추정 · 판단 참고용, 확정은 미팅에서 검증</span>
          <div className="rt">
            <button
              className="btn sm pri"
              disabled={pending || !canAnalyze}
              onClick={() =>
                start(async () => {
                  setAiErr("");
                  const r = await deepAnalysisAction(bv.id);
                  if (r.ok) { setAiMd(r.md ?? ""); setFetched(r.fetched ?? []); }
                  else setAiErr(r.error ?? "실패");
                })
              }
            >
              {pending ? "분석 중…" : savedMd ? "🔄 재분석" : "심층 분석 실행"}
            </button>
          </div>
        </div>
        <div className="bd">
          {aiMd ? (
            <>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.7, fontFamily: "inherit" }}>{aiMd}</pre>
              {(fetched.length > 0 || savedAt) && (
                <div className="note" style={{ marginTop: 8, fontSize: 11 }}>
                  {fetched.length > 0 && <>📄 근거 페이지: {fetched.join(" · ")} · </>}
                  {savedAt && <>생성 {kstDateTime(savedAt)}</>}
                </div>
              )}
            </>
          ) : (
            <p className="note">
              {aiErr || "아직 실행된 분석이 없습니다 — [심층 분석 실행]을 누르면 등록된 회사 웹사이트를 수집·학습하고, 브랜드·시그널·제품 실데이터와 합쳐 8개 층(회사개요·제품·포지셔닝·타깃·TikTok Shop 적합도·경쟁·리스크·추천액션) 심층 분석을 생성합니다."}
            </p>
          )}
          <div className="note" style={{ marginTop: 10 }}>
            이 분석은 영업 제안·견적 근거로 인용됩니다 — 수치가 미팅에서 확인되면 담당이 보정(보정값이 우선)
          </div>
        </div>
      </div>

      <div className="grid g3" style={{ gap: 14 }}>
        {/* ── 사업자 정보 ── */}
        <div className="card">
          <div className="hd">
            <b>사업자 정보</b>
            {cv.source && <span className="chip" style={{ fontSize: 10 }}>{cv.source} 동기 · 수기 보정 가능</span>}
            <div className="rt"><button className="btn sm" onClick={() => setEdit(edit === "biz" ? null : "biz")}>{edit === "biz" ? "닫기" : "정보 수정"}</button></div>
          </div>
          <div className="bd">
            {edit === "biz" ? (
              <form
                style={{ display: "grid", gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  saveCompany({
                    company_name_kr: String(f.get("company_name_kr") ?? ""),
                    company_name_en: String(f.get("company_name_en") ?? ""),
                    company_type: String(f.get("company_type") ?? ""),
                    rep_name: String(f.get("rep_name") ?? ""),
                    reg_date: String(f.get("reg_date") ?? "") || null,
                    biz_category: String(f.get("biz_category") ?? ""),
                    address_kr: String(f.get("address_kr") ?? ""),
                    address_en: String(f.get("address_en") ?? ""),
                  });
                }}
              >
                <input name="company_name_kr" className="f" defaultValue={cv.company_name_kr ?? ""} placeholder="상호 (국문)" />
                <input name="company_name_en" className="f" defaultValue={cv.company_name_en ?? ""} placeholder="상호 (영문)" />
                <select name="company_type" className="f" defaultValue={cv.company_type ?? ""}>
                  <option value="">구분</option>
                  <option value="법인 사업자">법인 사업자</option>
                  <option value="개인 사업자">개인 사업자</option>
                </select>
                <input name="rep_name" className="f" defaultValue={cv.rep_name ?? ""} placeholder="대표자" />
                <input name="reg_date" className="f" type="date" defaultValue={cv.reg_date?.slice(0, 10) ?? ""} />
                <input name="biz_category" className="f" defaultValue={cv.biz_category ?? ""} placeholder="업태·종목" />
                <input name="address_kr" className="f" defaultValue={cv.address_kr ?? ""} placeholder="주소 (국문)" />
                <input name="address_en" className="f" defaultValue={cv.address_en ?? ""} placeholder="주소 (영문)" />
                <button className="btn sm pri" disabled={pending} type="submit">저장</button>
              </form>
            ) : (
              <div className="kv">
                <dt>상호 (국문)</dt><dd>{D(cv.company_name_kr)}</dd>
                <dt>상호 (영문)</dt><dd>{D(cv.company_name_en)}</dd>
                <dt>구분</dt><dd>{D(cv.company_type)}</dd>
                <dt>대표자</dt><dd>{D(cv.rep_name)}</dd>
                <dt>사업자번호</dt>
                <dd>
                  {D(bv.biz_no)}{" "}
                  {bv.biz_no && (
                    <span className={`cellchip ${cv.biz_verified ? "cc-ok" : "cc-no"}`} style={{ fontSize: 10 }}>
                      {cv.biz_verified ? "진위확인 ✓" : "미확인"}
                    </span>
                  )}
                </dd>
                <dt>개업일</dt><dd>{cv.reg_date ? cv.reg_date.slice(0, 10) : "—"}</dd>
                <dt>업태·종목</dt><dd>{D(cv.biz_category)}</dd>
                <dt>주소 (국문)</dt><dd>{D(cv.address_kr)}</dd>
                <dt>주소 (영문)</dt><dd>{D(cv.address_en)}</dd>
              </div>
            )}
            <hr className="hr" />
            <div className="row" style={{ padding: "6px 0" }}>
              <span className="ico i-blu" style={{ background: "#dbeafe" }}>📄</span>
              <div>
                <div className="tt">사업자등록증</div>
                <div className="ss">{bizAsset ? `${bizAsset.filename} · 서류 체크리스트와 동기` : "미등록 — 자산 저장소에서 연결"}</div>
              </div>
              <div className="rt">
                {bizAsset?.external_url || bizAsset?.storage_url ? (
                  <a className="btn sm" href={bizAsset.external_url ?? bizAsset.storage_url ?? "#"} target="_blank">보기</a>
                ) : (
                  <Link className="btn sm" href="/assets">열기</Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 세금계산서 + 정산 계좌 ── */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd">
              <b>세금계산서 정보</b>
              <div className="rt"><button className="btn sm" onClick={() => setEdit(edit === "tax" ? null : "tax")}>{edit === "tax" ? "닫기" : "정보 수정"}</button></div>
            </div>
            <div className="bd">
              {edit === "tax" ? (
                <form
                  style={{ display: "grid", gap: 6 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    saveCompany({
                      tax_email: String(f.get("tax_email") ?? ""),
                      tax_contact_name: String(f.get("tax_contact_name") ?? ""),
                      tax_contact_phone: String(f.get("tax_contact_phone") ?? ""),
                      tax_cycle: String(f.get("tax_cycle") ?? ""),
                      tax_note: String(f.get("tax_note") ?? ""),
                    });
                  }}
                >
                  <input name="tax_email" className="f" defaultValue={cv.tax_email ?? ""} placeholder="발행 이메일" />
                  <input name="tax_contact_name" className="f" defaultValue={cv.tax_contact_name ?? ""} placeholder="세금 담당자" />
                  <input name="tax_contact_phone" className="f" defaultValue={cv.tax_contact_phone ?? ""} placeholder="담당자 연락처" />
                  <input name="tax_cycle" className="f" defaultValue={cv.tax_cycle ?? ""} placeholder="발행 조건 (예: 월말 일괄)" />
                  <input name="tax_note" className="f" defaultValue={cv.tax_note ?? ""} placeholder="특이사항" />
                  <button className="btn sm pri" disabled={pending} type="submit">저장</button>
                </form>
              ) : (
                <div className="kv">
                  <dt>발행 이메일</dt><dd>{D(cv.tax_email)}</dd>
                  <dt>세금 담당자</dt><dd>{[cv.tax_contact_name, cv.tax_contact_phone].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt>발행 조건</dt><dd>{D(cv.tax_cycle)}</dd>
                  <dt>특이사항</dt><dd>{D(cv.tax_note)}</dd>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <b>정산 계좌</b>
              <div className="rt"><button className="btn sm" onClick={() => setEdit(edit === "bank" ? null : "bank")}>{edit === "bank" ? "닫기" : "정보 수정"}</button></div>
            </div>
            <div className="bd">
              {edit === "bank" ? (
                <form
                  style={{ display: "grid", gap: 6 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    saveCompany({
                      bank_name: String(f.get("bank_name") ?? ""),
                      bank_holder: String(f.get("bank_holder") ?? ""),
                      bank_account: String(f.get("bank_account") ?? ""),
                    });
                  }}
                >
                  <input name="bank_name" className="f" defaultValue={cv.bank_name ?? ""} placeholder="은행" />
                  <input name="bank_holder" className="f" defaultValue={cv.bank_holder ?? ""} placeholder="예금주" />
                  <input name="bank_account" className="f" defaultValue={cv.bank_account ?? ""} placeholder="계좌번호" />
                  <button className="btn sm pri" disabled={pending} type="submit">저장</button>
                </form>
              ) : (
                <div className="kv">
                  <dt>은행</dt><dd>{D(cv.bank_name)}</dd>
                  <dt>예금주</dt><dd>{D(cv.bank_holder)}{cv.bank_verified && <span className="cellchip cc-ok" style={{ fontSize: 10, marginLeft: 4 }}>일치 확인 ✓</span>}</dd>
                  <dt>계좌번호</dt><dd>{D(cv.bank_account)}</dd>
                </div>
              )}
              <div className="row" style={{ padding: "8px 0 0", border: "none" }}>
                <span className="ico i-blu" style={{ background: "#dbeafe" }}>📄</span>
                <div>
                  <div className="tt">통장 사본</div>
                  <div className="ss">{bankAsset ? bankAsset.filename : "미등록"}</div>
                </div>
                {bankAsset && (bankAsset.external_url || bankAsset.storage_url) && (
                  <div className="rt"><a className="btn sm" href={bankAsset.external_url ?? bankAsset.storage_url ?? "#"} target="_blank">보기</a></div>
                )}
              </div>
              <div className="note" style={{ marginTop: 8 }}>정산 지급 전 예금주·상호 일치 검증 — 불일치 시 정산 확정 차단</div>
            </div>
          </div>
        </div>

        {/* ── 브랜드 정보 ── */}
        <div className="card">
          <div className="hd">
            <b>브랜드 정보</b>
            <div className="rt"><button className="btn sm" onClick={() => setEdit(edit === "brand" ? null : "brand")}>{edit === "brand" ? "닫기" : "정보 수정"}</button></div>
          </div>
          <div className="bd">
            {edit === "brand" ? (
              <form
                style={{ display: "grid", gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const countries = String(f.get("countries") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
                  const certified = String(f.get("certified") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
                  start(async () => {
                    const patch = {
                      brand_name: String(f.get("brand_name") ?? ""),
                      contact_name: String(f.get("contact_name") ?? "") || bv.contact_name,
                      email: String(f.get("email") ?? ""),
                      phone: String(f.get("phone") ?? ""),
                      biz_no: String(f.get("biz_no") ?? ""),
                      category: String(f.get("category") ?? ""),
                      brand_url: String(f.get("brand_url") ?? ""),
                      memo: String(f.get("memo") ?? ""),
                    };
                    const r1 = await updateBrandAction(bv.id, patch);
                    const r2 = await setCountriesAction(bv.id, countries, certified);
                    setMsg(r1.ok && r2.ok ? "저장됨" : r1.error || r2.error || "실패");
                    if (r1.ok && r2.ok) {
                      // 저장 성공값을 즉시 화면에 반영(빈 문자열은 표시상 그대로).
                      setOv((p) => ({ ...p, ...patch, countries, certified_countries: certified }));
                      setEdit(null);
                    }
                    router.refresh();
                  });
                }}
              >
                <input name="brand_name" className="f" defaultValue={bv.brand_name} placeholder="브랜드명 (국문)" />
                <select name="category" className="f" defaultValue={bv.category ?? ""}>
                  <option value="">카테고리 선택…</option>
                  {(categories.includes(bv.category) || !bv.category ? categories : [bv.category, ...categories]).map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <input name="brand_url" className="f" defaultValue={bv.brand_url} placeholder="대표 판매채널 URL" />
                <input name="contact_name" className="f" defaultValue={bv.contact_name} placeholder="담당자명" />
                <input name="email" className="f" defaultValue={bv.email ?? ""} placeholder="이메일" />
                <input name="phone" className="f" defaultValue={bv.phone ?? ""} placeholder="전화" />
                <input name="biz_no" className="f" defaultValue={bv.biz_no ?? ""} placeholder="사업자번호" />
                <input name="countries" className="f" defaultValue={bv.countries.join(", ")} placeholder="목표국 (콤마 구분)" />
                <input name="certified" className="f" defaultValue={bv.certified_countries.join(", ")} placeholder="인증국 (콤마 구분)" />
                <textarea name="memo" className="f" style={{ minHeight: 50 }} defaultValue={bv.memo} placeholder="메모" />
                <button className="btn sm pri" disabled={pending} type="submit">저장</button>
              </form>
            ) : (
              <>
                <div className="kv">
                  <dt>브랜드명 (국문)</dt><dd>{bv.brand_name}</dd>
                  <dt>브랜드명 (영문)</dt><dd>{D(cv.brand_name_en || bv.brand_name_en)}</dd>
                  <dt>카테고리</dt><dd>{D(bv.category)}</dd>
                  <dt>목표국</dt><dd>{bv.countries.length ? bv.countries.join(", ") : "미정"}</dd>
                  <dt>인증국</dt><dd>{bv.certified_countries.length ? bv.certified_countries.join(", ") : "—"}</dd>
                </div>
                <hr className="hr" />
                <b style={{ fontSize: 11.5, color: "var(--ink3)" }}>채널</b>
                <div className="kv" style={{ marginTop: 6 }}>
                  <dt>대표 채널</dt><dd>{D(bv.brand_url)}</dd>
                  {Object.entries(cv.channel_urls ?? {}).map(([k, v]) => (
                    <span key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></span>
                  ))}
                  <dt>연락처</dt><dd>{[bv.email, bv.phone].filter(Boolean).join(" · ") || "—"}</dd>
                </div>
              </>
            )}
            <hr className="hr" />
            <div className="row" style={{ padding: "6px 0" }}>
              <span className="ico" style={{ background: "#f3e8ff" }}>🎨</span>
              <div>
                <div className="tt">브랜드 자산 (로고·가이드)</div>
                <div className="ss">{brandAssets.length ? brandAssets.map((a) => a.filename).join(" · ") : "미등록"} — 자산 저장소</div>
              </div>
              <div className="rt"><Link className="btn sm" href="/assets">열기</Link></div>
            </div>
            <div className="note" style={{ marginTop: 8 }}>여기 정보가 카드 상단 헤더(카테고리·URL·사업자번호)와 제안서·계약서·정산의 원천이 됩니다</div>
          </div>
        </div>
      </div>
      {msg && <div className="note" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
