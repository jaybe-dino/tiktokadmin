"use client";
// 일본 진출 사전 신청 폼 — 공개 페이지(로그인 불필요).
//   "사전 신청"임을 분명히 안내하고, 10월 이후 온보딩 가이드를 순차 안내한다고 밝힌다.
import { useState, useTransition } from "react";
import { submitJpApplyAction } from "./actions";

const CERT_OPTIONS = [
  "보유 (일본 수입·판매 인증 완료)",
  "진행 중",
  "미보유 (준비 필요)",
  "잘 모르겠음 / 상담 필요",
];
const SKU_OPTIONS = ["1~3개", "4~10개", "11~30개", "31개 이상"];
const JP_SALES_OPTIONS = [
  "일본 판매 경험 없음",
  "일본 온라인몰 판매 중 (Qoo10·라쿠텐·아마존 등)",
  "일본 오프라인 유통 중",
  "TikTok Shop 일본 운영 중",
  "기타 (아래에 작성)",
];

export default function JpApplyForm() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    company: "", brand_name: "", contact_name: "", phone: "", email: "",
    cert_status: "", sku_count: "", jp_sales: "", note: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  function submit() {
    if (pending) return;
    setErr("");
    start(async () => {
      const r = await submitJpApplyAction(f);
      if (!r.ok) { setErr(r.error ?? "접수 실패"); return; }
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (done) {
    return (
      <main style={S.page}>
        <div style={S.card}>
          <div style={S.badge}>사전 신청 접수 완료</div>
          <h1 style={S.h1}>신청이 접수되었습니다.</h1>
          <p style={S.lead}>
            본 신청은 <b>정식 입점 신청이 아닌 사전 신청</b>입니다. 접수해주신 순서대로 검토 후,
            <b> 10월 이후 온보딩 관련 가이드</b>를 기재해주신 이메일로 순차 안내드릴 예정입니다.
          </p>
          <p style={{ ...S.muted, marginTop: 14 }}>
            문의: 기재하신 연락처로 담당자가 연락드립니다. 창을 닫으셔도 됩니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={S.badge}>TikTok Shop 일본 · 사전 신청</div>
        <h1 style={S.h1}>일본 진출 사전 신청</h1>
        <p style={S.lead}>
          TikTok Shop 일본 진출을 준비하시는 브랜드를 위한 <b>사전 신청</b>입니다.
          지금은 정식 입점 절차가 아니며, 접수해주신 내용을 바탕으로
          <b> 10월 이후 온보딩 관련 가이드</b>를 순차적으로 안내드릴 예정입니다.
        </p>

        <div style={S.notice}>
          <b>안내</b>
          <ul style={S.ul}>
            <li>본 신청만으로 입점이 확정되지 않습니다(사전 수요 파악 목적).</li>
            <li>10월 이후 온보딩 가이드·일정이 기재하신 이메일로 발송됩니다.</li>
            <li>이미 상담 이력이 있으신 경우 기존 문의 건과 함께 관리됩니다.</li>
          </ul>
        </div>

        <div style={S.grid}>
          <Field label="회사명" required>
            <input style={S.input} value={f.company} onChange={(e) => set("company", e.target.value)} placeholder="(주)디노스튜디오" />
          </Field>
          <Field label="브랜드명" required>
            <input style={S.input} value={f.brand_name} onChange={(e) => set("brand_name", e.target.value)} placeholder="판매하실 브랜드명" />
          </Field>
          <Field label="담당자명">
            <input style={S.input} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} placeholder="홍길동" />
          </Field>
          <Field label="연락처" required>
            <input style={S.input} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="010-0000-0000" inputMode="tel" />
          </Field>
          <Field label="이메일" required hint="온보딩 가이드가 이 주소로 발송됩니다.">
            <input style={S.input} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" inputMode="email" />
          </Field>
          <Field label="인증 보유 여부" hint="일본 수입·판매에 필요한 인증(화장품 제조판매업 신고 등)">
            <select style={S.input} value={f.cert_status} onChange={(e) => set("cert_status", e.target.value)}>
              <option value="">선택해주세요</option>
              {CERT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="제품 SKU 수">
            <select style={S.input} value={f.sku_count} onChange={(e) => set("sku_count", e.target.value)}>
              <option value="">선택해주세요</option>
              {SKU_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="일본 현지 판매 현황">
            <select style={S.input} value={f.jp_sales} onChange={(e) => set("jp_sales", e.target.value)}>
              <option value="">선택해주세요</option>
              {JP_SALES_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
        </div>

        <Field label="추가로 전달하실 내용">
          <textarea style={{ ...S.input, minHeight: 84, resize: "vertical" }} value={f.note}
            onChange={(e) => set("note", e.target.value)} placeholder="현재 상황이나 궁금하신 점을 자유롭게 적어주세요." />
        </Field>

        {err && <div style={S.err}>⚠ {err}</div>}

        <button style={{ ...S.submit, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={submit}>
          {pending ? "접수 중…" : "사전 신청하기"}
        </button>
        <p style={S.privacy}>
          제출하신 정보는 일본 진출 온보딩 안내 목적으로만 사용되며, 안내 종료 후 관련 법령에 따라 처리됩니다.
        </p>
      </div>
    </main>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={S.label}>{label}{required && <span style={{ color: "#dc2626", marginLeft: 3 }}>*</span>}</span>
      {children}
      {hint && <span style={S.hint}>{hint}</span>}
    </label>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", background: "linear-gradient(180deg,#f7f8fa,#eef0f4)", padding: "32px 16px",
    fontFamily: '-apple-system,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif', color: "#111827",
  },
  card: {
    maxWidth: 640, margin: "0 auto", background: "#fff", borderRadius: 18, padding: "32px 28px",
    boxShadow: "0 10px 40px rgba(15,23,42,.08)",
  },
  badge: {
    display: "inline-block", background: "#1f2937", color: "#fff", fontSize: 12, fontWeight: 800,
    padding: "6px 12px", borderRadius: 999, letterSpacing: ".02em",
  },
  h1: { fontSize: 26, fontWeight: 900, margin: "16px 0 10px", letterSpacing: "-.02em" },
  lead: { fontSize: 14.5, lineHeight: 1.7, color: "#4b5563", margin: 0 },
  notice: { background: "#f6f7f9", border: "1px solid #e2e6ec", borderRadius: 12, padding: "14px 16px", margin: "20px 0 24px", fontSize: 13 },
  ul: { margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.8, color: "#4b5563" },
  grid: { display: "grid", gap: 0 },
  label: { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5 },
  hint: { display: "block", fontSize: 11.5, color: "#9aa3af", marginTop: 4 },
  input: {
    width: "100%", boxSizing: "border-box", border: "1px solid #d7dce3", borderRadius: 10,
    padding: "11px 12px", fontSize: 14, background: "#fff", color: "#111827",
  },
  err: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px", fontSize: 13, margin: "4px 0 12px" },
  submit: {
    width: "100%", background: "#1f2937", color: "#fff", border: "none", borderRadius: 12,
    padding: "14px 18px", fontSize: 15, fontWeight: 800, cursor: "pointer", marginTop: 8,
  },
  privacy: { fontSize: 11.5, color: "#9aa3af", lineHeight: 1.7, marginTop: 14, marginBottom: 0 },
  muted: { fontSize: 13, color: "#6b7280", lineHeight: 1.7 },
};
