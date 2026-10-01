"use client";
// 틱톡샵 주간 온보딩 신청(공개).
//   · "주 3개 브랜드 모집"은 모집 안내다 — 잔여석·마감을 표시하지 않는다.
//   · 신청만으로 계약·입점 확정이나 세미나 전 완료를 약속하지 않는다.
import { useState, useTransition } from "react";
import { submitWeeklyApplyAction } from "./actions";

const SLOTS = 3;

export default function WeeklyApplyForm() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | { already: boolean }>(null);
  const [err, setErr] = useState("");
  const [v, setV] = useState({
    brandName: "", companyName: "", siteUrl: "",
    contactName: "", contactTitle: "", phone: "", email: "", note: "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const submit = () => start(async () => {
    setErr("");
    const r = await submitWeeklyApplyAction(v);
    if (r.ok) setDone({ already: Boolean(r.already) });
    else setErr(r.error ?? "접수에 실패했습니다.");
  });

  if (done) {
    return (
      <main style={S.page}>
        <div style={S.card}>
          <h1 style={S.h1}>신청이 접수되었습니다</h1>
          <p style={S.muted}>
            {done.already
              ? "이번 주에 이미 접수된 신청이 있어 중복으로 등록하지 않았습니다. 담당자가 순차로 연락드립니다."
              : "담당자가 순차로 연락드려 상담 일정을 잡아드립니다."}
          </p>
          <p style={S.muted}>
            접수는 상담·준비 절차의 시작이며, <b>계약이나 입점이 확정된 것은 아닙니다.</b>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={S.badge}>TikTok Shop</div>
        <h1 style={S.h1}>틱톡샵 주간 온보딩 신청</h1>
        <p style={S.lead}>
          매주 <b>{SLOTS}개 브랜드</b>를 모집해 온보딩 상담과 준비를 함께 진행합니다.
          세미나 전에 미리 상담하고 준비하고 싶은 브랜드는 아래로 신청해 주세요.
        </p>
        <div style={S.notice}>
          신청은 상담·준비 절차의 시작입니다. <b>신청만으로 계약·입점이 확정되거나,
          세미나 전에 온보딩이 완료되는 것을 보장하지는 않습니다.</b>
          접수 순서와 준비 상황을 함께 보고 담당자가 개별로 안내드립니다.
        </div>

        <div style={S.grid}>
          <Field label="브랜드명" required value={v.brandName} onChange={set("brandName")} placeholder="예: 글로브케이" />
          <Field label="회사명" required value={v.companyName} onChange={set("companyName")} placeholder="예: (주)디노스튜디오" />
          <Field label="회사 · 브랜드 사이트" value={v.siteUrl} onChange={set("siteUrl")} placeholder="예: brand.co.kr (선택)" full />
          <Field label="담당자명" required value={v.contactName} onChange={set("contactName")} placeholder="예: 홍길동" />
          <Field label="직함" value={v.contactTitle} onChange={set("contactTitle")} placeholder="예: 마케팅팀장 (선택)" />
          <Field label="연락처" required value={v.phone} onChange={set("phone")} placeholder="010-0000-0000" />
          <Field label="이메일" required value={v.email} onChange={set("email")} placeholder="name@company.com" />
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={S.label}>문의 사항 (선택)</label>
            <textarea style={{ ...S.input, height: 88, resize: "vertical" }} value={v.note}
              onChange={set("note")} placeholder="상담 때 먼저 확인하고 싶은 내용이 있으면 적어주세요." />
          </div>
        </div>

        {err && <div style={S.err}>{err}</div>}
        <button style={{ ...S.btn, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={submit}>
          {pending ? "접수 중…" : "온보딩 상담 신청하기"}
        </button>
        <p style={S.privacy}>
          제출하신 정보는 틱톡샵 온보딩 상담 안내 목적으로만 사용되며, 안내 종료 후 관련 법령에 따라 처리됩니다.
        </p>
      </div>
    </main>
  );
}

function Field({ label, required, value, onChange, placeholder, full }: {
  label: string; required?: boolean; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; full?: boolean;
}) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label style={S.label}>{label}{required && <span style={{ color: "#e03131" }}> *</span>}</label>
      <input style={S.input} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0f1115", padding: "32px 16px 72px", display: "flex", justifyContent: "center" },
  card: { width: "100%", maxWidth: 640, background: "#fff", borderRadius: 18, padding: "28px 26px 26px" },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: ".12em", color: "#1d4ed8", background: "#eef4ff", borderRadius: 999, padding: "4px 10px" },
  h1: { fontSize: 24, fontWeight: 800, color: "#111", margin: "12px 0 8px", lineHeight: 1.35 },
  lead: { fontSize: 14.5, color: "#374151", lineHeight: 1.75, margin: "0 0 12px" },
  notice: { fontSize: 12.5, color: "#8a5a00", background: "#fff8e8", border: "1px solid #f0dca8", borderRadius: 10, padding: "10px 12px", lineHeight: 1.7, marginBottom: 18 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 5 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #dfe3e8", borderRadius: 10, padding: "11px 12px", fontSize: 14, color: "#111", background: "#fff" },
  err: { marginTop: 14, fontSize: 13, color: "#c92a2a" },
  btn: { width: "100%", border: 0, borderRadius: 12, background: "#111827", color: "#fff", padding: "14px 18px", fontSize: 15, fontWeight: 800, cursor: "pointer", marginTop: 16 },
  privacy: { fontSize: 11.5, color: "#9aa3af", lineHeight: 1.7, marginTop: 14, marginBottom: 0 },
  muted: { fontSize: 14, color: "#374151", lineHeight: 1.8 },
};
