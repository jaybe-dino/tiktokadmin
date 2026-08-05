"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewStepAction, approveApplicationAction } from "../actions";

interface Step { step_no: number; status: string; admin_feedback: string }
interface Director { id: string; is_ubo: boolean; name: string; birth: string; country: string; id_type: string; id_number: string }
interface Warehouse { id: string; country: string; region: string; contact: string; phone: string; address: string; contract_url: string }
interface ProductCountry { id: string; country_code: string; unit_price: string; currency: string; cert_status: string; translation_status: string }
interface Product { id: string; name: string; category: string; sku: string; description_kr: string; main_image_url: string }

interface Props {
  applicationId: string; appStatus: string; hasBrand: boolean;
  app: Record<string, unknown>;
  steps: Step[]; directors: Director[]; warehouses: Warehouse[];
  products: Product[]; productCountries: Record<string, ProductCountry[]>;
}

const STEP_TITLES = ["회사 정보", "수익소유자(UBO)·이사", "권한대리인·PEP·서명", "제품·창고"];

// 스텝별 표시 필드(라벨, 키)
const STEP_VIEW: Record<number, [string, string][]> = {
  1: [["상호(국문)", "company_name_kr"], ["상호(영문)", "company_name_en"], ["사업자유형", "company_type"], ["국가", "company_country"], ["설립일", "company_reg_date"], ["사업자번호", "company_reg_number"], ["담당자", "contact_name"], ["담당이메일", "contact_email"], ["담당연락처", "contact_phone"], ["주소(국문)", "address_kr"], ["주소(영문)", "address_en"], ["운영주소", "op_address_en"], ["샵명(국문)", "shop_name_kr"], ["샵명(영문)", "shop_name_en"], ["로고", "brand_logo_url"], ["카테고리", "product_category"], ["판매채널", "sales_channel_url"], ["사업자등록증(영문)", "doc_biz_reg_en_url"], ["사업자등록증(국문)", "doc_biz_reg_kr_url"], ["법인등기부", "doc_corp_reg_kr_url"], ["지분증빙", "doc_ownership_url"], ["물류증빙", "doc_logistics_url"]],
  2: [["UBO 성명", "ubo_full_name"], ["직책", "ubo_title"], ["생년월일", "ubo_birth"], ["국적", "ubo_country"], ["신분증종류", "ubo_id_type"], ["신분증번호", "ubo_id_number"], ["신분증앞", "ubo_id_front_url"], ["신분증뒤", "ubo_id_back_url"], ["주소증빙", "ubo_address_proof_url"], ["지분구조", "ownership_structure"]],
  3: [["서명자유형", "auth_type"], ["성명", "auth_name"], ["생년월일", "auth_birth"], ["국적", "auth_country"], ["이메일", "auth_email"], ["신분증종류", "auth_id_type"], ["신분증번호", "auth_id_number"], ["신분증앞", "auth_id_front_url"], ["신분증뒤", "auth_id_back_url"], ["주소증빙", "auth_address_proof_url"], ["위임장(LOA)", "auth_loa_url"], ["PEP1", "pep_q1"], ["PEP2", "pep_q2"], ["Payoneer상태", "payoneer_status"], ["Payoneer이메일", "payoneer_email"]],
};

function isUrl(v: string) { return /^https?:\/\//.test(v); }

export default function ReviewClient(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<Record<number, string>>({});
  const [toast, setToast] = useState("");
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  async function review(stepNo: number, decision: "approve" | "reject") {
    if (decision === "reject" && !(fb[stepNo] ?? "").trim()) { flash("반려 사유를 입력하세요."); return; }
    setBusy(true);
    const r = await reviewStepAction(props.applicationId, stepNo, decision, fb[stepNo] ?? "");
    setBusy(false);
    if (r.ok) { flash(decision === "approve" ? "승인했습니다." : "반려했습니다."); router.refresh(); }
    else flash(r.error ?? "처리 실패");
  }
  async function approveAll() {
    if (!props.hasBrand) { flash("먼저 목록에서 브랜드를 연결하세요."); return; }
    if (!confirm("신청서를 최종 승인하고 회사정보·제품을 브랜드 원장에 매핑합니다. 진행할까요?")) return;
    setBusy(true);
    const r = await approveApplicationAction(props.applicationId);
    setBusy(false);
    if (r.ok) { flash(`승인 완료 — 제품 ${r.mappedProducts ?? 0}건 매핑됨`); router.refresh(); }
    else flash(r.error ?? "승인 실패");
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
            </div>

            {s.status === "locked" ? (
              <div style={{ color: "var(--ink2)", fontSize: 13 }}>아직 고객이 도달하지 않은 단계입니다.</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px 18px" }}>
                  {view.map(([label, k]) => {
                    const v = props.app[k] == null ? "" : String(props.app[k]);
                    if (!v) return null;
                    return (
                      <div key={k} style={{ fontSize: 13 }}>
                        <span style={{ color: "var(--ink2)", fontSize: 11 }}>{label}</span>
                        <div style={{ wordBreak: "break-all" }}>
                          {isUrl(v) ? <a href={v} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>링크 열기 ↗</a> : v}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 스텝별 서브 콜렉션 */}
                {s.step_no === 2 && props.directors.length > 0 && (
                  <SubList title="이사">
                    {props.directors.map((d) => <li key={d.id}>{d.name} {d.is_ubo && "(UBO)"} · {d.country} · {d.id_type} {d.id_number}</li>)}
                  </SubList>
                )}
                {s.step_no === 3 && props.app.ubo_signature_data ? (
                  <div style={{ marginTop: 12 }}>
                    <span style={{ color: "var(--ink2)", fontSize: 11 }}>전자서명</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={String(props.app.ubo_signature_data)} alt="서명" style={{ display: "block", width: 260, border: "1px solid var(--line)", borderRadius: 8, marginTop: 4, background: "#fff" }} />
                  </div>
                ) : null}
                {s.step_no === 4 && (
                  <>
                    {props.products.length > 0 ? (
                      <SubList title="제품">
                        {props.products.map((p) => (
                          <li key={p.id}>
                            {p.name} · {p.category} {p.sku && `· ${p.sku}`}
                            {(props.productCountries[p.id]?.length ?? 0) > 0 && (
                              <span style={{ color: "var(--ink2)" }}> — {props.productCountries[p.id].map((c) => `${c.country_code}(${c.cert_status})`).join(", ")}</span>
                            )}
                          </li>
                        ))}
                      </SubList>
                    ) : <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8 }}>등록된 제품이 없습니다.</div>}
                    {props.warehouses.length > 0 && (
                      <SubList title="창고">
                        {props.warehouses.map((w) => <li key={w.id}>{w.country} {w.region} · {w.contact} {w.phone}</li>)}
                      </SubList>
                    )}
                  </>
                )}

                {s.admin_feedback && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#c25400", background: "#fff5eb", borderRadius: 8, padding: "7px 10px" }}>반려 사유: {s.admin_feedback}</div>
                )}
                {reviewable && (
                  <input value={fb[s.step_no] ?? ""} onChange={(e) => setFb({ ...fb, [s.step_no]: e.target.value })}
                    placeholder="반려 시 사유(고객에게 표시)" style={{ width: "100%", marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "var(--bg)", boxSizing: "border-box" }} />
                )}
              </>
            )}
          </div>
        );
      })}

      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--ink2)" }}>
          {props.appStatus === "approved" ? "이미 승인되어 브랜드 원장에 매핑되었습니다."
            : props.hasBrand ? "모든 단계 검토 후, 회사정보·제품을 브랜드 원장에 반영합니다."
            : "⚠️ 브랜드가 연결되지 않았습니다. 목록에서 브랜드를 먼저 연결하세요."}
        </div>
        <button className="btn primary" disabled={busy || props.appStatus === "approved" || !props.hasBrand} onClick={approveAll} style={{ marginLeft: "auto" }}>
          전체 승인 &amp; 원장 매핑
        </button>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13, zIndex: 50 }}>{toast}</div>}
    </div>
  );
}

function SubList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: "var(--ink2)", fontSize: 11, marginBottom: 4 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>{children}</ul>
    </div>
  );
}

function statusLabel(s: string) { return { locked: "잠김", unlocked: "작성중", draft: "작성중", submitted: "검토대기", approved: "승인", rejected: "반려" }[s] ?? s; }
function statusColor(s: string) { return { locked: "#999", unlocked: "#4dabf7", draft: "#4dabf7", submitted: "#f0a02c", approved: "#12b886", rejected: "#e03131" }[s] ?? "#888"; }
