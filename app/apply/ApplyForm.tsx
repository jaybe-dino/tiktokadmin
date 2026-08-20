"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  saveStepAction, submitStepAction, saveCountriesAction, setCountryLogisticsAction, setCountryLogisticsOptionAction, setCountryLogisticsDetailAction,
  addProductAction, updateProductAction, deleteProductAction, upsertProductCountryAction,
} from "./actions";
import FdaListingExample from "@/components/FdaListingExample";

// ── 상수(tpartners 정합) ──
const COUNTRIES: [string, string][] = [["US", "미국"], ["TH", "태국"], ["VN", "베트남"], ["MY", "말레이시아"], ["SG", "싱가포르"], ["PH", "필리핀"]];
const COUNTRY_NAME = Object.fromEntries(COUNTRIES);
const READINESS: [string, string][] = [["none", "없음"], ["preparing", "준비중"], ["ready", "완료"]];
const CURRENCIES = ["USD", "KRW", "SGD", "THB", "VND", "MYR", "PHP"];
const LOGISTICS_OPTIONS: [string, string][] = [["", "선택 안 함"], ["fba", "FBA (아마존 물류)"], ["local_warehouse", "현지 물류창고 계약"], ["cross_border", "한국에서 크로스보더 배송"]];
const COMPANY_COUNTRIES: [string, string][] = [["KR", "대한민국"], ["US", "미국"], ["SG", "싱가포르"], ["JP", "일본"], ["CN", "중국"], ["HK", "홍콩"]];
const STEP_TITLES = ["기본신청", "수권서 서명", "회사 추가정보", "제품 등록", "물류 계약서"];

interface Step { step_no: number; status: string; admin_feedback: string }
interface Country { id: string; country_code: string; country_name: string; has_existing_shop: number; shop_type: string; shop_url: string; monthly_revenue: string; product_cert_status: string; product_cert_note: string; logistics_status: string; logistics_note: string; logistics_contract_url: string; logistics_option: string; logistics_local_address?: string; logistics_contract_info?: string }
interface ProductCountry { id: string; product_id: string; country_code: string; unit_price: string; currency: string; cert_status: string; cert_note: string; cert_file_url: string; detail_page_kr: string; translation_status: string }
interface Product { id: string; name: string; category: string; sku: string; description_kr: string; main_image_url: string }
interface Props { email: string; app: Record<string, unknown>; steps: Step[]; countries: Country[]; products: Product[]; productCountries: Record<string, ProductCountry[]> }

const sv = (app: Record<string, unknown>, k: string): string => (app[k] == null ? "" : String(app[k]));

export default function ApplyForm(props: Props) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const steps = props.steps.length ? props.steps : [1, 2, 3, 4, 5].map((n) => ({ step_no: n, status: [1, 2, 5].includes(n) ? "unlocked" : "locked", admin_feedback: "" }));
  const step = steps[active];
  const editable = step.status === "unlocked" || step.status === "rejected" || step.status === "draft";
  const locked = step.status === "locked";
  const submitted = step.status === "submitted";
  const approved = step.status === "approved";

  const [v, setV] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    ALL_FIELDS.forEach((f) => { init[f] = sv(props.app, f); });
    return init;
  });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  async function saveStep(stepNo: number, keys: string[], extra?: () => Promise<boolean>) {
    setBusy(true);
    const payload: Record<string, string> = {};
    keys.forEach((k) => { payload[k] = v[k] ?? ""; });
    const r = await saveStepAction(stepNo, payload);
    let ok = r.ok;
    if (ok && extra) ok = await extra();
    setBusy(false);
    if (ok) flash("저장되었습니다."); else flash(r.error ?? "저장 실패");
    return ok;
  }
  async function submit(stepNo: number, keys: string[], extra?: () => Promise<boolean>) {
    if (!confirm("제출하면 관리자 검토가 시작되며 이 단계는 수정할 수 없습니다. 제출할까요?")) return;
    const ok = await saveStep(stepNo, keys, extra);
    if (!ok) return;
    setBusy(true);
    const r = await submitStepAction(stepNo);
    setBusy(false);
    if (r.ok) { flash("제출되었습니다. 검토를 기다려주세요."); router.refresh(); }
    else flash(r.error ?? "제출 실패");
  }
  async function logout() { await fetch("/api/apply/logout", { method: "POST" }); router.replace("/apply/login"); router.refresh(); }

  return (
    <div style={{ paddingBottom: 60 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 4px 14px" }}>
        <span style={{ color: ACC, fontWeight: 800, fontSize: 15 }}>TikTok Shop 온보딩</span>
        <span style={{ color: "#8b93a1", fontSize: 13, marginLeft: "auto" }}>{props.email}</span>
        <button onClick={logout} style={{ background: "transparent", color: "#8b93a1", border: "1px solid #d5dae1", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>로그아웃</button>
      </header>

      {/* 스텝 탭 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
        {steps.map((s, i) => (
          <button key={s.step_no} onClick={() => s.status !== "locked" && setActive(i)} disabled={s.status === "locked"}
            style={{ flex: "1 1 150px", textAlign: "left", padding: "10px 12px", borderRadius: 12, cursor: s.status === "locked" ? "not-allowed" : "pointer",
              border: i === active ? `1.5px solid ${ACC}` : "1px solid #e2e6eb", background: i === active ? "#eafaf3" : "#fff", opacity: s.status === "locked" ? 0.6 : 1 }}>
            <div style={{ fontSize: 11, color: statusColor(s.status) }}>{statusIcon(s.status)} Step {i + 1} · {statusLabel(s.status)}</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: "#111" }}>{STEP_TITLES[i]}</div>
          </button>
        ))}
      </div>

      {step.status === "rejected" && step.admin_feedback && <Banner tone="warn">관리자 반려 사유: {step.admin_feedback}</Banner>}
      {locked && <Banner tone="mute">이전 단계가 승인되면 열립니다.</Banner>}
      {submitted && <Banner tone="info">⏳ 검토중 — 관리자가 확인하고 있습니다. (수정 불가)</Banner>}
      {approved && <Banner tone="ok">✅ 이 단계는 승인되었습니다.</Banner>}

      {!locked && (
        <>
          {active === 0 && <Step1 v={v} set={set} disabled={!editable} countries={props.countries} onChange={() => router.refresh()} />}
          {active === 1 && <Step2 v={v} set={set} app={props.app} disabled={!editable} />}
          {active === 2 && <Step3 v={v} set={set} disabled={!editable} />}
          {active === 3 && <Step4 disabled={!editable} countries={props.countries} products={props.products} productCountries={props.productCountries} onChange={() => router.refresh()} flash={flash} />}
          {active === 4 && <Step5 disabled={!editable} countries={props.countries} onChange={() => router.refresh()} flash={flash} />}

          {/* 제출 바 */}
          {editable && (
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); }} style={{ display: "none" }} />
              <button disabled={busy} onClick={() => onSaveOrSubmit(active, "save")} style={btnGray}>임시저장</button>
              <button disabled={busy} onClick={() => onSaveOrSubmit(active, "submit")} style={{ ...btnPri, marginLeft: "auto" }}>Step {active + 1} 제출 (검토 요청)</button>
            </div>
          )}
        </>
      )}

      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13, zIndex: 50 }}>{toast}</div>}
    </div>
  );

  function stepKeys(i: number): string[] { return STEP_KEYS[i]; }
  async function saveCountriesFromState(): Promise<boolean> {
    // Step1 국가 매트릭스 저장 — window 에 보관된 최신 rows 사용.
    const rows = (window as unknown as { __onbCountries?: Partial<Country>[] }).__onbCountries ?? props.countries;
    const r = await saveCountriesAction(rows); return r.ok;
  }
  function onSaveOrSubmit(i: number, mode: "save" | "submit") {
    const keys = stepKeys(i);
    const extra = i === 0 ? saveCountriesFromState : undefined;
    if (mode === "save") saveStep(i + 1, keys, extra); else submit(i + 1, keys, extra);
  }
}

// ══════════ Step 1 — 기본신청 ══════════
function Step1({ v, set, disabled, countries }: { v: Record<string, string>; set: (k: string, x: string) => void; disabled: boolean; countries: Country[]; onChange: () => void }) {
  // 국가 매트릭스 로컬 상태 — 저장 시 window 로 부모에 전달.
  const [rows, setRows] = useState<Record<string, Partial<Country>>>(() => {
    const m: Record<string, Partial<Country>> = {};
    countries.forEach((c) => { m[c.country_code] = c; });
    return m;
  });
  const [checked, setChecked] = useState<Set<string>>(() => new Set(countries.map((c) => c.country_code)));
  useEffect(() => {
    (window as unknown as { __onbCountries?: Partial<Country>[] }).__onbCountries =
      [...checked].map((code) => ({ ...(rows[code] ?? {}), country_code: code }));
  }, [rows, checked]);
  const upd = (code: string, patch: Partial<Country>) => setRows((p) => ({ ...p, [code]: { ...(p[code] ?? {}), ...patch } }));
  const toggle = (code: string) => setChecked((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="① 회사 정보">
        <Grid>
          <F label="회사명 (한글)" req k="company_name_kr" {...{ v, set, disabled }} />
          <F label="회사명 (영문)" req k="company_name_en" {...{ v, set, disabled }} />
          <Sel label="사업자 형태" k="company_type" opts={[["company", "Company (법인)"], ["individual", "Individual (개인사업자)"]]} {...{ v, set, disabled }} />
          <Sel label="등록 국가" k="company_country" opts={COMPANY_COUNTRIES.map(([c, n]) => [c, `${c} — ${n}`])} dflt="KR" {...{ v, set, disabled }} />
          <F label="법인 등록일" req type="date" k="company_reg_date" {...{ v, set, disabled }} />
          <F label="사업자등록번호" req k="company_reg_number" placeholder="예: 123-45-67890" {...{ v, set, disabled }} />
        </Grid>
      </Card>

      <Card title="② 담당자">
        <Grid cols={3}>
          <F label="담당자 이름" req k="contact_name" {...{ v, set, disabled }} />
          <F label="이메일" req type="email" k="contact_email" {...{ v, set, disabled }} />
          <F label="연락처" req k="contact_phone" placeholder="010-1234-5678" hint="※ 대표자 휴대폰으로 인증번호(1회)가 발송되어 별도 연락드릴 예정입니다." {...{ v, set, disabled }} />
        </Grid>
      </Card>

      <Card title="③ 회사 주소">
        <div style={{ display: "grid", gap: 10 }}>
          <F label="등록 주소 (한글)" req full k="address_kr" {...{ v, set, disabled }} />
          <F label="등록 주소 (영문)" req full k="address_en" {...{ v, set, disabled }} />
          <F label="운영 주소 (영문, 선택)" full k="op_address_en" {...{ v, set, disabled }} />
        </div>
      </Card>

      <Card title="④ 브랜드 & 대표자">
        <Grid>
          <F label="브랜드명 (한글)" req k="shop_name_kr" {...{ v, set, disabled }} />
          <F label="브랜드명 (영문)" req k="shop_name_en" {...{ v, set, disabled }} />
          <F label="제품 카테고리" req k="product_category" placeholder="예: Beauty & Personal Care" {...{ v, set, disabled }} />
          <F label="대표 판매 채널 링크" req full k="sales_channel_url" placeholder="예: https://smartstore.naver.com/yourbrand" hint="자사몰·스마트스토어·쿠팡 등 대표 판매 채널" {...{ v, set, disabled }} />
          <FileField label="브랜드 로고 (JPG/PNG, 2MB 이하)" req field="brand_logo" k="brand_logo_url" {...{ v, set, disabled }} />
          <div />
          <F label="대표자 성명 (영문)" req k="ubo_full_name" placeholder="예: Hong Gildong" hint="수권서(LOA)에 자동 삽입됩니다." {...{ v, set, disabled }} />
          <F label="직책" req k="ubo_title" placeholder="예: CEO" {...{ v, set, disabled }} />
        </Grid>
      </Card>

      <Card title="⑤ 증빙 서류">
        <div style={{ display: "grid", gap: 10 }}>
          <FileField label="사업자등록증 (영문)" req field="doc_biz_reg_en" k="doc_biz_reg_en_url" {...{ v, set, disabled }} />
          <FileField label="사업자등록증 (한글)" req field="doc_biz_reg_kr" k="doc_biz_reg_kr_url" {...{ v, set, disabled }} />
          <FileField label="법인등기부등본 (한글)" req field="doc_corp_reg_kr" k="doc_corp_reg_kr_url" {...{ v, set, disabled }} />
        </div>
      </Card>

      <Card title="⑥ 입점 희망 국가">
        <div style={{ fontSize: 12, color: "#8b93a1", marginBottom: 10 }}>체크한 국가별로 영업/물류/인증 준비 현황을 기재해주세요.</div>
        <div style={{ display: "grid", gap: 10 }}>
          {COUNTRIES.map(([code, name]) => {
            const on = checked.has(code); const r = rows[code] ?? {};
            return (
              <div key={code} style={{ border: "1px solid #e2e6eb", borderRadius: 10, padding: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "default" : "pointer" }}>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(code)} />
                  <b style={{ fontSize: 13, color: "#111" }}>{code} — {name}</b>
                </label>
                {on && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                    <MSel label="기존 영업 현황" val={r.shop_type ?? "none"} on={(x) => upd(code, { shop_type: x })} disabled={disabled}
                      opts={[["none", "없음"], ["online", "온라인 운영중"], ["offline", "오프라인 운영중"], ["both", "온·오프라인"]]} />
                    <MInp label="월 매출 (선택)" val={r.monthly_revenue ?? ""} on={(x) => upd(code, { monthly_revenue: x })} disabled={disabled} placeholder="예: $10,000" />
                    <MInp label="샵 URL (운영중인 경우)" full val={r.shop_url ?? ""} on={(x) => upd(code, { shop_url: x })} disabled={disabled} placeholder="https://..." />
                    <MSel label="제품 인증 현황" val={r.product_cert_status ?? "none"} on={(x) => upd(code, { product_cert_status: x })} disabled={disabled} opts={READINESS} />
                    <MSel label="물류 준비 현황" val={r.logistics_status ?? "none"} on={(x) => upd(code, { logistics_status: x })} disabled={disabled} opts={READINESS} />
                    <MInp label="인증 메모" val={r.product_cert_note ?? ""} on={(x) => upd(code, { product_cert_note: x })} disabled={disabled} />
                    <MInp label="물류 메모" val={r.logistics_note ?? ""} on={(x) => upd(code, { logistics_note: x })} disabled={disabled} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ══════════ Step 2 — 수권서 서명 ══════════
function Step2({ v, set, app, disabled }: { v: Record<string, string>; set: (k: string, x: string) => void; app: Record<string, unknown>; disabled: boolean }) {
  const f = (k: string) => sv(app, k) || v[k] || "____________";
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ background: "#eef4ff", border: "1px solid #cfe0ff", borderRadius: 12, padding: 14, fontSize: 13, color: "#1e3a8a" }}>
        <b>📋 자동 채움 데이터 (Step 1 기준)</b>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 8, fontSize: 12 }}>
          <div>대표자: <b>{f("ubo_full_name")}</b> ({sv(app, "ubo_title") || "-"})</div>
          <div>회사: <b>{f("company_name_en")}</b></div>
          <div>브랜드: <b>{f("shop_name_en")}</b></div>
          <div>카테고리: <b>{f("product_category")}</b></div>
        </div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #e2e6eb", borderRadius: 12, padding: 28, color: "#1f2937", lineHeight: 1.75, fontSize: 14 }}>
        <h1 style={{ textAlign: "center", fontSize: 19, fontWeight: 800, marginBottom: 22, letterSpacing: ".04em" }}>LETTER OF AUTHORIZATION</h1>
        <p style={{ marginBottom: 14 }}>This letter serves as an official authorization for <b>{f("ubo_full_name")}</b>, {f("ubo_title")} of <b>{f("company_name_en")}</b>, to represent the company in all matters concerning our TikTok Shop business.</p>
        <p style={{ marginBottom: 6, fontWeight: 600 }}>{f("ubo_full_name")} is hereby authorized to:</p>
        <ul style={{ paddingLeft: 22, marginBottom: 14 }}>
          <li>Register and operate a TikTok Shop account</li>
          <li>List and sell [{f("product_category")}] products</li>
          <li>Manage all business operations related to TikTok Shop</li>
          <li>Handle all transactions, communications, and administrative matters</li>
          <li>Make business decisions on behalf of [{f("company_name_en")}]</li>
        </ul>
        <p style={{ marginBottom: 22 }}>This authorization is valid from the date of this letter and shall remain in effect until revoked in writing.</p>
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
          <b>Brand Information</b>
          <ul style={{ fontSize: 13, marginTop: 6, paddingLeft: 16, listStyle: "none" }}>
            <li>• Brand name: {f("shop_name_en")}</li>
            <li>• Company: {f("company_name_en")}</li>
            <li>• Authorized Representative: {f("ubo_full_name")}</li>
            <li>• Position: {f("ubo_title")}</li>
          </ul>
        </div>
        <div style={{ marginTop: 26, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
          <div>
            <b>Authorized by</b>
            <div style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 8px" }}>대표자 본인이 아래 영역에 서명해주세요.</div>
            <SignaturePad value={v.ubo_signature_data ?? ""} onChange={(d) => set("ubo_signature_data", d)} disabled={disabled} />
            <div style={{ marginTop: 10, fontSize: 13 }}><b>{f("ubo_full_name")}</b><div style={{ fontSize: 12, color: "#6b7280" }}>{f("ubo_title")}</div></div>
          </div>
          <div>
            <b>Acknowledged by</b>
            <div style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 8px" }}>온보딩 파트너사 (사전 서명됨)</div>
            <div style={{ border: "1px solid #d5dae1", borderRadius: 8, background: "#fff", padding: "16px 18px", fontStyle: "italic", fontSize: 24, color: "#374151", fontFamily: "'Brush Script MT', cursive" }}>Hur Jeongbal</div>
            <div style={{ marginTop: 10, fontSize: 13 }}><b>DINO STUDIO INC.</b><div style={{ fontSize: 12, color: "#6b7280" }}>Hur Jeongbal · CEO</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════ Step 3 — 회사 추가정보 ══════════
function Step3({ v, set, disabled }: { v: Record<string, string>; set: (k: string, x: string) => void; disabled: boolean }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="① 지분 구조" desc="주주 구성 및 지분율을 기재해주세요. (예: 홍길동 60%, 김철수 40%)">
        <textarea value={v.ownership_structure ?? ""} disabled={disabled} onChange={(e) => set("ownership_structure", e.target.value)} rows={4}
          placeholder={"예시:\n- 홍길동 (대표) 60%\n- 김철수 (이사) 40%"} style={{ ...inputStyle, resize: "vertical" }} />
      </Card>
      <Card title="② 대표자 여권" desc="여권 사진·인적사항 면 한 장을 선명하게 업로드해주세요.">
        <FileField label="여권 사진면" req field="rep_passport_front" k="rep_passport_front_url" {...{ v, set, disabled }} />
      </Card>
      <Card title="③ 대표자 신분증" desc="국내 주민등록증 또는 운전면허증의 앞·뒷면을 업로드해주세요.">
        <Grid>
          <FileField label="신분증 앞면" req field="rep_id_front" k="rep_id_front_url" {...{ v, set, disabled }} />
          <FileField label="신분증 뒷면" req field="rep_id_back" k="rep_id_back_url" {...{ v, set, disabled }} />
        </Grid>
      </Card>
      <Card title="④ 대표자 거주지 증명서류" desc="최근 12개월 이내 발행, 대표자 성명·주소가 함께 표시된 서류 1부 (은행 거래내역서·신용카드 명세서·공과금 고지서·보험 증권 등).">
        <FileField label="거주지 증명서류" req field="rep_address_proof" k="rep_address_proof_url" {...{ v, set, disabled }} />
      </Card>
      <Card title="⑤ 핑퐁페이먼트(PingPong) 가입 여부" desc="해외 정산을 위해 PingPong Payments 계정이 필요합니다.">
        <div style={{ background: "#eef4ff", border: "1px solid #cfe0ff", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12.5, color: "#1e3a8a" }}>
          <b>📘 가입 가이드</b>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            <a href="https://business.pingpongx.com/entrance/signup?inviteCode=Daniel.Tark" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontWeight: 600 }}>· 핑퐁페이먼트 가입 링크 ↗</a>
            <a href="https://pingpongkr.notion.site/guidekr" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontWeight: 600 }}>· 핑퐁 가이드북 ↗</a>
            <a href="https://steadfast-pike-4c7.notion.site/2399c42de1e7806cae63c33df04c14d3" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontWeight: 600 }}>· 핑퐁 가상계좌 가입 가이드 ↗</a>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          {[["registered", "가입 완료", "이미 계정이 있고 이메일 입력 가능"], ["pending", "신청 중", "가입 절차 진행 중"], ["none", "아직 없음", "가이드가 필요합니다"]].map(([val, label, desc]) => {
            const on = (v.payoneer_status || "none") === val;
            return (
              <label key={val} style={{ cursor: disabled ? "default" : "pointer" }}>
                <input type="radio" name="payoneer_status" checked={on} disabled={disabled} onChange={() => set("payoneer_status", val)} style={{ display: "none" }} />
                <div style={{ border: `2px solid ${on ? ACC : "#e2e6eb"}`, background: on ? "#eafaf3" : "#fff", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{label}</div>
                  <div style={{ fontSize: 11, color: "#8b93a1", marginTop: 2 }}>{desc}</div>
                </div>
              </label>
            );
          })}
        </div>
        <Grid>
          <F label="핑퐁페이먼트 이메일 (가입된 경우)" type="email" k="payoneer_email" placeholder="pingpong@example.com" {...{ v, set, disabled }} />
          <F label="메모 (선택)" k="payoneer_note" {...{ v, set, disabled }} />
        </Grid>
      </Card>
    </div>
  );
}

// ══════════ Step 4 — 제품 등록 ══════════
function Step4({ disabled, countries, products, productCountries, onChange, flash }:
  { disabled: boolean; countries: Country[]; products: Product[]; productCountries: Record<string, ProductCountry[]>; onChange: () => void; flash: (m: string) => void }) {
  const [draft, setDraft] = useState<Partial<Product>>({});
  if (countries.length === 0) return <Banner tone="warn">Step 1에서 입점 희망 국가를 먼저 선택해주세요. 국가별 단가/인증/상세페이지를 국가 단위로 구성합니다.</Banner>;
  async function add() {
    if (!draft.name) { flash("제품명을 입력하세요."); return; }
    const r = await addProductAction(draft); if (r.ok) { setDraft({}); onChange(); flash("제품이 추가되었습니다."); } else flash(r.error ?? "추가 실패");
  }
  async function del(id: string) { if (!confirm("이 제품을 삭제할까요?")) return; const r = await deleteProductAction(id); if (r.ok) { onChange(); flash("삭제되었습니다."); } }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {!disabled && (
        <Card title="➕ 제품 추가">
          <Grid cols={4}>
            <MInp label="제품명 *" full val={draft.name ?? ""} on={(x) => setDraft({ ...draft, name: x })} disabled={false} />
            <MInp label="카테고리" val={draft.category ?? ""} on={(x) => setDraft({ ...draft, category: x })} disabled={false} />
            <MInp label="SKU (선택)" val={draft.sku ?? ""} on={(x) => setDraft({ ...draft, sku: x })} disabled={false} />
          </Grid>
          <button onClick={add} style={{ ...btnPri, marginTop: 10 }}>제품 추가</button>
        </Card>
      )}
      {products.length === 0 ? <Empty>등록된 제품이 없습니다. 위에서 제품을 먼저 추가해주세요.</Empty> :
        products.map((p, idx) => (
          <ProductCard key={p.id} idx={idx} p={p} disabled={disabled} countries={countries} rows={productCountries[p.id] ?? []} onChange={onChange} flash={flash} onDelete={() => del(p.id)} />
        ))}
    </div>
  );
}
function ProductCard({ idx, p, disabled, countries, rows, onChange, flash, onDelete }:
  { idx: number; p: Product; disabled: boolean; countries: Country[]; rows: ProductCountry[]; onChange: () => void; flash: (m: string) => void; onDelete: () => void }) {
  const [pd, setPd] = useState({ name: p.name, category: p.category ?? "", sku: p.sku ?? "", description_kr: p.description_kr ?? "" });
  const byCode = Object.fromEntries(rows.map((r) => [r.country_code, r]));
  const [pc, setPc] = useState<Record<string, Partial<ProductCountry>>>(byCode);
  const updPc = (code: string, patch: Partial<ProductCountry>) => setPc((s) => ({ ...s, [code]: { ...(s[code] ?? {}), ...patch } }));
  async function save() {
    await updateProductAction(p.id, pd);
    for (const c of countries) {
      const row = pc[c.country_code]; if (!row) continue;
      await upsertProductCountryAction(p.id, { ...row, id: byCode[c.country_code]?.id, country_code: c.country_code });
    }
    onChange(); flash("저장되었습니다.");
  }
  return (
    <Card title={`제품 #${idx + 1} · ${p.name}`}>
      {!disabled && <button onClick={onDelete} style={{ float: "right", marginTop: -30, background: "transparent", border: 0, color: "#e03131", fontSize: 12, cursor: "pointer" }}>삭제</button>}
      <Grid cols={4}>
        <MInp label="제품명" full val={pd.name} on={(x) => setPd({ ...pd, name: x })} disabled={disabled} />
        <MInp label="카테고리" val={pd.category} on={(x) => setPd({ ...pd, category: x })} disabled={disabled} />
        <MInp label="SKU" val={pd.sku} on={(x) => setPd({ ...pd, sku: x })} disabled={disabled} />
      </Grid>
      <textarea value={pd.description_kr} disabled={disabled} onChange={(e) => setPd({ ...pd, description_kr: e.target.value })} rows={2} placeholder="제품 설명 (한글)" style={{ ...inputStyle, marginTop: 8, resize: "vertical" }} />
      <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "#111" }}>국가별 단가 · 인증 · 상세페이지</div>
      <details style={{ marginTop: 6, background: "#f0f6ff", border: "1px solid #cfe0ff", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: "#1e3a8a" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>📎 FDA 인증 첨부자료 예시 — 어떤 서류를 올리면 되나요?</summary>
        <div style={{ marginTop: 8, lineHeight: 1.7 }}>
          <b>미국(US)</b> 판매 시 「인증 첨부」에는 아래 중 <b>해당 제품의 FDA 등록을 확인할 수 있는 서류/화면 캡처</b>를 올려주세요.
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>FDA <b>Establishment/Facility Registration</b> 확인 화면 (등록번호가 보이게 캡처)</li>
            <li>식품·건강기능식품: <b>Food Facility Registration Number</b> 문서</li>
            <li>화장품: <b>MoCRA(화장품 등록)</b> 확인 화면 또는 등록번호</li>
            <li>의료기기·OTC: 해당 <b>FDA Product/Device Listing</b> 캡처</li>
          </ul>
          <div style={{ marginTop: 6, color: "#3b5ba5" }}>※ 제품마다 카테고리가 다르면 각 제품별로 알맞은 FDA 등록 서류를 첨부해 주세요. 아직 등록 전이라면 「인증」을 <b>준비중</b>으로 두고 메모에 진행 상황을 적어주세요.</div>
          <div style={{ marginTop: 10, fontWeight: 700 }}>예시 화면 — FDA Direct · Cosmetic Product Listing</div>
          <div style={{ fontSize: 11.5, color: "#3b5ba5", marginBottom: 6 }}>화장품은 아래 FDA Direct 등록 화면(제품·책임자·시설 정보)을 캡처해 첨부하시면 됩니다.</div>
          <FdaListingExample />
        </div>
      </details>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 720 }}>
          <thead><tr style={{ color: "#8b93a1", textAlign: "left" }}>
            <th style={thc}>국가</th><th style={thc}>단가</th><th style={thc}>통화</th><th style={thc}>인증</th><th style={thc}>인증 메모</th><th style={thc}>인증 첨부</th><th style={thc}>상세페이지(한글)</th>
          </tr></thead>
          <tbody>
            {countries.map((c) => {
              const r = pc[c.country_code] ?? {};
              return (
                <tr key={c.country_code} style={{ borderTop: "1px solid #eef1f4", verticalAlign: "top" }}>
                  <td style={tdc}><b>{c.country_code}</b><div style={{ color: "#8b93a1" }}>{COUNTRY_NAME[c.country_code] ?? ""}</div></td>
                  <td style={tdc}><input value={r.unit_price ?? ""} disabled={disabled} onChange={(e) => updPc(c.country_code, { unit_price: e.target.value })} style={{ ...cellInp, width: 80 }} /></td>
                  <td style={tdc}><select value={r.currency ?? "USD"} disabled={disabled} onChange={(e) => updPc(c.country_code, { currency: e.target.value })} style={cellInp}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td style={tdc}><select value={r.cert_status ?? "none"} disabled={disabled} onChange={(e) => updPc(c.country_code, { cert_status: e.target.value })} style={cellInp}>{READINESS.map(([sv2, sl]) => <option key={sv2} value={sv2}>{sl}</option>)}</select></td>
                  <td style={tdc}><input value={r.cert_note ?? ""} disabled={disabled} onChange={(e) => updPc(c.country_code, { cert_note: e.target.value })} style={{ ...cellInp, minWidth: 110 }} /></td>
                  <td style={tdc}><InlineFile field={`cert_${c.country_code}`} url={r.cert_file_url} disabled={disabled} onDone={(u) => updPc(c.country_code, { cert_file_url: u })} /></td>
                  <td style={tdc}><textarea value={r.detail_page_kr ?? ""} disabled={disabled} onChange={(e) => updPc(c.country_code, { detail_page_kr: e.target.value })} rows={2} style={{ ...cellInp, minWidth: 200 }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!disabled && <button onClick={save} style={{ ...btnDark, marginTop: 12 }}>이 제품 저장</button>}
    </Card>
  );
}

// ══════════ Step 5 — 물류 계약서 ══════════
function Step5({ disabled, countries, onChange, flash }: { disabled: boolean; countries: Country[]; onChange: () => void; flash: (m: string) => void }) {
  if (countries.length === 0) return <Banner tone="warn">Step 1에서 입점 희망 국가를 먼저 선택해주세요. 국가별로 물류 방식을 선택합니다.</Banner>;
  return (
    <Card title="국가별 물류 진행" desc="입점 희망 국가별로 물류 방식(FBA / 현지 물류창고 계약 / 한국 크로스보더 배송)을 선택하고, 현지 주소·계약 정보·계약서를 입력해주세요.">
      <div style={{ display: "grid", gap: 10 }}>
        {countries.map((c) => {
          const opt = c.logistics_option ?? "";
          const needWarehouse = opt === "fba" || opt === "local_warehouse"; // 현지 주소·계약 정보 필요
          return (
          <div key={c.country_code} style={{ border: "1px solid #e2e6eb", borderRadius: 10, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 13, color: "#111" }}>{c.country_code}</b>
              <span style={{ fontSize: 12, color: "#8b93a1" }}>{COUNTRY_NAME[c.country_code] ?? c.country_name}</span>
            </div>
            <label style={{ fontSize: 12, color: "#4b5563", fontWeight: 600, display: "block", marginBottom: 8 }}>물류 방식
              <select value={opt} disabled={disabled} onChange={async (e) => { await setCountryLogisticsOptionAction(c.country_code, e.target.value); onChange(); }} style={{ ...inputStyle, maxWidth: 300 }}>
                {LOGISTICS_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </label>
            {opt === "cross_border" && <div style={{ fontSize: 12, color: "#1d4ed8", background: "#eef4ff", border: "1px solid #cfe0ff", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>📦 한국에서 크로스보더 배송: 주문 시 한국에서 직접 발송합니다. 현지 창고 계약이 없어도 됩니다.</div>}
            {needWarehouse && (
              <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                <LDetailInput label={opt === "fba" ? "FBA 입고 주소 (현지 주소)" : "현지 물류창고 주소"} code={c.country_code} field="local_address"
                  init={c.logistics_local_address ?? ""} disabled={disabled} onSaved={() => { onChange(); flash("저장되었습니다."); }} />
                <LDetailInput label={opt === "fba" ? "FBA 계정·계약 정보 (업체·조건)" : "현지창고 계약 정보 (업체·조건)"} code={c.country_code} field="contract_info"
                  init={c.logistics_contract_info ?? ""} disabled={disabled} onSaved={() => { onChange(); flash("저장되었습니다."); }} textarea />
              </div>
            )}
            <div style={{ fontSize: 12, color: "#4b5563", fontWeight: 600, marginBottom: 4 }}>계약서·증빙 첨부 {opt === "fba" && "(FBA 재고/계정 화면 캡처로 대체 가능)"}</div>
            <InlineFile field={`logistics_${c.country_code}`} url={c.logistics_contract_url} disabled={disabled}
              onDone={async (u) => { await setCountryLogisticsAction(c.country_code, u); onChange(); flash("업로드되었습니다."); }} />
          </div>
          );
        })}
      </div>
    </Card>
  );
}

// 물류 상세(현지 주소·계약 정보) — blur 시 저장.
function LDetailInput({ label, code, field, init, disabled, onSaved, textarea }: { label: string; code: string; field: "local_address" | "contract_info"; init: string; disabled: boolean; onSaved: () => void; textarea?: boolean }) {
  const [v, setV] = useState(init);
  async function save() { if (v === init) return; await setCountryLogisticsDetailAction(code, { [field]: v }); onSaved(); }
  return (
    <label style={{ fontSize: 12, color: "#4b5563", fontWeight: 600, display: "block" }}>{label}
      {textarea
        ? <textarea value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={save} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        : <input value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={save} style={inputStyle} />}
    </label>
  );
}

// ══════════ 파일 업로드 ══════════
async function uploadFile(field: string, file: File): Promise<{ ok: boolean; url?: string; error?: string }> {
  const fd = new FormData(); fd.append("file", file); fd.append("field", field);
  const res = await fetch("/api/apply/upload", { method: "POST", body: fd });
  return res.json().catch(() => ({ ok: false, error: "업로드 실패" }));
}
function FileField({ label, req, field, k, v, set, disabled }: { label: string; req?: boolean; field: string; k: string; v: Record<string, string>; set: (k: string, x: string) => void; disabled: boolean }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const url = v[k] ?? "";
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setErr("");
    const r = await uploadFile(field, file); setBusy(false);
    if (r.ok && r.url) set(k, r.url); else setErr(r.error ?? "업로드 실패");
  }
  return (
    <label style={{ fontSize: 12, color: "#4b5563", fontWeight: 600, display: "block" }}>
      {label} {req && <span style={{ color: "#e03131" }}>*</span>} <span style={{ color: "#9ca3af", fontWeight: 400 }}>PDF/JPG/PNG · 10MB</span>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={disabled || busy} onChange={onPick} style={{ display: "block", marginTop: 5, fontSize: 13 }} />
      {busy && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>업로드 중…</div>}
      {url && !busy && <div style={{ fontSize: 12, color: "#0b7a52", marginTop: 3 }}>✓ 업로드됨 · <a href={url} target="_blank" rel="noreferrer" style={{ color: ACC }}>보기</a></div>}
      {err && <div style={{ fontSize: 12, color: "#e03131", marginTop: 3 }}>{err}</div>}
    </label>
  );
}
function InlineFile({ field, url, disabled, onDone }: { field: string; url?: string; disabled: boolean; onDone: (u: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); const r = await uploadFile(field, file); setBusy(false);
    if (r.ok && r.url) onDone(r.url);
  }
  return (
    <div>
      {!disabled && <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={onPick} style={{ fontSize: 12, maxWidth: 150 }} />}
      {busy && <div style={{ fontSize: 11, color: "#6b7280" }}>업로드 중…</div>}
      {url && <div style={{ fontSize: 11, color: "#0b7a52", marginTop: 2 }}>✓ <a href={url} target="_blank" rel="noreferrer" style={{ color: ACC }}>보기</a></div>}
    </div>
  );
}

// ══════════ 서명 패드 ══════════
function SignaturePad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null); const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = value; }
  }, []); // eslint-disable-line
  const pos = (e: React.PointerEvent) => { const c = ref.current!; const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const down = useCallback((e: React.PointerEvent) => { if (disabled) return; drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.strokeStyle = "#111827"; ctx.lineWidth = 2.2; ctx.lineCap = "round"; }, [disabled]);
  const move = useCallback((e: React.PointerEvent) => { if (!drawing.current || disabled) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, [disabled]);
  const up = useCallback(() => { if (!drawing.current) return; drawing.current = false; onChange(ref.current!.toDataURL("image/png")); }, [onChange]);
  const clear = () => { const c = ref.current!; const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); onChange(""); };
  return (
    <div>
      <canvas ref={ref} width={400} height={140} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: "100%", maxWidth: 400, height: "auto", borderRadius: 8, border: "2px dashed #9ca3af", background: "#fff", touchAction: "none", cursor: disabled ? "not-allowed" : "crosshair" }} />
      {!disabled && <button onClick={clear} style={{ marginTop: 8, background: "#f3f4f6", color: "#374151", border: 0, borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>지우기</button>}
    </div>
  );
}

// ══════════ 공통 UI (라이트 테마) ══════════
const ACC = "#12b886";
function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: "1px solid #e2e6eb", borderRadius: 14, padding: 20 }}>
    <div style={{ fontSize: 16, fontWeight: 800, color: "#111" }}>{title}</div>
    {desc && <div style={{ fontSize: 12.5, color: "#8b93a1", margin: "3px 0 12px" }}>{desc}</div>}
    {!desc && <div style={{ height: 12 }} />}
    {children}
  </div>;
}
function Grid({ children, cols }: { children: React.ReactNode; cols?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${cols === 4 ? 150 : cols === 3 ? 180 : 200}px, 1fr))`, gap: 10 }}>{children}</div>;
}
type FP = { v: Record<string, string>; set: (k: string, x: string) => void; disabled: boolean };
function F({ label, k, v, set, disabled, req, type, placeholder, full, hint }: FP & { label: string; k: string; req?: boolean; type?: string; placeholder?: string; full?: boolean; hint?: string }) {
  return <label style={{ fontSize: 12, color: "#4b5563", fontWeight: 600, display: "block", gridColumn: full ? "1 / -1" : undefined }}>
    {label} {req && <span style={{ color: "#e03131" }}>*</span>}
    <input type={type ?? "text"} value={v[k] ?? ""} disabled={disabled} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} style={inputStyle} />
    {hint && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{hint}</div>}
  </label>;
}
function Sel({ label, k, opts, v, set, disabled, dflt }: FP & { label: string; k: string; opts: [string, string][]; dflt?: string }) {
  return <label style={{ fontSize: 12, color: "#4b5563", fontWeight: 600, display: "block" }}>
    {label}
    <select value={v[k] || dflt || opts[0][0]} disabled={disabled} onChange={(e) => set(k, e.target.value)} style={inputStyle}>{opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select>
  </label>;
}
function MInp({ label, val, on, disabled, full, placeholder }: { label: string; val: string; on: (x: string) => void; disabled: boolean; full?: boolean; placeholder?: string }) {
  return <label style={{ fontSize: 11, color: "#6b7280", display: "flex", flexDirection: "column", gap: 3, gridColumn: full ? "1 / -1" : undefined }}>
    {label}<input value={val} disabled={disabled} placeholder={placeholder} onChange={(e) => on(e.target.value)} style={{ ...inputStyle, marginTop: 0 }} />
  </label>;
}
function MSel({ label, val, on, disabled, opts }: { label: string; val: string; on: (x: string) => void; disabled: boolean; opts: [string, string][] }) {
  return <label style={{ fontSize: 11, color: "#6b7280", display: "flex", flexDirection: "column", gap: 3 }}>
    {label}<select value={val} disabled={disabled} onChange={(e) => on(e.target.value)} style={{ ...inputStyle, marginTop: 0 }}>{opts.map(([v2, l]) => <option key={v2} value={v2}>{l}</option>)}</select>
  </label>;
}
function Banner({ tone, children }: { tone: "warn" | "info" | "ok" | "mute"; children: React.ReactNode }) {
  const c = { warn: ["#fff7ed", "#c2410c", "#fed7aa"], info: ["#eef4ff", "#1e40af", "#cfe0ff"], ok: ["#eafaf3", "#0b7a52", "#a7f0cf"], mute: ["#f7f8fa", "#6b7280", "#e2e6eb"] }[tone];
  return <div style={{ background: c[0], color: c[1], border: `1px solid ${c[2]}`, borderRadius: 10, padding: "11px 14px", fontSize: 13, marginBottom: 14 }}>{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) { return <div style={{ background: "#f7f8fa", border: "1px solid #e2e6eb", borderRadius: 12, padding: 40, textAlign: "center", color: "#6b7280", fontSize: 13 }}>{children}</div>; }

const inputStyle: React.CSSProperties = { width: "100%", background: "#fff", border: "1px solid #d5dae1", borderRadius: 9, padding: "10px 12px", color: "#111", fontSize: 14, marginTop: 5, boxSizing: "border-box" };
const cellInp: React.CSSProperties = { background: "#fff", border: "1px solid #d5dae1", borderRadius: 6, padding: "6px 8px", color: "#111", fontSize: 12, boxSizing: "border-box" };
const thc: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const tdc: React.CSSProperties = { padding: "6px 8px" };
const btnPri: React.CSSProperties = { background: ACC, color: "#fff", border: 0, borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnGray: React.CSSProperties = { background: "#f3f4f6", color: "#374151", border: 0, borderRadius: 10, padding: "12px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnDark: React.CSSProperties = { background: "#111827", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" };

function statusLabel(s: string) { return { locked: "잠김", unlocked: "작성 가능", draft: "작성 가능", submitted: "검토중", approved: "승인", rejected: "반려" }[s] ?? s; }
function statusColor(s: string) { return { locked: "#9ca3af", unlocked: "#2563eb", draft: "#2563eb", submitted: "#c2410c", approved: "#0b7a52", rejected: "#e03131" }[s] ?? "#6b7280"; }
function statusIcon(s: string) { return { locked: "🔒", unlocked: "✏️", draft: "✏️", submitted: "⏳", approved: "✅", rejected: "❌" }[s] ?? ""; }

// 스텝별 저장 키(서버 STEP_FIELDS 와 일치)
const STEP_KEYS: string[][] = [
  ["company_name_kr", "company_name_en", "company_type", "company_country", "company_reg_date", "company_reg_number",
   "contact_name", "contact_email", "contact_phone", "address_kr", "address_en", "op_address_en",
   "shop_name_kr", "shop_name_en", "product_category", "sales_channel_url", "brand_logo_url", "ubo_full_name", "ubo_title",
   "doc_biz_reg_en_url", "doc_biz_reg_kr_url", "doc_corp_reg_kr_url"],
  ["ubo_signature_data"],
  ["ownership_structure", "rep_passport_front_url", "rep_passport_back_url", "rep_id_front_url", "rep_id_back_url", "rep_address_proof_url", "payoneer_status", "payoneer_email", "payoneer_note"],
  [],
  [],
];
const ALL_FIELDS = Array.from(new Set(STEP_KEYS.flat()));
