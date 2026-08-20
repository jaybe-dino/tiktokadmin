"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewStepAction, approveApplicationAction, setStepLockAction } from "../actions";

interface Step { step_no: number; status: string; admin_feedback: string }
interface Country { id: string; country_code: string; country_name: string; shop_type: string; shop_url: string; monthly_revenue: string; product_cert_status: string; product_cert_note: string; logistics_status: string; logistics_note: string; logistics_contract_url: string; logistics_option: string; logistics_local_address?: string; logistics_contract_info?: string }
interface ProductCountry { id: string; country_code: string; unit_price: string; currency: string; cert_status: string; cert_note: string; cert_file_url: string; detail_page_kr: string }
interface Product { id: string; name: string; category: string; sku: string; description_kr: string }
interface Props {
  applicationId: string; customerId: string; appStatus: string; hasBrand: boolean;
  app: Record<string, unknown>;
  steps: Step[]; countries: Country[]; products: Product[]; productCountries: Record<string, ProductCountry[]>;
}

const STEP_TITLES = ["기본신청", "수권서 서명", "회사 추가정보", "제품 등록", "물류 계약서"];

// 스텝별 표시 필드(라벨, 키)
const STEP_VIEW: Record<number, [string, string][]> = {
  1: [["회사명(한글)", "company_name_kr"], ["회사명(영문)", "company_name_en"], ["사업자형태", "company_type"], ["등록국가", "company_country"], ["법인등록일", "company_reg_date"], ["사업자번호", "company_reg_number"], ["담당자", "contact_name"], ["담당이메일", "contact_email"], ["담당연락처", "contact_phone"], ["주소(한글)", "address_kr"], ["주소(영문)", "address_en"], ["운영주소", "op_address_en"], ["브랜드명(한글)", "shop_name_kr"], ["브랜드명(영문)", "shop_name_en"], ["카테고리", "product_category"], ["판매채널", "sales_channel_url"], ["로고", "brand_logo_url"], ["대표자(영문)", "ubo_full_name"], ["직책", "ubo_title"], ["사업자등록증(영)", "doc_biz_reg_en_url"], ["사업자등록증(한)", "doc_biz_reg_kr_url"], ["법인등기부", "doc_corp_reg_kr_url"]],
  2: [],
  3: [["지분구조", "ownership_structure"], ["대표자여권", "rep_passport_front_url"], ["신분증앞", "rep_id_front_url"], ["신분증뒤", "rep_id_back_url"], ["거주지증명", "rep_address_proof_url"], ["핑퐁상태", "payoneer_status"], ["핑퐁이메일", "payoneer_email"], ["핑퐁메모", "payoneer_note"]],
};
const READY: Record<string, string> = { none: "없음", preparing: "준비중", ready: "완료" };
const LOGI_OPT: Record<string, string> = { fba: "FBA (아마존 물류)", local_warehouse: "현지 물류창고 계약", cross_border: "한국 크로스보더 배송", self_delivery: "직배송", flash_intro: "플래시 소개" };
const isUrl = (v: string) => /^(https?:\/\/|\/api\/)/.test(v);

export default function ReviewClient(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<Record<number, string>>({});
  const [toast, setToast] = useState("");
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  async function review(stepNo: number, decision: "approve" | "reject" | "unapprove") {
    if (decision === "reject" && !(fb[stepNo] ?? "").trim()) { flash("반려 사유를 입력하세요."); return; }
    if (decision === "unapprove" && !confirm("이 단계의 승인을 취소하고 검토중으로 되돌립니다. 진행할까요?")) return;
    setBusy(true);
    const r = await reviewStepAction(props.applicationId, stepNo, decision, fb[stepNo] ?? "");
    setBusy(false);
    if (r.ok) { flash(decision === "approve" ? "승인했습니다." : decision === "unapprove" ? "승인을 취소했습니다." : "반려했습니다."); router.refresh(); } else flash(r.error ?? "처리 실패");
  }
  async function toggleLock(stepNo: number, lock: boolean) {
    if (!lock && !confirm("이 단계의 잠금을 해제합니다. 브랜드사가 바로 작성할 수 있게 됩니다. 진행할까요?")) return;
    setBusy(true);
    const r = await setStepLockAction(props.applicationId, stepNo, lock);
    setBusy(false);
    if (r.ok) { flash(lock ? "다시 잠갔습니다." : "잠금을 해제했습니다 — 브랜드사 작성 가능."); router.refresh(); } else flash(r.error ?? "처리 실패");
  }
  async function approveAll() {
    if (!props.hasBrand) { flash("먼저 목록에서 브랜드를 연결하세요."); return; }
    if (!confirm("신청서를 최종 승인하고 회사정보·제품·국가·물류를 브랜드 원장에 매핑합니다. 진행할까요?")) return;
    setBusy(true);
    const r = await approveApplicationAction(props.applicationId);
    setBusy(false);
    if (r.ok) { flash(`승인 완료 — 제품 ${r.mappedProducts ?? 0} · 국가 ${r.mappedCountries ?? 0} 매핑됨`); router.refresh(); } else flash(r.error ?? "승인 실패");
  }

  return (
    <div>
      {props.steps.map((s) => {
        const view = STEP_VIEW[s.step_no] ?? [];
        const reviewable = s.status === "submitted";
        return (
          <div key={s.step_no} className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{s.step_no}. {STEP_TITLES[s.step_no - 1]}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(s.status) }}>· {statusLabel(s.status)}</span>
              {reviewable && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="btn sm" disabled={busy} onClick={() => review(s.step_no, "reject")} style={{ color: "#e03131" }}>반려</button>
                  <button className="btn sm primary" disabled={busy} onClick={() => review(s.step_no, "approve")}>승인</button>
                </div>
              )}
              {s.status === "approved" && (
                <div style={{ marginLeft: "auto" }}>
                  <button className="btn sm" disabled={busy} onClick={() => review(s.step_no, "unapprove")} style={{ color: "#c25400" }}>승인취소</button>
                </div>
              )}
              {s.status === "locked" && (
                <div style={{ marginLeft: "auto" }}>
                  <button className="btn sm primary" disabled={busy} onClick={() => toggleLock(s.step_no, false)}>🔓 잠금 해제</button>
                </div>
              )}
              {s.status === "unlocked" && (
                <div style={{ marginLeft: "auto" }}>
                  <button className="btn sm" disabled={busy} onClick={() => toggleLock(s.step_no, true)} style={{ color: "#64748b" }} title="수동 잠금해제 되돌리기(미제출 단계만)">🔒 다시 잠금</button>
                </div>
              )}
            </div>

            {s.status === "locked" ? (
              <div style={{ color: "var(--ink2)", fontSize: 13 }}>
                아직 고객이 도달하지 않은 단계입니다. 담당자가 <b>[🔓 잠금 해제]</b>를 누르면 이전 단계 승인 없이도 브랜드사가 바로 작성할 수 있습니다.
              </div>
            ) : (
              <>
                {view.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px 18px" }}>
                    {view.map(([label, k]) => {
                      const val = props.app[k] == null ? "" : String(props.app[k]);
                      if (!val) return null;
                      return (
                        <div key={k} style={{ fontSize: 13 }}>
                          <span style={{ color: "var(--ink2)", fontSize: 11 }}>{label}</span>
                          <div style={{ wordBreak: "break-all" }}>{isUrl(val) ? <a href={val} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>파일/링크 ↗</a> : val}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Step1 국가 매트릭스 */}
                {s.step_no === 1 && props.countries.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "var(--ink2)", fontSize: 11, marginBottom: 4 }}>입점 희망 국가</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                      {props.countries.map((c) => (
                        <li key={c.id}>{c.country_code} · 영업 {c.shop_type}{c.monthly_revenue && ` (${c.monthly_revenue})`} · 인증 {READY[c.product_cert_status] ?? c.product_cert_status} · 물류 {READY[c.logistics_status] ?? c.logistics_status}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Step2 서명 */}
                {s.step_no === 2 && props.app.ubo_signature_data ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ color: "var(--ink2)", fontSize: 11 }}>전자서명 (LOA)</span>
                      <a className="btn sm primary" href={`/api/onboarding/loa/${props.customerId}`}>⬇️ LOA 수권서 PDF 다운로드</a>
                      <a className="btn sm" href={`/onboarding/${props.customerId}/loa`} target="_blank" rel="noreferrer">문서 보기 ↗</a>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={String(props.app.ubo_signature_data)} alt="서명" style={{ display: "block", width: 260, border: "1px solid var(--line)", borderRadius: 8, marginTop: 6, background: "#fff" }} />
                  </div>
                ) : s.step_no === 2 ? <div style={{ fontSize: 13, color: "var(--ink2)" }}>아직 서명이 없습니다.</div> : null}

                {/* Step4 제품 */}
                {s.step_no === 4 && (props.products.length > 0 ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                    {props.products.map((p) => (
                      <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontSize: 13 }}>
                        <b>{p.name}</b> {p.category && `· ${p.category}`} {p.sku && `· ${p.sku}`}
                        {(props.productCountries[p.id]?.length ?? 0) > 0 && (
                          <ul style={{ margin: "6px 0 0 16px", color: "var(--ink2)", fontSize: 12.5 }}>
                            {props.productCountries[p.id].map((pc) => (
                              <li key={pc.id}>{pc.country_code} · {pc.currency} {pc.unit_price || "-"} · 인증 {READY[pc.cert_status] ?? pc.cert_status}{pc.cert_file_url && " · 첨부✓"}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <div style={{ fontSize: 13, color: "var(--ink2)" }}>등록된 제품이 없습니다.</div>)}

                {/* Step5 물류 */}
                {s.step_no === 5 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                    {props.countries.map((c) => (
                      <li key={c.id}>
                        {c.country_code} · {LOGI_OPT[c.logistics_option] ?? "방식 미선택"} · {c.logistics_contract_url ? <a href={c.logistics_contract_url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>계약서 ↗</a> : <span style={{ color: "var(--ink2)" }}>미업로드</span>}
                        {c.logistics_local_address && <div style={{ color: "var(--ink2)", fontSize: 12 }}>현지주소: {c.logistics_local_address}</div>}
                        {c.logistics_contract_info && <div style={{ color: "var(--ink2)", fontSize: 12 }}>계약정보: {c.logistics_contract_info}</div>}
                      </li>
                    ))}
                  </ul>
                )}

                {s.admin_feedback && <div style={{ marginTop: 10, fontSize: 12, color: "#c25400", background: "#fff5eb", borderRadius: 8, padding: "7px 10px" }}>반려 사유: {s.admin_feedback}</div>}
                {reviewable && <input value={fb[s.step_no] ?? ""} onChange={(e) => setFb({ ...fb, [s.step_no]: e.target.value })} placeholder="반려 시 사유(고객에게 표시)" style={{ width: "100%", marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "var(--bg)", boxSizing: "border-box" }} />}
              </>
            )}
          </div>
        );
      })}

      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--ink2)" }}>
          {props.appStatus === "approved" ? "이미 승인되어 브랜드 원장에 매핑되었습니다."
            : props.hasBrand ? "모든 단계 검토 후, 회사정보·제품·국가·물류를 브랜드 원장에 반영합니다."
            : "⚠️ 브랜드가 연결되지 않았습니다. 목록에서 브랜드를 먼저 연결하세요."}
        </div>
        <button className="btn primary" disabled={busy || props.appStatus === "approved" || !props.hasBrand} onClick={approveAll} style={{ marginLeft: "auto" }}>전체 승인 &amp; 원장 매핑</button>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13, zIndex: 50 }}>{toast}</div>}
    </div>
  );
}

function statusLabel(s: string) { return { locked: "잠김", unlocked: "작성 가능", draft: "작성 가능", submitted: "검토중", approved: "승인", rejected: "반려" }[s] ?? s; }
function statusColor(s: string) { return { locked: "#999", unlocked: "#2563eb", draft: "#2563eb", submitted: "#c2410c", approved: "#0b7a52", rejected: "#e03131" }[s] ?? "#888"; }
