"use client";
// 행사별 신청 폼(공개). 제출은 전용 표에만 저장되고 자동 문자·메일 캠페인으로 이어지지 않는다.
//   접수와 참석 확정은 다른 것이라는 안내를 완료 화면에도 남긴다.
import { useState, useTransition } from "react";
import Link from "next/link";
import { applyEventAction } from "./actions";
import {
  PRIVACY_NOTICE, PRIVACY_CONSENT_LABEL, MARKETING_CONSENT_LABEL,
  APPLY_DONE_NOTICE, APPLY_NOT_CONFIRMED_NOTICE, eventPath,
} from "@/lib/seminar-events-model";

export interface ApplyFormEvent {
  slug: string; title: string; when: string; where: string; countries: string[];
}

export default function EventApplyForm({ e }: { e: ApplyFormEvent }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ already?: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [v, setV] = useState({
    companyName: "", brandName: "", contactName: "", contactTitle: "",
    phone: "", email: "", siteUrl: "", countriesFree: "", note: "",
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const set = (k: keyof typeof v) =>
    (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV((p) => ({ ...p, [k]: ev.target.value }));

  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  const submit = () => start(async () => {
    setErr("");
    if (!privacy) { setErr("개인정보 수집·이용 동의가 필요합니다."); return; }
    // 선택지에서 고른 값과 직접 적은 값을 합쳐 보낸다.
    const countries = [...picked, ...v.countriesFree.split(",").map((s) => s.trim())]
      .filter(Boolean).join(", ");
    const r = await applyEventAction(e.slug, {
      companyName: v.companyName, brandName: v.brandName,
      contactName: v.contactName, contactTitle: v.contactTitle,
      phone: v.phone, email: v.email, siteUrl: v.siteUrl,
      countries, note: v.note,
      privacyAgreed: privacy, marketingAgreed: marketing,
    });
    if (!r.ok) { setErr(r.error ?? "접수에 실패했습니다."); return; }
    setDone({ already: r.already });
  });

  if (done) {
    return (
      <main style={S.page}>
        <div style={S.card}>
          <h1 style={S.h1}>신청이 접수되었습니다</h1>
          <p style={S.muted}>
            {done.already
              ? "이미 접수된 신청이 있어 중복으로 등록하지 않았습니다."
              : APPLY_DONE_NOTICE}
          </p>
          <div style={S.doneBox}>
            <b style={{ fontSize: 14 }}>{e.title}</b>
            <div style={S.doneMeta}>{e.when}</div>
            <div style={S.doneMeta}>{e.where}</div>
          </div>
          <p style={S.muted}>{APPLY_NOT_CONFIRMED_NOTICE}</p>
          <Link href={eventPath(e.slug)} style={S.ghost}>행사 정보 다시 보기</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={S.badge}>세미나 신청</div>
        <h1 style={S.h1}>{e.title}</h1>
        <div style={S.evMeta}>{e.when}</div>
        <div style={S.evMeta}>{e.where}</div>
        <div style={S.notice}>{APPLY_NOT_CONFIRMED_NOTICE}</div>

        <div style={S.grid}>
          <Field label="회사명" required value={v.companyName} onChange={set("companyName")} placeholder="예: (주)디노스튜디오" />
          <Field label="브랜드명" value={v.brandName} onChange={set("brandName")} placeholder="예: 글로브케이 (선택)" />
          <Field label="담당자명" required value={v.contactName} onChange={set("contactName")} placeholder="예: 홍길동" />
          <Field label="직함" value={v.contactTitle} onChange={set("contactTitle")} placeholder="예: 마케팅팀장 (선택)" />
          <Field label="연락처" required value={v.phone} onChange={set("phone")} placeholder="010-0000-0000" />
          <Field label="이메일" required value={v.email} onChange={set("email")} placeholder="name@company.com" />
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={S.label}>회사 사이트</label>
            <input style={S.input} value={v.siteUrl} onChange={set("siteUrl")} placeholder="예: brand.co.kr (선택)" />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label style={S.label}>관심 국가 <span style={S.optional}>(선택)</span></label>
            {e.countries.length > 0 && (
              <div style={S.chips}>
                {e.countries.map((c) => (
                  <label key={c} style={{ ...S.chipPick, ...(picked.includes(c) ? S.chipPickOn : null) }}>
                    <input type="checkbox" checked={picked.includes(c)} onChange={() => toggle(c)}
                      style={{ marginRight: 6 }} />
                    {c}
                  </label>
                ))}
              </div>
            )}
            <input style={S.input} value={v.countriesFree} onChange={set("countriesFree")}
              placeholder={e.countries.length ? "그 외 관심 국가가 있으면 쉼표로 적어주세요" : "예: 일본, 미국"} />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label style={S.label}>문의 사항 <span style={S.optional}>(선택)</span></label>
            <textarea style={{ ...S.input, height: 88, resize: "vertical" }} value={v.note}
              onChange={set("note")} placeholder="세미나에서 먼저 확인하고 싶은 내용이 있으면 적어주세요." />
          </div>
        </div>

        <div style={S.consentBox}>
          <p style={S.consentNotice}>{PRIVACY_NOTICE}</p>
          <label style={S.consent}>
            <input type="checkbox" checked={privacy} onChange={(ev) => setPrivacy(ev.target.checked)} />
            <span>{PRIVACY_CONSENT_LABEL}</span>
          </label>
          <label style={S.consent}>
            <input type="checkbox" checked={marketing} onChange={(ev) => setMarketing(ev.target.checked)} />
            <span>{MARKETING_CONSENT_LABEL}</span>
          </label>
        </div>

        {err && <div style={S.err}>{err}</div>}
        <button style={{ ...S.btn, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={submit}>
          {pending ? "접수 중…" : "세미나 신청하기"}
        </button>
      </div>
    </main>
  );
}

function Field({ label, required, value, onChange, placeholder }: {
  label: string; required?: boolean; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string;
}) {
  return (
    <div>
      <label style={S.label}>
        {label}
        {required ? <span style={{ color: "#e03131" }}> *</span> : <span style={S.optional}> (선택)</span>}
      </label>
      <input style={S.input} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0f1115", padding: "32px 16px 72px", display: "flex", justifyContent: "center" },
  card: { width: "100%", maxWidth: 640, background: "#fff", borderRadius: 18, padding: "28px 26px 26px" },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: ".12em", color: "#1d4ed8", background: "#eef4ff", borderRadius: 999, padding: "4px 10px" },
  h1: { fontSize: 23, fontWeight: 800, color: "#111", margin: "12px 0 8px", lineHeight: 1.35 },
  evMeta: { fontSize: 13, color: "#4b5563", lineHeight: 1.7 },
  notice: { fontSize: 12.5, color: "#8a5a00", background: "#fff8e8", border: "1px solid #f0dca8", borderRadius: 10, padding: "10px 12px", lineHeight: 1.7, margin: "14px 0 18px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 5 },
  optional: { color: "#9aa3af", fontWeight: 600 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #dfe3e8", borderRadius: 10, padding: "11px 12px", fontSize: 14, color: "#111", background: "#fff" },
  chips: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 8 },
  chipPick: { display: "inline-flex", alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "#4b5563", border: "1px solid #dfe3e8", borderRadius: 999, padding: "6px 11px", cursor: "pointer" },
  chipPickOn: { color: "#1d4ed8", borderColor: "#c7d9ff", background: "#f3f7ff" },
  consentBox: { marginTop: 18, border: "1px solid #eef0f3", borderRadius: 12, padding: "13px 14px", background: "#fbfcfd" },
  consentNotice: { fontSize: 12, color: "#6b7280", lineHeight: 1.75, margin: "0 0 10px" },
  consent: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#374151", lineHeight: 1.7, marginTop: 7 },
  err: { marginTop: 14, fontSize: 13, color: "#c92a2a" },
  btn: { width: "100%", border: 0, borderRadius: 12, background: "#111827", color: "#fff", padding: "14px 18px", fontSize: 15, fontWeight: 800, cursor: "pointer", marginTop: 16 },
  muted: { fontSize: 14, color: "#374151", lineHeight: 1.8 },
  doneBox: { border: "1px solid #eef0f3", borderRadius: 12, padding: "13px 14px", margin: "14px 0" },
  doneMeta: { fontSize: 12.5, color: "#6b7280", lineHeight: 1.7, marginTop: 3 },
  ghost: { display: "inline-block", marginTop: 8, border: "1px solid #dfe3e8", color: "#374151", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, textDecoration: "none" },
};
