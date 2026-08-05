"use client";
// 온보딩 · KYC — 고객이 /apply 에서 제출 → 승인 시 원장 매핑된 값을 열람·편집.
//   담당자·채널·서류 URL 관리 + UBO/대리인/PEP/Payoneer + 이사·전자서명 열람 + 고객 작성링크 복사.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyAction } from "@/app/actions";
import type { Brand } from "@/lib/types";
import type { BrandCompany } from "@/lib/repo/card";

const D = (v: string | null | undefined): string => (v && String(v).trim() ? String(v) : "—");
const isUrl = (v: string | null | undefined) => !!v && /^https?:\/\//.test(v);

function UrlOrText({ v }: { v: string | null | undefined }) {
  if (!v) return <>—</>;
  return isUrl(v) ? <a href={v} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>링크 ↗</a> : <>{v}</>;
}

export default function Brand360Onboarding({ brand, company }: { brand: Brand; company: BrandCompany | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<"contact" | "docs" | "kyc" | null>(null);
  const [msg, setMsg] = useState("");
  const c = company;

  function save(patch: Record<string, unknown>) {
    start(async () => {
      const r = await saveCompanyAction(brand.id, patch);
      setMsg(r.ok ? "저장됨" : r.error ?? "실패");
      if (r.ok) setEdit(null);
      router.refresh();
    });
  }

  function copyLink() {
    const link = `${location.origin}/apply`;
    navigator.clipboard?.writeText(`온보딩 신청서 작성 링크: ${link}\n(담당자가 발급한 이메일 + 코드로 로그인)`);
    setMsg("작성 링크가 복사되었습니다");
    setTimeout(() => setMsg(""), 2500);
  }

  const synced = c?.onb_synced_at ? new Date(c.onb_synced_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : null;
  const directors = c?.directors_json ?? [];

  return (
    <div className="card" style={{ marginTop: 14, borderColor: "#c7f0e0" }}>
      <div className="hd" style={{ background: "linear-gradient(90deg,#effcf6,#fff)", flexWrap: "wrap" }}>
        <b>🧾 온보딩 · KYC</b>
        {c?.onb_application_id
          ? <span className="chip grn" style={{ fontSize: 10 }}>고객 제출 매핑됨{synced ? ` · ${synced}` : ""}</span>
          : <span className="chip amb" style={{ fontSize: 10 }}>고객 제출 없음 — 링크 발송 후 작성</span>}
        <div className="rt" style={{ display: "flex", gap: 6 }}>
          <button className="btn sm" onClick={copyLink}>고객 작성링크 복사</button>
          <a className="btn sm" href="/onboarding" target="_blank">계정·코드 발급 →</a>
        </div>
      </div>
      <div className="bd">
        {/* ── 담당자 · 채널 ── */}
        <div className="row2" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>담당자 · 샵/채널</b>
          <button className="btn sm" onClick={() => setEdit(edit === "contact" ? null : "contact")}>{edit === "contact" ? "닫기" : "수정"}</button>
        </div>
        {edit === "contact" ? (
          <form style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}
            onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
              save({ contact_name: String(f.get("contact_name") ?? ""), contact_email: String(f.get("contact_email") ?? ""), contact_phone: String(f.get("contact_phone") ?? ""),
                shop_name_kr: String(f.get("shop_name_kr") ?? ""), shop_name_en: String(f.get("shop_name_en") ?? ""),
                product_category: String(f.get("product_category") ?? ""), sales_channel_url: String(f.get("sales_channel_url") ?? ""), brand_logo_url: String(f.get("brand_logo_url") ?? "") }); }}>
            <input name="contact_name" className="f" defaultValue={c?.contact_name ?? ""} placeholder="담당자명" />
            <input name="contact_email" className="f" defaultValue={c?.contact_email ?? ""} placeholder="담당자 이메일" />
            <input name="contact_phone" className="f" defaultValue={c?.contact_phone ?? ""} placeholder="담당자 연락처" />
            <input name="product_category" className="f" defaultValue={c?.product_category ?? ""} placeholder="주요 카테고리" />
            <input name="shop_name_kr" className="f" defaultValue={c?.shop_name_kr ?? ""} placeholder="샵명(국문)" />
            <input name="shop_name_en" className="f" defaultValue={c?.shop_name_en ?? ""} placeholder="샵명(영문)" />
            <input name="sales_channel_url" className="f" defaultValue={c?.sales_channel_url ?? ""} placeholder="판매채널 URL" />
            <input name="brand_logo_url" className="f" defaultValue={c?.brand_logo_url ?? ""} placeholder="브랜드 로고 URL" />
            <button className="btn sm pri" disabled={pending} type="submit" style={{ gridColumn: "1 / -1" }}>저장</button>
          </form>
        ) : (
          <div className="kv">
            <dt>담당자</dt><dd>{D(c?.contact_name)} {c?.contact_email && `· ${c.contact_email}`} {c?.contact_phone && `· ${c.contact_phone}`}</dd>
            <dt>샵명</dt><dd>{[c?.shop_name_kr, c?.shop_name_en].filter(Boolean).join(" / ") || "—"}</dd>
            <dt>카테고리</dt><dd>{D(c?.product_category)}</dd>
            <dt>판매채널</dt><dd><UrlOrText v={c?.sales_channel_url} /></dd>
            <dt>로고</dt><dd><UrlOrText v={c?.brand_logo_url} /></dd>
          </div>
        )}

        <hr className="hr" />
        {/* ── 서류 URL ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>서류 (드라이브 링크)</b>
          <button className="btn sm" onClick={() => setEdit(edit === "docs" ? null : "docs")}>{edit === "docs" ? "닫기" : "수정"}</button>
        </div>
        {edit === "docs" ? (
          <form style={{ display: "grid", gap: 6 }}
            onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
              save({ doc_biz_reg_en_url: String(f.get("a") ?? ""), doc_biz_reg_kr_url: String(f.get("b") ?? ""), doc_corp_reg_kr_url: String(f.get("cc") ?? ""), doc_ownership_url: String(f.get("d") ?? ""), doc_logistics_url: String(f.get("e") ?? "") }); }}>
            <input name="a" className="f" defaultValue={c?.doc_biz_reg_en_url ?? ""} placeholder="사업자등록증(영문) URL" />
            <input name="b" className="f" defaultValue={c?.doc_biz_reg_kr_url ?? ""} placeholder="사업자등록증(국문) URL" />
            <input name="cc" className="f" defaultValue={c?.doc_corp_reg_kr_url ?? ""} placeholder="법인등기부(국문) URL" />
            <input name="d" className="f" defaultValue={c?.doc_ownership_url ?? ""} placeholder="지분/소유구조 URL" />
            <input name="e" className="f" defaultValue={c?.doc_logistics_url ?? ""} placeholder="물류계약 URL" />
            <button className="btn sm pri" disabled={pending} type="submit">저장</button>
          </form>
        ) : (
          <div className="kv">
            <dt>사업자등록증(영)</dt><dd><UrlOrText v={c?.doc_biz_reg_en_url} /></dd>
            <dt>사업자등록증(국)</dt><dd><UrlOrText v={c?.doc_biz_reg_kr_url} /></dd>
            <dt>법인등기부</dt><dd><UrlOrText v={c?.doc_corp_reg_kr_url} /></dd>
            <dt>지분/소유구조</dt><dd><UrlOrText v={c?.doc_ownership_url} /></dd>
            <dt>물류계약</dt><dd><UrlOrText v={c?.doc_logistics_url} /></dd>
          </div>
        )}

        <hr className="hr" />
        {/* ── UBO · 대리인 · PEP · Payoneer ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>UBO · 권한대리인 · PEP · Payoneer</b>
          <button className="btn sm" onClick={() => setEdit(edit === "kyc" ? null : "kyc")}>{edit === "kyc" ? "닫기" : "수정"}</button>
        </div>
        {edit === "kyc" ? (
          <form style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}
            onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
              save({ ubo_full_name: String(f.get("un") ?? ""), ubo_title: String(f.get("ut") ?? ""), ubo_birth: String(f.get("ub") ?? ""), ubo_country: String(f.get("uc") ?? ""), ubo_id_number: String(f.get("uid") ?? ""), ownership_structure: String(f.get("os") ?? ""),
                auth_name: String(f.get("an") ?? ""), auth_email: String(f.get("ae") ?? ""),
                pep_q1: String(f.get("p1") ?? ""), pep_q2: String(f.get("p2") ?? ""),
                payoneer_status: String(f.get("ps") ?? ""), payoneer_email: String(f.get("pe") ?? "") }); }}>
            <input name="un" className="f" defaultValue={c?.ubo_full_name ?? ""} placeholder="UBO 성명" />
            <input name="ut" className="f" defaultValue={c?.ubo_title ?? ""} placeholder="UBO 직책" />
            <input name="ub" className="f" defaultValue={c?.ubo_birth ?? ""} placeholder="UBO 생년월일" />
            <input name="uc" className="f" defaultValue={c?.ubo_country ?? ""} placeholder="UBO 국적" />
            <input name="uid" className="f" defaultValue={c?.ubo_id_number ?? ""} placeholder="UBO 신분증번호" />
            <input name="os" className="f" defaultValue={c?.ownership_structure ?? ""} placeholder="지분구조" />
            <input name="an" className="f" defaultValue={c?.auth_name ?? ""} placeholder="권한대리인 성명" />
            <input name="ae" className="f" defaultValue={c?.auth_email ?? ""} placeholder="권한대리인 이메일" />
            <select name="p1" className="f" defaultValue={c?.pep_q1 ?? "no"}><option value="no">PEP 아니오</option><option value="yes">PEP 예</option></select>
            <select name="p2" className="f" defaultValue={c?.pep_q2 ?? "no"}><option value="no">제재대상 아니오</option><option value="yes">제재대상 예</option></select>
            <select name="ps" className="f" defaultValue={c?.payoneer_status ?? "none"}><option value="none">Payoneer 미개설</option><option value="applied">신청중</option><option value="active">개설완료</option></select>
            <input name="pe" className="f" defaultValue={c?.payoneer_email ?? ""} placeholder="Payoneer 이메일" />
            <button className="btn sm pri" disabled={pending} type="submit" style={{ gridColumn: "1 / -1" }}>저장</button>
          </form>
        ) : (
          <div className="kv">
            <dt>UBO</dt><dd>{D(c?.ubo_full_name)} {c?.ubo_title && `· ${c.ubo_title}`} {c?.ubo_country && `· ${c.ubo_country}`}</dd>
            <dt>지분구조</dt><dd>{D(c?.ownership_structure)}</dd>
            <dt>권한대리인</dt><dd>{D(c?.auth_name)} {c?.auth_email && `· ${c.auth_email}`}</dd>
            <dt>PEP</dt><dd>본인/가족 {c?.pep_q1 === "yes" ? "⚠️ 예" : "아니오"} · 제재 {c?.pep_q2 === "yes" ? "⚠️ 예" : "아니오"}</dd>
            <dt>Payoneer</dt><dd>{{ active: "개설완료", applied: "신청중", none: "미개설" }[c?.payoneer_status ?? "none"] ?? D(c?.payoneer_status)}{c?.payoneer_email && ` · ${c.payoneer_email}`}</dd>
          </div>
        )}

        {/* ── 이사 · 전자서명 (열람) ── */}
        {(directors.length > 0 || c?.ubo_signature_data) && (
          <>
            <hr className="hr" />
            <div style={{ display: "grid", gridTemplateColumns: directors.length && c?.ubo_signature_data ? "1fr 1fr" : "1fr", gap: 14 }}>
              {directors.length > 0 && (
                <div>
                  <b style={{ fontSize: 11.5, color: "var(--ink3)" }}>이사(등기임원)</b>
                  <ul style={{ margin: "6px 0 0 16px", fontSize: 12.5, lineHeight: 1.7 }}>
                    {directors.map((d, i) => <li key={i}>{d.name || "(무명)"} {d.is_ubo && "· UBO"} {d.country && `· ${d.country}`} {d.id_number && `· ${d.id_number}`}</li>)}
                  </ul>
                </div>
              )}
              {c?.ubo_signature_data && (
                <div>
                  <b style={{ fontSize: 11.5, color: "var(--ink3)" }}>전자서명{c.ubo_signed_at && ` · ${new Date(c.ubo_signed_at).toLocaleDateString("ko-KR")}`}</b>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.ubo_signature_data} alt="서명" style={{ display: "block", width: 220, border: "1px solid var(--line)", borderRadius: 8, marginTop: 6, background: "#fff" }} />
                </div>
              )}
            </div>
          </>
        )}

        <div className="note" style={{ marginTop: 10 }}>고객이 <b>/apply</b> 에서 제출한 정보가 승인 시 여기로 매핑됩니다. 매핑 후에도 원장에서 직접 보정할 수 있습니다(담당자·서류 URL·KYC).</div>
        {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  );
}
