"use client";
import { useState, useTransition } from "react";
import type { CardDeep } from "@/lib/repo/card";
import {
  addContactAction, deleteContactAction, addProductAction, upsertCertAction,
  createProposalAction, addContractAction, setContractStatusAction,
  upsertLogisticsAction, createSurveyAction,
} from "@/app/actions";

// 국가는 코드로 다루고(product_certs.country 와 동일 기준) 표시만 한글 매핑(#5,21).
const COUNTRIES = ["US", "VN", "TH", "SG", "PH", "MY"];
const COUNTRY_LABEL: Record<string, string> = {
  US: "미국", VN: "베트남", TH: "태국", SG: "싱가포르", PH: "필리핀", MY: "말레이시아",
};
const countryLabel = (code: string) => COUNTRY_LABEL[code] ?? code;

const CERT_TYPES = ["FDA등록", "보건부신고", "태국FDA", "할랄", "HSA", "영문라벨", "원산지증명", "기타"];
const CERT_STATUS: Record<string, { ko: string }> = {
  none: { ko: "없음" },
  preparing: { ko: "준비중" },
  submitted: { ko: "제출" },
  ready: { ko: "완료" },
  rejected: { ko: "반려" },
  expired: { ko: "만료" },
};
// 상태 → .cellchip 색상 클래스(#33).
const CERT_CC: Record<string, string> = {
  none: "cc-no", preparing: "cc-warn", submitted: "cc-ing",
  ready: "cc-ok", rejected: "cc-exp", expired: "cc-exp",
};
// 최악상태 롤업용 심각도(클수록 나쁨): 완료 < 제출 < 준비중 < 없음 < 반려 < 만료.
const CERT_SEVERITY: Record<string, number> = {
  ready: 0, submitted: 1, preparing: 2, none: 3, rejected: 4, expired: 5,
};

type Tab = "contacts" | "survey" | "meetings" | "products" | "inventory" | "logistics" | "contracts" | "proposals" | "company" | "assets" | "mkt";
const TABS: { key: Tab; label: string }[] = [
  { key: "contacts", label: "연락처" },
  { key: "survey", label: "설문" },
  { key: "meetings", label: "미팅" },
  { key: "products", label: "제품·인증" },
  { key: "inventory", label: "재고" },
  { key: "logistics", label: "물류" },
  { key: "contracts", label: "계약" },
  { key: "proposals", label: "제안" },
  { key: "company", label: "회사정보" },
  { key: "assets", label: "자료" },
  { key: "mkt", label: "마케팅" },
];

export default function CardTabs({ brandId, deep }: { brandId: string; deep: CardDeep }) {
  const [tab, setTab] = useState<Tab>("contacts");
  const count: Record<Tab, number> = {
    contacts: deep.contacts.length, survey: deep.surveys.length, meetings: deep.meetings.length,
    products: deep.products.length, inventory: deep.inventory.length, logistics: deep.logistics.length,
    contracts: deep.contracts.length, proposals: deep.proposals.length, company: deep.company ? 1 : 0,
    assets: deep.assets.length, mkt: deep.mktProjects.length,
  };
  return (
    <div className="card p-0 mb-4 overflow-hidden">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={tab === t.key ? "on" : ""}>
            {t.label}{count[t.key] > 0 && <span className="ml-1 text-xs opacity-60">{count[t.key]}</span>}
          </button>
        ))}
      </div>
      <div className="p-5">
        {tab === "contacts" && <Contacts brandId={brandId} deep={deep} />}
        {tab === "survey" && <Surveys brandId={brandId} deep={deep} />}
        {tab === "meetings" && <Meetings deep={deep} />}
        {tab === "products" && <Products brandId={brandId} deep={deep} />}
        {tab === "inventory" && <Inventory deep={deep} />}
        {tab === "logistics" && <Logistics brandId={brandId} deep={deep} />}
        {tab === "contracts" && <Contracts brandId={brandId} deep={deep} />}
        {tab === "proposals" && <Proposals brandId={brandId} deep={deep} />}
        {tab === "company" && <Company deep={deep} />}
        {tab === "assets" && <Assets deep={deep} />}
        {tab === "mkt" && <Mkt deep={deep} />}
      </div>
    </div>
  );
}

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? "" : r.error ?? "실패");
    });
  return { pending, msg, run };
}

// ── 연락처 (14-B) ──────────────────────────────────────────────
function Contacts({ brandId, deep }: { brandId: string; deep: CardDeep }) {
  const { pending, run } = useAct();
  const [f, setF] = useState({ name: "", title: "", email: "", phone: "", role: "main", is_primary: false });
  return (
    <div>
      <div className="space-y-2 mb-4">
        {deep.contacts.length === 0 && <p className="text-sm text-muted">등록된 인물이 없습니다.</p>}
        {deep.contacts.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border rounded-lg p-3">
            <div className="flex-1">
              <div className="font-medium">{c.name}
                {c.is_primary && <span className="ml-2 pill bg-[#ffe0ee] text-pink text-xs">대표</span>}
                <span className="ml-2 text-xs text-muted">{c.title} · {roleKo(c.role)}</span>
              </div>
              <div className="text-sm text-muted">{c.email ?? "—"} · {c.phone ?? "—"}</div>
            </div>
            <button className="text-xs text-red-500" disabled={pending}
              onClick={() => run(() => deleteContactAction(brandId, c.id))}>삭제</button>
          </div>
        ))}
      </div>
      <div className="border-t pt-3 grid grid-cols-2 gap-2">
        <input className="input" placeholder="이름" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" placeholder="직책" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <input className="input" placeholder="이메일" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="input" placeholder="전화" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="main">대표</option><option value="marketing">마케팅</option>
          <option value="logistics">물류</option><option value="settlement">정산</option><option value="etc">기타</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} />
          대표 담당(카드 동기)
        </label>
        <button className="btn btn-primary col-span-2" disabled={pending || !f.name}
          onClick={() => run(async () => { const r = await addContactAction({ brand_id: brandId, ...f }); if (r.ok) setF({ name: "", title: "", email: "", phone: "", role: "main", is_primary: false }); return r; })}>
          + 인물 추가
        </button>
      </div>
    </div>
  );
}

// ── 설문 (14-A) ────────────────────────────────────────────────
function Surveys({ brandId, deep }: { brandId: string; deep: CardDeep }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState("");
  return (
    <div>
      <button className="btn btn-primary mb-4" disabled={pending}
        onClick={() => start(async () => { const r = await createSurveyAction(brandId); if (r.ok && r.url) setLink(location.origin + r.url); })}>
        + 마케팅 설문 링크 생성
      </button>
      {link && <div className="mb-4 text-sm p-2 bg-gray-50 rounded border break-all">{link}
        <button className="ml-2 text-pink text-xs" onClick={() => navigator.clipboard?.writeText(link)}>복사</button></div>}
      <div className="space-y-2">
        {deep.surveys.length === 0 && <p className="text-sm text-muted">발송된 설문이 없습니다.</p>}
        {deep.surveys.map((s) => (
          <div key={s.id} className="border rounded-lg p-3 text-sm">
            <div className="flex justify-between">
              <span>{s.kind} · {s.sent_at ? new Date(s.sent_at).toLocaleDateString("ko-KR") : "미발송"}</span>
              <span className={s.responded_at ? "text-green-600" : "text-muted"}>{s.responded_at ? "응답완료" : "대기"}</span>
            </div>
            {s.responded_at && (
              <pre className="mt-2 text-xs bg-gray-50 p-2 rounded whitespace-pre-wrap">{JSON.stringify(s.answers, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 제품·인증 매트릭스 (10-B) ──────────────────────────────────
function Products({ brandId, deep }: { brandId: string; deep: CardDeep }) {
  const { pending, run } = useAct();
  const [name, setName] = useState("");
  // 국가별(코드 기준) 다중 cert는 최악상태로 롤업(#5,21,33).
  const certOf = (pid: string, code: string) => {
    const matches = deep.certs.filter((c) => c.product_id === pid && c.country === code);
    if (matches.length === 0) return undefined;
    return matches.reduce((worst, c) =>
      (CERT_SEVERITY[c.status] ?? 3) > (CERT_SEVERITY[worst.status] ?? 3) ? c : worst);
  };
  return (
    <div>
      {deep.products.length === 0 ? (
        <p className="text-sm text-muted mb-4">등록된 제품이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-muted">
                <th className="p-2 border-b">제품</th>
                {COUNTRIES.map((c) => <th key={c} className="p-2 border-b text-center">{countryLabel(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {deep.products.map((p) => (
                <tr key={p.id}>
                  <td className="p-2 border-b font-medium">{p.name_kr}</td>
                  {COUNTRIES.map((c) => {
                    const cert = certOf(p.id, c);
                    return (
                      <td key={c} className="p-2 border-b text-center">
                        <CertCell brandId={brandId} productId={p.id} country={c}
                          status={cert?.status ?? "none"} certType={cert?.cert_type} expires={cert?.expires_at} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t pt-3 flex gap-2">
        <input className="input flex-1" placeholder="제품명" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" disabled={pending || !name}
          onClick={() => run(async () => { const r = await addProductAction({ brand_id: brandId, name_kr: name }); if (r.ok) setName(""); return r; })}>
          + 제품
        </button>
      </div>
    </div>
  );
}

function CertCell({ brandId, productId, country, status, certType, expires }: {
  brandId: string; productId: string; country: string; status: string; certType?: string; expires?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAct();
  const st = CERT_STATUS[status] ?? CERT_STATUS.none;
  const soon = !!expires && status !== "expired" && status !== "none"
    && new Date(expires).getTime() - Date.now() < 30 * 864e5;
  const cc = soon ? "cc-warn" : (CERT_CC[status] ?? "cc-no");
  const [f, setF] = useState({ cert_type: certType ?? CERT_TYPES[0], status, expires_at: expires ?? "" });
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(!open)} className={`cellchip ${cc}`} title={certType}>
        {st.ko}{soon ? " ⚠" : ""}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 left-1/2 -translate-x-1/2 bg-white border rounded-lg shadow-lg p-3 w-52 text-left space-y-2">
          <select className="input w-full" value={f.cert_type} onChange={(e) => setF({ ...f, cert_type: e.target.value })}>
            {CERT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select className="input w-full" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {Object.entries(CERT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.ko}</option>)}
          </select>
          <input type="date" className="input w-full" value={f.expires_at ?? ""} onChange={(e) => setF({ ...f, expires_at: e.target.value })} />
          <button className="btn btn-primary w-full text-xs" disabled={pending}
            onClick={() => run(async () => { const r = await upsertCertAction(brandId, { product_id: productId, country, cert_type: f.cert_type, status: f.status, expires_at: f.expires_at || null }); if (r.ok) setOpen(false); return r; })}>
            저장
          </button>
        </div>
      )}
    </div>
  );
}

// ── 재고 (14-C) ────────────────────────────────────────────────
function Inventory({ deep }: { deep: CardDeep }) {
  if (deep.inventory.length === 0) return <p className="text-sm text-muted">초기 재고 투입 내역이 없습니다.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-muted"><th className="p-2">국가</th><th className="p-2">제품</th><th className="p-2">수량</th><th className="p-2">상태</th><th className="p-2">추적</th></tr></thead>
      <tbody>
        {deep.inventory.map((i) => (
          <tr key={i.id} className="border-t">
            <td className="p-2">{i.country}</td><td className="p-2">{i.product_name ?? "—"}</td>
            <td className="p-2">{i.qty}</td><td className="p-2">{i.status}</td><td className="p-2">{i.tracking_no || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 물류 (14-D) ────────────────────────────────────────────────
function Logistics({ brandId, deep }: { brandId: string; deep: CardDeep }) {
  const { pending, run } = useAct();
  const [f, setF] = useState({ country: COUNTRIES[0], provider: "", status: "none", end_date: "" });
  return (
    <div>
      <div className="space-y-2 mb-4">
        {deep.logistics.length === 0 && <p className="text-sm text-muted">물류 계약이 없습니다.</p>}
        {deep.logistics.map((l) => (
          <div key={l.id} className="border rounded-lg p-3 text-sm flex justify-between">
            <span>{l.country} · {l.provider || "미정"}</span>
            <span className="pill bg-gray-100">{l.status}{l.end_date ? ` · ~${l.end_date}` : ""}</span>
          </div>
        ))}
      </div>
      <div className="border-t pt-3 grid grid-cols-2 gap-2">
        <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
          {COUNTRIES.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
        </select>
        <input className="input" placeholder="3PL/제공사" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} />
        <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {["none", "negotiating", "contracted", "active", "expired"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="date" className="input" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        <button className="btn btn-primary col-span-2" disabled={pending}
          onClick={() => run(() => upsertLogisticsAction({ brand_id: brandId, ...f }))}>+ 물류 계약</button>
      </div>
    </div>
  );
}

// ── 계약 (10-D) ────────────────────────────────────────────────
function Contracts({ brandId, deep }: { brandId: string; deep: CardDeep }) {
  const { pending, run } = useAct();
  const [f, setF] = useState({ kind: "mall", fee_pct: "", term_months: "", end_date: "" });
  return (
    <div>
      <div className="space-y-2 mb-4">
        {deep.contracts.length === 0 && <p className="text-sm text-muted">등록된 계약이 없습니다.</p>}
        {deep.contracts.map((c) => (
          <div key={c.id} className="border rounded-lg p-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="font-medium">{kindKo(c.kind)} v{c.version}</span>
              <select className="input text-xs" value={c.status} disabled={pending}
                onChange={(e) => run(() => setContractStatusAction(brandId, c.id, e.target.value))}>
                {["draft", "review", "sent", "signed", "expired", "terminated"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="text-xs text-muted mt-1">
              수수료 {(c.terms as { fee_pct?: number }).fee_pct ?? "—"}% · 약정 {(c.terms as { term_months?: number }).term_months ?? "—"}개월
              {c.end_date ? ` · 만료 ${c.end_date}` : ""}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t pt-3 grid grid-cols-2 gap-2">
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="mall">멀티몰</option><option value="onboarding">온보딩</option>
          <option value="guarantee">Guarantee</option><option value="marketing">마케팅</option>
          <option value="marketing_retainer">마케팅 리테이너</option>
        </select>
        <input className="input" placeholder="수수료율 %" value={f.fee_pct} onChange={(e) => setF({ ...f, fee_pct: e.target.value })} />
        <input className="input" placeholder="약정 개월" value={f.term_months} onChange={(e) => setF({ ...f, term_months: e.target.value })} />
        <input type="date" className="input" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        <button className="btn btn-primary col-span-2" disabled={pending}
          onClick={() => run(() => addContractAction({
            brand_id: brandId, kind: f.kind,
            fee_pct: f.fee_pct ? Number(f.fee_pct) : undefined,
            term_months: f.term_months ? Number(f.term_months) : undefined,
            end_date: f.end_date || undefined,
          }))}>+ 계약 등록</button>
      </div>
    </div>
  );
}

// ── 제안 + 견적 빌더 (10-C) ────────────────────────────────────
function Proposals({ brandId, deep }: { brandId: string; deep: CardDeep }) {
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState("live_focus_490k");
  const [term, setTerm] = useState<"monthly" | "6month">("monthly");
  const [onboardingTier, setOnboardingTier] = useState<"3month" | "5month" | "12month">("5month");
  const [countries, setCountries] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const isOnboarding = plan === "onboarding_onetime";
  const toggle = (c: string) => setCountries((v) => v.includes(c) ? v.filter((x) => x !== c) : [...v, c]);
  return (
    <div>
      <div className="space-y-2 mb-4">
        {deep.proposals.length === 0 && <p className="text-sm text-muted">발송된 제안이 없습니다.</p>}
        {deep.proposals.map((p) => (
          <div key={p.id} className="border rounded-lg p-3 text-sm flex justify-between">
            <span>v{p.version} · {p.plan} · {(p.countries ?? []).join(",")}</span>
            <span>{(p.quote_amount ?? p.amount ?? 0).toLocaleString("ko-KR")}원 · <b>{p.status}</b></span>
          </div>
        ))}
      </div>
      <div className="border-t pt-3">
        <div className="text-sm font-semibold mb-2">견적 빌더 <span className="text-xs text-muted font-normal">(computeQuote 단일 원천 · 수기 금액 금지)</span></div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="live_focus_490k">Live Focus 49만</option>
            <option value="guarantee_1m">Guarantee 100만</option>
            <option value="onboarding_onetime">온보딩 일회</option>
          </select>
          {isOnboarding ? (
            <select className="input" value={onboardingTier}
              onChange={(e) => setOnboardingTier(e.target.value as "3month" | "5month" | "12month")}>
              <option value="3month">3개월 티어</option>
              <option value="5month">5개월 티어</option>
              <option value="12month">12개월 티어</option>
            </select>
          ) : (
            <select className="input" value={term} onChange={(e) => setTerm(e.target.value as "monthly" | "6month")}>
              <option value="monthly">월간</option><option value="6month">6개월 약정 (-20%)</option>
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {COUNTRIES.map((c) => (
            <button key={c} onClick={() => toggle(c)}
              className={`px-2.5 py-1 rounded-full text-xs border ${countries.includes(c) ? "border-pink bg-[#fff0f6] text-pink" : "border-gray-300 text-muted"}`}>
              {countryLabel(c)}
            </button>
          ))}
        </div>
        {result && <div className="text-sm mb-2 p-2 bg-gray-50 rounded">{result}</div>}
        <button className="btn btn-primary" disabled={pending || countries.length === 0}
          onClick={() => start(async () => {
            const r = await createProposalAction({
              brand_id: brandId, plan, countries, term,
              onboardingTier: isOnboarding ? onboardingTier : undefined,
            });
            setResult(r.ok ? `생성됨: ${r.breakdown}` : (r.error ?? "실패"));
          })}>제안서 생성</button>
      </div>
    </div>
  );
}

// ── 회사정보 (10-A, 읽기) ──────────────────────────────────────
function Company({ deep }: { deep: CardDeep }) {
  const c = deep.company;
  if (!c) return <p className="text-sm text-muted">회사정보가 아직 없습니다. (apply SC-01 동기 또는 수기 입력)</p>;
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <Field label="법인명(국/영)" v={`${c.company_name_kr ?? "—"} / ${c.company_name_en ?? "—"}`} />
      <Field label="대표" v={c.rep_name} />
      <Field label="업태·종목" v={c.biz_category} />
      <Field label="주소" v={c.address_kr} />
      <Field label="세금계산서" v={`${c.tax_email ?? "—"} (${c.tax_cycle ?? "—"})`} />
      <Field label="정산계좌" v={c.bank_name ? `${c.bank_name} ${c.bank_holder ?? ""} ${c.bank_verified ? "✅" : "⚠미검증"}` : "—"} />
    </div>
  );
}
function Field({ label, v }: { label: string; v: string | null | undefined }) {
  return <div><div className="text-xs text-muted">{label}</div><div className="font-medium">{v || "—"}</div></div>;
}

// ── 자료 (10-E) ────────────────────────────────────────────────
function Assets({ deep }: { deep: CardDeep }) {
  if (deep.assets.length === 0) return <p className="text-sm text-muted">등록된 자료가 없습니다.</p>;
  return (
    <div className="space-y-1.5">
      {deep.assets.map((a) => (
        <div key={a.id} className="flex justify-between border rounded p-2 text-sm">
          <span><span className="pill bg-gray-100 text-xs mr-2">{a.kind}</span>{a.filename}</span>
          {(a.external_url || a.storage_url) && <a href={a.external_url ?? a.storage_url!} target="_blank" className="text-pink text-xs">열기</a>}
        </div>
      ))}
    </div>
  );
}

// ── 마케팅 프로젝트 (10-I) ─────────────────────────────────────
function Mkt({ deep }: { deep: CardDeep }) {
  if (deep.mktProjects.length === 0) return <p className="text-sm text-muted">마케팅 프로젝트가 없습니다.</p>;
  return (
    <div className="space-y-2">
      {deep.mktProjects.map((m) => (
        <div key={m.id} className="border rounded-lg p-3 text-sm flex justify-between">
          <span>{m.title} <span className="text-xs text-muted">({m.kind})</span></span>
          <span className="pill bg-gray-100">{m.proposal_status}</span>
        </div>
      ))}
    </div>
  );
}

// ── 미팅 (08) ──────────────────────────────────────────────────
function Meetings({ deep }: { deep: CardDeep }) {
  if (deep.meetings.length === 0) return <p className="text-sm text-muted">등록된 미팅이 없습니다. (Zoom 웹훅 연동 시 자동 표시)</p>;
  return (
    <div className="space-y-2">
      {deep.meetings.map((m) => (
        <div key={m.id} className="border rounded-lg p-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="font-medium">{m.topic || "제목 없음"}</span>
            <span className="flex gap-1">
              <span className="pill bg-gray-100">{m.status}</span>
              {m.followup_status !== "none" && <span className="pill bg-[#fff0f6] text-pink">팔로업 {m.followup_status}</span>}
            </span>
          </div>
          <div className="text-xs text-muted mt-1">
            {m.scheduled_at ? `예약 ${new Date(m.scheduled_at).toLocaleString("ko-KR")}` : ""}
            {m.started_at ? ` · 진행 ${new Date(m.started_at).toLocaleDateString("ko-KR")}` : ""}
          </div>
          {m.summary_md && (
            <details className="mt-2">
              <summary className="text-xs text-pink cursor-pointer">회의록 요약</summary>
              <pre className="mt-1 text-xs bg-gray-50 p-2 rounded whitespace-pre-wrap">{m.summary_md}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function roleKo(r: string) {
  return ({ main: "대표", marketing: "마케팅", logistics: "물류", settlement: "정산", etc: "기타" } as Record<string, string>)[r] ?? r;
}
function kindKo(k: string) {
  return ({ mall: "멀티몰", onboarding: "온보딩", guarantee: "Guarantee", marketing: "마케팅", marketing_retainer: "마케팅 리테이너" } as Record<string, string>)[k] ?? k;
}
