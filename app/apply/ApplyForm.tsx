"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  saveStepAction, submitStepAction,
  addDirectorAction, deleteDirectorAction,
  addWarehouseAction, deleteWarehouseAction,
  addProductAction, updateProductAction, deleteProductAction,
} from "./actions";

// ── 타입(서버 lib 와 동일 형태, 클라 전용 복제) ──
interface Step { step_no: number; status: string; admin_feedback: string }
interface Director { id: string; is_ubo: boolean; name: string; birth: string; country: string; id_type: string; id_number: string }
interface Warehouse { id: string; country: string; region: string; contact: string; phone: string; address: string; contract_url: string }
interface ProductCountry { id: string; product_id: string; country_code: string; unit_price: string; currency: string; cert_status: string; cert_note: string; cert_file_url: string; detail_page_kr: string; detail_page_translated: string; translation_status: string }
interface Product { id: string; name: string; category: string; sku: string; description_kr: string; main_image_url: string }

interface Props {
  email: string;
  app: Record<string, unknown>;
  steps: Step[];
  directors: Director[];
  warehouses: Warehouse[];
  products: Product[];
  productCountries: Record<string, ProductCountry[]>;
}

const STEP_TITLES = ["회사 정보", "수익소유자(UBO)·이사", "권한대리인·PEP·서명", "제품·창고"];
const ACCENT = "#12b886";

function sv(app: Record<string, unknown>, k: string): string {
  const v = app[k];
  return v == null ? "" : String(v);
}

export default function ApplyForm(props: Props) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const steps = props.steps.length ? props.steps : [1, 2, 3, 4].map((n) => ({ step_no: n, status: n === 1 ? "unlocked" : "locked", admin_feedback: "" }));
  const step = steps[active];
  const editable = step.status === "unlocked" || step.status === "rejected" || step.status === "draft";
  const submitted = step.status === "submitted";
  const approved = step.status === "approved";
  const locked = step.status === "locked";

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    ALL_FIELDS.forEach((f) => { init[f] = sv(props.app, f); });
    return init;
  });
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  async function save(stepNo: number, keys: string[]) {
    setBusy(true);
    const payload: Record<string, string> = {};
    keys.forEach((k) => { payload[k] = values[k] ?? ""; });
    const r = await saveStepAction(stepNo, payload);
    setBusy(false);
    if (r.ok) flash("저장되었습니다."); else flash(r.error ?? "저장 실패");
    return r.ok;
  }
  async function submit(stepNo: number, keys: string[]) {
    if (!confirm("제출하면 이 단계는 수정할 수 없으며 담당자 검토가 시작됩니다. 제출할까요?")) return;
    const ok = await save(stepNo, keys);
    if (!ok) return;
    setBusy(true);
    const r = await submitStepAction(stepNo);
    setBusy(false);
    if (r.ok) { flash("제출되었습니다. 검토를 기다려주세요."); router.refresh(); }
    else flash(r.error ?? "제출 실패");
  }

  async function logout() {
    await fetch("/api/apply/logout", { method: "POST" });
    router.replace("/apply/login"); router.refresh();
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* 헤더 */}
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 4px 14px" }}>
        <span style={{ color: ACCENT, fontWeight: 800, fontSize: 15 }}>TikTok Shop 온보딩</span>
        <span style={{ color: "#8b93a1", fontSize: 13, marginLeft: "auto" }}>{props.email}</span>
        <button onClick={logout} style={{ background: "transparent", color: "#8b93a1", border: "1px solid #2a2f3a", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>로그아웃</button>
      </header>

      {/* 스텝 진행바 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {steps.map((s, i) => (
          <button key={s.step_no} onClick={() => setActive(i)}
            style={{
              flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 12, cursor: "pointer",
              border: i === active ? `1.5px solid ${ACCENT}` : "1px solid #2a2f3a",
              background: i === active ? "#12271f" : "#171a21", color: "#e6e9ef",
            }}>
            <div style={{ fontSize: 11, color: statusColor(s.status) }}>{i + 1}단계 · {statusLabel(s.status)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{STEP_TITLES[i]}</div>
          </button>
        ))}
      </div>

      {/* 반려 피드백 */}
      {step.status === "rejected" && step.admin_feedback && (
        <Banner tone="warn">담당자 반려 사유: {step.admin_feedback}</Banner>
      )}
      {locked && <Banner tone="mute">이전 단계가 승인되면 열립니다.</Banner>}
      {submitted && <Banner tone="info">제출 완료 — 담당자 검토 중입니다. (수정 불가)</Banner>}
      {approved && <Banner tone="ok">이 단계는 승인되었습니다.</Banner>}

      {/* 본문 */}
      <div style={{ background: "#171a21", border: "1px solid #232833", borderRadius: 16, padding: 22 }}>
        {locked ? (
          <div style={{ color: "#6b7280", fontSize: 14, textAlign: "center", padding: "40px 0" }}>🔒 잠긴 단계입니다.</div>
        ) : active === 0 ? (
          <Step1 values={values} set={set} disabled={!editable} />
        ) : active === 1 ? (
          <Step2 values={values} set={set} disabled={!editable} directors={props.directors} onChange={() => router.refresh()} flash={flash} />
        ) : active === 2 ? (
          <Step3 values={values} set={set} disabled={!editable} />
        ) : (
          <Step4 products={props.products} productCountries={props.productCountries} warehouses={props.warehouses} disabled={!editable} onChange={() => router.refresh()} flash={flash} />
        )}

        {/* 액션 */}
        {editable && (
          <div style={{ display: "flex", gap: 10, marginTop: 24, borderTop: "1px solid #232833", paddingTop: 18 }}>
            <button disabled={busy} onClick={() => save(step.step_no, STEP_KEYS[active])}
              style={{ background: "#232833", color: "#e6e9ef", border: 0, borderRadius: 10, padding: "12px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
              임시저장
            </button>
            <button disabled={busy} onClick={() => submit(step.step_no, STEP_KEYS[active])}
              style={{ background: ACCENT, color: "#fff", border: 0, borderRadius: 10, padding: "12px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", marginLeft: "auto", opacity: busy ? 0.6 : 1 }}>
              제출하고 검토 요청
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13, boxShadow: "0 6px 24px rgba(0,0,0,.5)", zIndex: 50 }}>{toast}</div>
      )}
    </div>
  );
}

// ══════════ Step 1 — 회사 정보 ══════════
function Step1({ values, set, disabled }: FieldProps) {
  return (
    <Section title="회사 기본 정보" desc="사업자등록증 상의 정보를 정확히 입력하세요.">
      <Grid>
        <F label="상호(국문)" k="company_name_kr" {...{ values, set, disabled }} />
        <F label="상호(영문)" k="company_name_en" {...{ values, set, disabled }} />
        <Sel label="사업자 유형" k="company_type" options={[["company", "법인"], ["individual", "개인사업자"]]} {...{ values, set, disabled }} />
        <Sel label="국가" k="company_country" options={[["KR", "대한민국"], ["US", "미국"], ["OTHER", "기타"]]} {...{ values, set, disabled }} />
        <F label="설립/개업일" k="company_reg_date" placeholder="YYYY-MM-DD" {...{ values, set, disabled }} />
        <F label="사업자등록번호" k="company_reg_number" {...{ values, set, disabled }} />
      </Grid>
      <Section title="담당자" sub>
        <Grid>
          <F label="담당자명" k="contact_name" {...{ values, set, disabled }} />
          <F label="담당자 이메일" k="contact_email" {...{ values, set, disabled }} />
          <F label="담당자 연락처" k="contact_phone" {...{ values, set, disabled }} />
        </Grid>
      </Section>
      <Section title="주소" sub>
        <F label="주소(국문)" k="address_kr" full {...{ values, set, disabled }} />
        <F label="주소(영문)" k="address_en" full {...{ values, set, disabled }} />
        <F label="운영/물류 주소(영문)" k="op_address_en" full {...{ values, set, disabled }} />
      </Section>
      <Section title="브랜드/샵" sub>
        <Grid>
          <F label="샵명(국문)" k="shop_name_kr" {...{ values, set, disabled }} />
          <F label="샵명(영문)" k="shop_name_en" {...{ values, set, disabled }} />
          <F label="브랜드 로고 URL" k="brand_logo_url" {...{ values, set, disabled }} />
          <F label="주요 제품 카테고리" k="product_category" {...{ values, set, disabled }} />
          <F label="판매 채널 URL" k="sales_channel_url" full {...{ values, set, disabled }} />
        </Grid>
      </Section>
      <Section title="서류 (드라이브 공유 링크)" sub desc="열람 권한이 있는 공유 링크를 붙여넣으세요.">
        <F label="사업자등록증(영문)" k="doc_biz_reg_en_url" full {...{ values, set, disabled }} />
        <F label="사업자등록증(국문)" k="doc_biz_reg_kr_url" full {...{ values, set, disabled }} />
        <F label="법인등기부등본(국문)" k="doc_corp_reg_kr_url" full {...{ values, set, disabled }} />
        <F label="지분/소유구조 증빙" k="doc_ownership_url" full {...{ values, set, disabled }} />
        <F label="물류계약 증빙" k="doc_logistics_url" full {...{ values, set, disabled }} />
      </Section>
    </Section>
  );
}

// ══════════ Step 2 — UBO + 이사 ══════════
function Step2({ values, set, disabled, directors, onChange, flash }: FieldProps & { directors: Director[]; onChange: () => void; flash: (m: string) => void }) {
  const [draft, setDraft] = useState<Partial<Director>>({ id_type: "passport" });
  async function add() {
    if (!draft.name) { flash("이사 이름을 입력하세요."); return; }
    const r = await addDirectorAction(draft);
    if (r.ok) { setDraft({ id_type: "passport" }); onChange(); flash("이사가 추가되었습니다."); } else flash(r.error ?? "추가 실패");
  }
  async function del(id: string) {
    const r = await deleteDirectorAction(id); if (r.ok) { onChange(); flash("삭제되었습니다."); }
  }
  return (
    <Section title="수익소유자(UBO)" desc="지분 25% 이상 또는 실질 지배자를 입력하세요.">
      <Grid>
        <F label="성명" k="ubo_full_name" {...{ values, set, disabled }} />
        <F label="직책" k="ubo_title" {...{ values, set, disabled }} />
        <F label="생년월일" k="ubo_birth" placeholder="YYYY-MM-DD" {...{ values, set, disabled }} />
        <F label="국적" k="ubo_country" {...{ values, set, disabled }} />
        <Sel label="신분증 종류" k="ubo_id_type" options={[["passport", "여권"], ["id_card", "주민등록증"], ["driver", "운전면허"]]} {...{ values, set, disabled }} />
        <F label="신분증 번호" k="ubo_id_number" {...{ values, set, disabled }} />
      </Grid>
      <Grid>
        <F label="신분증 앞면 URL" k="ubo_id_front_url" {...{ values, set, disabled }} />
        <F label="신분증 뒷면 URL" k="ubo_id_back_url" {...{ values, set, disabled }} />
        <F label="주소증빙 URL" k="ubo_address_proof_url" {...{ values, set, disabled }} />
      </Grid>
      <F label="지분 구조 설명" k="ownership_structure" full textarea {...{ values, set, disabled }} />

      <Section title="이사(등기임원)" sub desc="법인 등기부상 이사를 모두 추가하세요.">
        {directors.length === 0 && <Empty>등록된 이사가 없습니다.</Empty>}
        {directors.map((d) => (
          <Row key={d.id}>
            <span style={{ flex: 1 }}>{d.name} {d.is_ubo && <Tag>UBO</Tag>}</span>
            <span style={{ color: "#8b93a1", fontSize: 12 }}>{d.country} · {d.id_type}</span>
            {!disabled && <XBtn onClick={() => del(d.id)} />}
          </Row>
        ))}
        {!disabled && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
            <MiniF label="이름" v={draft.name ?? ""} on={(v) => setDraft({ ...draft, name: v })} />
            <MiniF label="생년월일" v={draft.birth ?? ""} on={(v) => setDraft({ ...draft, birth: v })} />
            <MiniF label="국적" v={draft.country ?? ""} on={(v) => setDraft({ ...draft, country: v })} w={80} />
            <MiniF label="신분증번호" v={draft.id_number ?? ""} on={(v) => setDraft({ ...draft, id_number: v })} />
            <label style={{ display: "flex", alignItems: "center", gap: 5, color: "#a9b1bd", fontSize: 12, paddingBottom: 8 }}>
              <input type="checkbox" checked={!!draft.is_ubo} onChange={(e) => setDraft({ ...draft, is_ubo: e.target.checked })} /> UBO
            </label>
            <button onClick={add} style={addBtn}>+ 추가</button>
          </div>
        )}
      </Section>
    </Section>
  );
}

// ══════════ Step 3 — 권한대리인 + PEP + 서명 ══════════
function Step3({ values, set, disabled }: FieldProps) {
  return (
    <Section title="권한대리인 / 서명자">
      <Sel label="서명자 유형" k="auth_type" options={[["ubo", "UBO 본인"], ["delegate", "위임 대리인"]]} {...{ values, set, disabled }} />
      <Grid>
        <F label="성명" k="auth_name" {...{ values, set, disabled }} />
        <F label="생년월일" k="auth_birth" placeholder="YYYY-MM-DD" {...{ values, set, disabled }} />
        <F label="국적" k="auth_country" {...{ values, set, disabled }} />
        <F label="이메일" k="auth_email" {...{ values, set, disabled }} />
        <Sel label="신분증 종류" k="auth_id_type" options={[["passport", "여권"], ["id_card", "주민등록증"], ["driver", "운전면허"]]} {...{ values, set, disabled }} />
        <F label="신분증 번호" k="auth_id_number" {...{ values, set, disabled }} />
      </Grid>
      <Grid>
        <F label="신분증 앞면 URL" k="auth_id_front_url" {...{ values, set, disabled }} />
        <F label="신분증 뒷면 URL" k="auth_id_back_url" {...{ values, set, disabled }} />
        <F label="주소증빙 URL" k="auth_address_proof_url" {...{ values, set, disabled }} />
        <F label="위임장(LOA) URL" k="auth_loa_url" {...{ values, set, disabled }} />
      </Grid>

      <Section title="PEP(정치적 주요인물) 확인" sub>
        <Sel label="본인 또는 가족이 PEP 입니까?" k="pep_q1" options={[["no", "아니오"], ["yes", "예"]]} {...{ values, set, disabled }} />
        <Sel label="제재/워치리스트 대상입니까?" k="pep_q2" options={[["no", "아니오"], ["yes", "예"]]} {...{ values, set, disabled }} />
      </Section>

      <Section title="Payoneer 정산 계정" sub>
        <Sel label="상태" k="payoneer_status" options={[["none", "미개설"], ["applied", "신청중"], ["active", "개설완료"]]} {...{ values, set, disabled }} />
        <Grid>
          <F label="Payoneer 이메일" k="payoneer_email" {...{ values, set, disabled }} />
          <F label="메모" k="payoneer_note" {...{ values, set, disabled }} />
        </Grid>
      </Section>

      <Section title="전자서명" sub desc="아래 영역에 서명하면 신청 내용에 동의하는 것으로 간주됩니다.">
        <SignaturePad value={values.ubo_signature_data ?? ""} onChange={(v) => set("ubo_signature_data", v)} disabled={disabled} />
      </Section>
    </Section>
  );
}

// ══════════ Step 4 — 제품 + 창고 ══════════
function Step4({ products, productCountries, warehouses, disabled, onChange, flash }:
  { products: Product[]; productCountries: Record<string, ProductCountry[]>; warehouses: Warehouse[]; disabled: boolean; onChange: () => void; flash: (m: string) => void }) {
  const [pDraft, setPDraft] = useState<Partial<Product>>({});
  const [wDraft, setWDraft] = useState<Partial<Warehouse>>({});
  async function addP() {
    if (!pDraft.name) { flash("제품명을 입력하세요."); return; }
    const r = await addProductAction(pDraft); if (r.ok) { setPDraft({}); onChange(); flash("제품이 추가되었습니다."); } else flash(r.error ?? "추가 실패");
  }
  async function delP(id: string) { const r = await deleteProductAction(id); if (r.ok) { onChange(); flash("삭제되었습니다."); } }
  async function addW() {
    if (!wDraft.country) { flash("창고 국가를 입력하세요."); return; }
    const r = await addWarehouseAction(wDraft); if (r.ok) { setWDraft({}); onChange(); flash("창고가 추가되었습니다."); } else flash(r.error ?? "추가 실패");
  }
  async function delW(id: string) { const r = await deleteWarehouseAction(id); if (r.ok) { onChange(); flash("삭제되었습니다."); } }

  return (
    <Section title="제품 등록" desc="런칭할 제품을 모두 추가하세요. 국가별 단가·인증은 추가 후 관리됩니다.">
      {products.length === 0 && <Empty>등록된 제품이 없습니다.</Empty>}
      {products.map((p) => (
        <div key={p.id} style={{ border: "1px solid #232833", borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <Row>
            <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
            <span style={{ color: "#8b93a1", fontSize: 12 }}>{p.category} {p.sku && `· ${p.sku}`}</span>
            {!disabled && <XBtn onClick={() => delP(p.id)} />}
          </Row>
          {(productCountries[p.id]?.length ?? 0) > 0 && (
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {productCountries[p.id].map((c) => (
                <Tag key={c.id}>{c.country_code} {c.unit_price && `· ${c.currency} ${c.unit_price}`} · 인증 {c.cert_status}</Tag>
              ))}
            </div>
          )}
        </div>
      ))}
      {!disabled && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
          <MiniF label="제품명" v={pDraft.name ?? ""} on={(v) => setPDraft({ ...pDraft, name: v })} w={160} />
          <MiniF label="카테고리" v={pDraft.category ?? ""} on={(v) => setPDraft({ ...pDraft, category: v })} />
          <MiniF label="SKU" v={pDraft.sku ?? ""} on={(v) => setPDraft({ ...pDraft, sku: v })} w={90} />
          <MiniF label="대표이미지 URL" v={pDraft.main_image_url ?? ""} on={(v) => setPDraft({ ...pDraft, main_image_url: v })} w={160} />
          <button onClick={addP} style={addBtn}>+ 제품추가</button>
        </div>
      )}

      <Section title="물류창고" sub desc="현지 창고/3PL 정보를 입력하세요.">
        {warehouses.length === 0 && <Empty>등록된 창고가 없습니다.</Empty>}
        {warehouses.map((w) => (
          <Row key={w.id}>
            <span style={{ flex: 1 }}>{w.country} {w.region && `· ${w.region}`}</span>
            <span style={{ color: "#8b93a1", fontSize: 12 }}>{w.contact} {w.phone}</span>
            {!disabled && <XBtn onClick={() => delW(w.id)} />}
          </Row>
        ))}
        {!disabled && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
            <MiniF label="국가" v={wDraft.country ?? ""} on={(v) => setWDraft({ ...wDraft, country: v })} w={80} />
            <MiniF label="지역" v={wDraft.region ?? ""} on={(v) => setWDraft({ ...wDraft, region: v })} w={100} />
            <MiniF label="담당자" v={wDraft.contact ?? ""} on={(v) => setWDraft({ ...wDraft, contact: v })} />
            <MiniF label="연락처" v={wDraft.phone ?? ""} on={(v) => setWDraft({ ...wDraft, phone: v })} />
            <MiniF label="주소" v={wDraft.address ?? ""} on={(v) => setWDraft({ ...wDraft, address: v })} w={160} />
            <button onClick={addW} style={addBtn}>+ 창고추가</button>
          </div>
        )}
      </Section>
    </Section>
  );
}

// ══════════ 서명 패드 ══════════
function SignaturePad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = value; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const down = useCallback((e: React.PointerEvent) => {
    if (disabled) return; drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.strokeStyle = "#111"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
  }, [disabled]);
  const move = useCallback((e: React.PointerEvent) => {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }, [disabled]);
  const up = useCallback(() => {
    if (!drawing.current) return; drawing.current = false;
    onChange(canvasRef.current!.toDataURL("image/png"));
  }, [onChange]);
  const clear = () => {
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); onChange("");
  };

  return (
    <div>
      <canvas ref={canvasRef} width={520} height={160}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: "100%", maxWidth: 520, height: "auto", borderRadius: 10, border: "1px solid #2a2f3a", background: "#fff", touchAction: "none", cursor: disabled ? "not-allowed" : "crosshair" }} />
      {!disabled && (
        <button onClick={clear} style={{ marginTop: 8, background: "transparent", color: "#8b93a1", border: "1px solid #2a2f3a", borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>서명 지우기</button>
      )}
    </div>
  );
}

// ══════════ 공통 UI ══════════
type FieldProps = { values: Record<string, string>; set: (k: string, v: string) => void; disabled: boolean };

function Section({ title, desc, sub, children }: { title: string; desc?: string; sub?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: sub ? 22 : 0 }}>
      <div style={{ fontSize: sub ? 14 : 17, fontWeight: 700, color: "#e6e9ef" }}>{title}</div>
      {desc && <div style={{ fontSize: 12.5, color: "#8b93a1", marginTop: 3, marginBottom: 10 }}>{desc}</div>}
      {!desc && <div style={{ height: 10 }} />}
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>{children}</div>;
}
function F({ label, k, values, set, disabled, placeholder, full, textarea }: FieldProps & { label: string; k: string; placeholder?: string; full?: boolean; textarea?: boolean }) {
  return (
    <label style={{ fontSize: 12, color: "#a9b1bd", fontWeight: 600, gridColumn: full ? "1 / -1" : undefined, display: "block", marginBottom: full ? 12 : 0 }}>
      {label}
      {textarea ? (
        <textarea value={values[k] ?? ""} disabled={disabled} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} rows={3} style={{ ...fieldStyle, resize: "vertical" }} />
      ) : (
        <input value={values[k] ?? ""} disabled={disabled} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} style={fieldStyle} />
      )}
    </label>
  );
}
function Sel({ label, k, options, values, set, disabled }: FieldProps & { label: string; k: string; options: [string, string][] }) {
  return (
    <label style={{ fontSize: 12, color: "#a9b1bd", fontWeight: 600, display: "block" }}>
      {label}
      <select value={values[k] ?? options[0][0]} disabled={disabled} onChange={(e) => set(k, e.target.value)} style={fieldStyle}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
function MiniF({ label, v, on, w }: { label: string; v: string; on: (v: string) => void; w?: number }) {
  return (
    <label style={{ fontSize: 11, color: "#8b93a1", display: "flex", flexDirection: "column", gap: 3 }}>
      {label}
      <input value={v} onChange={(e) => on(e.target.value)} style={{ width: w ?? 120, background: "#0f1115", border: "1px solid #2a2f3a", borderRadius: 8, padding: "8px 10px", color: "#e6e9ef", fontSize: 13 }} />
    </label>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #1e222b", fontSize: 14, color: "#e6e9ef" }}>{children}</div>;
}
function XBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} style={{ background: "transparent", color: "#e03131", border: 0, cursor: "pointer", fontSize: 16, padding: 2 }}>✕</button>;
}
function Tag({ children }: { children: React.ReactNode }) {
  return <span style={{ display: "inline-block", background: "#12271f", color: ACCENT, borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>{children}</span>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "#6b7280", fontSize: 13, padding: "14px 0" }}>{children}</div>;
}
function Banner({ tone, children }: { tone: "warn" | "info" | "ok" | "mute"; children: React.ReactNode }) {
  const bg = { warn: "#2a1d12", info: "#12212a", ok: "#12271f", mute: "#171a21" }[tone];
  const col = { warn: "#f0a02c", info: "#4dabf7", ok: ACCENT, mute: "#8b93a1" }[tone];
  return <div style={{ background: bg, color: col, borderRadius: 10, padding: "11px 14px", fontSize: 13, marginBottom: 14, border: `1px solid ${col}33` }}>{children}</div>;
}

const fieldStyle: React.CSSProperties = { width: "100%", background: "#0f1115", border: "1px solid #2a2f3a", borderRadius: 9, padding: "10px 11px", color: "#e6e9ef", fontSize: 14, marginTop: 5, boxSizing: "border-box" };
const addBtn: React.CSSProperties = { background: "#232833", color: "#e6e9ef", border: 0, borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", height: 38 };

function statusLabel(s: string) { return { locked: "잠김", unlocked: "작성중", draft: "작성중", submitted: "검토중", approved: "승인됨", rejected: "반려" }[s] ?? s; }
function statusColor(s: string) { return { locked: "#6b7280", unlocked: "#4dabf7", draft: "#4dabf7", submitted: "#f0a02c", approved: ACCENT, rejected: "#e03131" }[s] ?? "#8b93a1"; }

// 스텝별 저장 키(서버 화이트리스트와 일치)
const STEP_KEYS: string[][] = [
  ["company_name_kr", "company_name_en", "company_type", "company_country", "company_reg_date", "company_reg_number",
   "contact_name", "contact_email", "contact_phone", "address_kr", "address_en", "op_address_en",
   "shop_name_kr", "shop_name_en", "brand_logo_url", "product_category", "sales_channel_url",
   "doc_biz_reg_en_url", "doc_biz_reg_kr_url", "doc_corp_reg_kr_url", "doc_ownership_url", "doc_logistics_url"],
  ["ubo_full_name", "ubo_title", "ubo_birth", "ubo_country", "ubo_id_type", "ubo_id_number",
   "ubo_id_front_url", "ubo_id_back_url", "ubo_address_proof_url", "ownership_structure"],
  ["auth_type", "auth_name", "auth_birth", "auth_country", "auth_id_type", "auth_id_number", "auth_email",
   "auth_id_front_url", "auth_id_back_url", "auth_address_proof_url", "auth_loa_url",
   "pep_q1", "pep_q2", "ubo_signature_data", "payoneer_status", "payoneer_email", "payoneer_note"],
  [],
];
const ALL_FIELDS = Array.from(new Set(STEP_KEYS.flat()));
