"use client";
// 공개 신청 폼 — 로그인 없이 연다.
//   날짜 카드로 희망 회차 1개를 고르고, 단계별로 입력한다.
//   동의 3종은 모두 처음에 꺼진 상태이고, 광고 동의는 신청·선정과 무관하다.
import { useEffect, useMemo, useState, useTransition } from "react";
import { publicSessionsAction, submitSeminarApplyAction, type PublicSessionView } from "./actions";
import {
  PROGRAM_TITLE, PROGRAM_TAGLINE, SESSION_TIME_NOTE, SAME_PROGRAM_NOTE,
  INTRO_PARAGRAPH, LIMITED_SEATS_NOTE,
  JOB_ROLES, PRODUCT_CATEGORIES, OVERSEAS_STAGES, TARGET_COUNTRIES,
  SELLING_CHANNELS, REVENUE_BANDS, OVERSEAS_REVENUE_BANDS, EXPORT_TIMINGS, SUPPORT_AREAS,
  CONSENT_REQUIRED_LABEL, CONSENT_OPTIONAL_LABEL, CONSENT_ADS_LABEL, CONSULT_LABEL,
  COLLECT_REQUIRED, COLLECT_OPTIONAL, PURPOSE_REQUIRED, PURPOSE_OPTIONAL, PURPOSE_ADS,
  REFUSAL_NOTICE, SELECTION_CRITERIA, NOT_CONFIRMED_NOTICE, APPLY_DONE_NOTICE,
  ORG_DEFAULT, RETENTION_DEFAULT, retentionSentence, fmtSessionWhen, fmtSessionShort,
  formBlockers, type SapFormInput,
} from "@/lib/seminar-apply-model";

const C = {
  ink: "#12161c", ink2: "#3d4756", ink3: "#6b7684", line: "#dde3ea",
  acc: "#2563eb", accSoft: "#eef3ff", bg: "#f6f8fb", ok: "#117a44", bad: "#c92a2a",
};

export default function SeminarApplyForm() {
  const [load, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const [sessions, setSessions] = useState<PublicSessionView[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [applyOpen, setApplyOpen] = useState(true);

  const [step, setStep] = useState(1);
  const [v, setV] = useState<SapFormInput>({ targetCountries: [], sellingChannels: [], supportAreas: [] });
  const [err, setErr] = useState("");
  const [done, setDone] = useState<null | { already: boolean }>(null);
  const [utm, setUtm] = useState<{ source?: string; medium?: string; campaign?: string; campaignId?: string }>({});

  const set = <K extends keyof SapFormInput>(k: K) => (x: SapFormInput[K]) => setV((p) => ({ ...p, [k]: x }));
  const toggle = (k: "targetCountries" | "sellingChannels" | "supportAreas", val: string) => {
    setV((p) => {
      const cur = Array.isArray(p[k]) ? (p[k] as string[]) : [];
      return { ...p, [k]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] };
    });
  };
  const has = (k: "targetCountries" | "sellingChannels" | "supportAreas", val: string) =>
    Array.isArray(v[k]) && (v[k] as string[]).includes(val);

  useEffect(() => {
    startLoad(async () => {
      const r = await publicSessionsAction();
      if (!r.ok) { setLoadErr(r.error ?? "회차를 불러오지 못했습니다."); return; }
      setSessions(r.sessions ?? []);
      setApplyOpen(Boolean(r.applyOpen));
    });
    // 유입 출처는 주소창 쿼리에서만 읽는다 — 개인정보는 쿼리에 넣지 않는다.
    try {
      const q = new URLSearchParams(window.location.search);
      setUtm({
        source: q.get("utm_source") ?? undefined, medium: q.get("utm_medium") ?? undefined,
        campaign: q.get("utm_campaign") ?? undefined, campaignId: q.get("campaign_id") ?? undefined,
      });
    } catch { /* 주소창을 읽지 못해도 신청은 받는다 */ }
  }, []);

  const retention = useMemo(() => retentionSentence(RETENTION_DEFAULT), []);

  const submit = () => startSend(async () => {
    setErr("");
    const blockers = formBlockers(v);
    if (blockers.length) { setErr(blockers[0]); return; }
    const r = await submitSeminarApplyAction(v, utm);
    if (!r.ok) { setErr(r.error ?? "저장하지 못했습니다. 다시 시도해 주세요."); return; }
    setDone({ already: Boolean(r.already) });
  });

  // ── 완료 ──
  if (done) {
    return (
      <Shell>
        <div style={{ ...card, textAlign: "center", padding: "36px 20px" }}>
          <div style={{ fontSize: 34 }}>✅</div>
          <h2 style={{ fontSize: 19, margin: "12px 0 8px", color: C.ink }}>
            {done.already ? "이미 접수된 신청이 있습니다" : "신청이 접수되었습니다"}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: C.ink2, margin: 0 }}>
            {done.already
              ? "같은 회차에 같은 이메일로 접수된 신청이 있어 새로 접수하지 않았습니다. 선정 결과와 Zoom 접속 링크는 별도로 안내드립니다."
              : APPLY_DONE_NOTICE}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* ── 소개 ── */}
      <div style={{ ...card, padding: "24px 20px" }}>
        <div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: C.acc }}>DINO STUDIO · GloveK</div>
        <h1 style={{ fontSize: 24, lineHeight: 1.35, margin: "10px 0 8px", color: C.ink }}>{PROGRAM_TITLE}</h1>
        <div style={{ display: "inline-block", background: C.accSoft, color: C.acc, fontWeight: 700,
          fontSize: 13, borderRadius: 999, padding: "6px 14px" }}>{PROGRAM_TAGLINE}</div>
        <p style={{ fontSize: 14, lineHeight: 1.85, color: C.ink2, margin: "14px 0 0" }}>
          {INTRO_PARAGRAPH}
        </p>
        <div style={{ marginTop: 14, fontSize: 13, color: C.ink3 }}>{SESSION_TIME_NOTE}</div>
      </div>

      {/* ── 신청 폼 ── */}
      <div style={card}>
        <SecTitle>신청하기</SecTitle>
        <StepBar step={step} />

        {loadErr && <Msg bad>{loadErr}</Msg>}
        {!applyOpen && !loadErr && <Msg bad>현재 신청을 받지 않고 있습니다.</Msg>}

        {step === 1 && (
          <>
            <Label required>희망 회차</Label>
            <Help>{SAME_PROGRAM_NOTE}</Help>
            {load && !sessions && <div style={{ fontSize: 13, color: C.ink3 }}>회차를 불러오는 중…</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 8 }}>
              {(sessions ?? []).map((s) => {
                const on = Number(v.sessionNo) === s.sessionNo;
                return (
                  <button key={s.sessionNo} type="button" onClick={() => set("sessionNo")(s.sessionNo)}
                    aria-pressed={on}
                    style={{
                      textAlign: "left", cursor: "pointer", borderRadius: 12, padding: "14px 14px",
                      border: `2px solid ${on ? C.acc : C.line}`, background: on ? C.accSoft : "#fff",
                    }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: on ? C.acc : C.ink3 }}>{s.sessionNo}회차</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, margin: "4px 0 2px" }}>
                      {fmtSessionShort(s.startsAt)}
                    </div>
                    <div style={{ fontSize: 12, color: C.ink3 }}>11:00~12:00</div>
                    {/* 남은 자리는 설정된 선정 인원에서 실제 선정 수를 뺀 값이다. */}
                    <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6,
                      color: s.seatsLeft === 0 ? "#c92a2a" : on ? C.acc : "#117a44" }}>
                      {s.seatsLeft === 0 ? "선정 마감" : `남은 자리 ${s.seatsLeft}명`}
                    </div>
                  </button>
                );
              })}
            </div>
            {sessions && sessions.length === 0 && !loadErr && (
              <Msg bad>현재 열려 있는 회차가 없습니다.</Msg>
            )}
            {Number(v.sessionNo) > 0 && (
              <div style={{ marginTop: 10, fontSize: 13, color: C.ink2 }}>
                선택: <b>{fmtSessionWhen(
                  (sessions ?? []).find((s) => s.sessionNo === Number(v.sessionNo))?.startsAt,
                  (sessions ?? []).find((s) => s.sessionNo === Number(v.sessionNo))?.endsAt)}</b>
              </div>
            )}
            <Nav next={() => setStep(2)} nextOn={Number(v.sessionNo) > 0 && applyOpen} />
          </>
        )}

        {step === 2 && (
          <>
            <Field label="회사명" required value={v.companyName ?? ""} onChange={set("companyName")} placeholder="예: (주)디노스튜디오" />
            <Label required>브랜드명</Label>
            <input style={input} value={v.brandName ?? ""} disabled={Boolean(v.noBrand)}
              onChange={(e) => set("brandName")(e.target.value)} placeholder="브랜드명을 적어 주세요" />
            <Check on={Boolean(v.noBrand)} onToggle={() => setV((p) => ({ ...p, noBrand: !p.noBrand, brandName: "" }))}>
              브랜드 미보유
            </Check>
            <Field label="담당자명" required value={v.contactName ?? ""} onChange={set("contactName")} />
            <Label required>직무</Label>
            <Chips options={[...JOB_ROLES]} value={v.jobRole ?? ""} onPick={(x) => set("jobRole")(x)} />
            {v.jobRole === "기타" && (
              <input style={{ ...input, marginTop: 8 }} value={v.jobRoleEtc ?? ""}
                onChange={(e) => set("jobRoleEtc")(e.target.value)} placeholder="직무를 적어 주세요" />
            )}
            <Field label="업무 이메일" required type="email" value={v.email ?? ""} onChange={set("email")}
              placeholder="name@company.com" help="선정 결과와 접속 링크를 이 주소로 보내 드립니다." />
            <Nav back={() => setStep(1)} next={() => setStep(3)} nextOn />
          </>
        )}

        {step === 3 && (
          <>
            <Label required>상품 카테고리</Label>
            <Chips options={[...PRODUCT_CATEGORIES]} value={v.productCategory ?? ""} onPick={(x) => set("productCategory")(x)} />
            <Label required>현재 해외진출 단계</Label>
            <Chips options={[...OVERSEAS_STAGES]} value={v.overseasStage ?? ""} onPick={(x) => set("overseasStage")(x)} block />
            <Label required>희망 국가 <span style={optTag}>복수 선택 가능</span></Label>
            <Multi options={[...TARGET_COUNTRIES]} on={(x) => has("targetCountries", x)} toggle={(x) => toggle("targetCountries", x)} />
            <Label required>세미나에서 듣고 싶은 질문 또는 해결하고 싶은 과제</Label>
            <Help>적어 주신 내용을 선정과 세미나 구성에 참고합니다.</Help>
            <textarea style={{ ...input, minHeight: 110, resize: "vertical" }} value={v.question ?? ""}
              onChange={(e) => set("question")(e.target.value)}
              placeholder="예) 일본 TikTok Shop 진입 시 가격과 정산 구조를 어떻게 잡아야 할지 궁금합니다." />
            <Nav back={() => setStep(2)} next={() => setStep(4)} nextOn />
          </>
        )}

        {step === 4 && (
          <>
            <div style={{ fontSize: 12.5, color: C.ink3, marginBottom: 10 }}>
              아래는 모두 <b>선택</b> 항목입니다. 비워 두셔도 신청과 선정에 영향이 없습니다.
            </div>
            <Field label="연락처" value={v.phone ?? ""} onChange={set("phone")} placeholder="010-0000-0000" />
            <Field label="공식 URL" value={v.siteUrl ?? ""} onChange={set("siteUrl")} placeholder="brand.com" />
            <Field label="현재 판매 국가" value={v.sellingCountries ?? ""} onChange={set("sellingCountries")} placeholder="예: 한국, 일본" />
            <Label>현재 판매 채널</Label>
            <Multi options={[...SELLING_CHANNELS]} on={(x) => has("sellingChannels", x)} toggle={(x) => toggle("sellingChannels", x)} />
            <Label>매출 구간</Label>
            <Select value={v.revenueBand ?? ""} onChange={set("revenueBand")} options={REVENUE_BANDS} />
            <Label>해외 매출 구간</Label>
            <Select value={v.overseasRevenueBand ?? ""} onChange={set("overseasRevenueBand")} options={OVERSEAS_REVENUE_BANDS} />
            <Label>수출 시작 예정 시기</Label>
            <Chips options={[...EXPORT_TIMINGS]} value={v.exportTiming ?? ""} onPick={(x) => set("exportTiming")(x)} />
            <Label>희망 지원 분야</Label>
            <Multi options={[...SUPPORT_AREAS]} on={(x) => has("supportAreas", x)} toggle={(x) => toggle("supportAreas", x)} />
            <Field label="사업자번호" value={v.bizNo ?? ""} onChange={set("bizNo")} placeholder="000-00-00000 (선택)" />
            <Nav back={() => setStep(3)} next={() => setStep(5)} nextOn />
          </>
        )}

        {step === 5 && (
          <>
            {/* ── 개인정보 안내 ── */}
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, background: C.bg, fontSize: 12.5, lineHeight: 1.85, color: C.ink2 }}>
              <div style={{ fontWeight: 800, color: C.ink, marginBottom: 8 }}>개인정보 수집·이용 안내</div>
              <Row k="수집·이용 목적">{PURPOSE_REQUIRED}</Row>
              <Row k="필수 항목">{COLLECT_REQUIRED}</Row>
              <Row k="보유·이용 기간">{retention.required}</Row>
              <div style={{ height: 8 }} />
              <Row k="선택 항목 목적">{PURPOSE_OPTIONAL}</Row>
              <Row k="선택 항목">{COLLECT_OPTIONAL}</Row>
              <div style={{ height: 8 }} />
              <Row k="광고성 정보 목적">{PURPOSE_ADS}</Row>
              <Row k="광고 보유 기간">{retention.ads}</Row>
              <div style={{ height: 8 }} />
              <Row k="거부 권리">{REFUSAL_NOTICE}</Row>
              <div style={{ height: 10 }} />
              <Row k="운영자">{ORG_DEFAULT.legalName}</Row>
              <Row k="개인정보 보호책임자">{ORG_DEFAULT.repName}</Row>
              {ORG_DEFAULT.bizNo && <Row k="사업자등록번호">{ORG_DEFAULT.bizNo}</Row>}
              <Row k="주소">{ORG_DEFAULT.address}</Row>
              <Row k="문의">{ORG_DEFAULT.contactEmail} · {ORG_DEFAULT.contactPhone}</Row>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <Consent on={Boolean(v.consentRequired)} onToggle={() => set("consentRequired")(!v.consentRequired)}
                strong>{CONSENT_REQUIRED_LABEL}</Consent>
              <Consent on={Boolean(v.consentOptional)} onToggle={() => set("consentOptional")(!v.consentOptional)}>
                {CONSENT_OPTIONAL_LABEL}
              </Consent>
              <Consent on={Boolean(v.consentAds)} onToggle={() => set("consentAds")(!v.consentAds)}>
                {CONSENT_ADS_LABEL}
              </Consent>
              <Consent on={Boolean(v.wantsConsult)} onToggle={() => set("wantsConsult")(!v.wantsConsult)}>
                {CONSULT_LABEL}
              </Consent>
            </div>

            {/* 사람이 채우지 않는 미끼 입력 */}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={v.trap ?? ""}
              onChange={(e) => set("trap")(e.target.value)}
              style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />

            {err && <Msg bad>{err}</Msg>}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setStep(4)} disabled={sending}>이전</button>
              <button type="button" style={{ ...btn, flex: 1, opacity: sending ? .6 : 1 }}
                onClick={submit} disabled={sending || !applyOpen}>
                {sending ? "접수 중…" : "신청 제출"}
              </button>
            </div>
            <p style={{ fontSize: 12, color: C.ink3, lineHeight: 1.8, marginTop: 10, marginBottom: 0 }}>
              제출하시면 접수만 완료됩니다. 참석 확정이 아니며, 선정 결과와 Zoom 접속 링크는 별도로 안내드립니다.
            </p>
          </>
        )}
      </div>

      {/* ── 선정 안내(폼 아래) ── */}
      <div style={{ ...card, background: "#fffdf5", borderColor: "#f0e2b6" }}>
        <SecTitle>선정 안내</SecTitle>
        <p style={{ fontSize: 13.5, lineHeight: 1.85, color: C.ink2, margin: 0 }}>
          <b>{NOT_CONFIRMED_NOTICE}</b>
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.85, color: C.ink3, margin: "10px 0 0" }}>
          <b>선정 기준</b> · {SELECTION_CRITERIA}
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.85, color: C.ink3, margin: "8px 0 0" }}>
          신청은 인원 제한 없이 받습니다. 접수 순서로 자리가 정해지지 않습니다.
        </p>
      </div>

      {/* ── 한정 참석 ── */}
      <div style={{ ...card, padding: "16px 18px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ fontSize: 18, lineHeight: 1.2 }}>🎟️</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}>{LIMITED_SEATS_NOTE}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.8, color: C.ink3, marginTop: 4 }}>
              회차마다 선정 인원이 정해져 있어 모든 신청자가 참석하실 수는 없습니다.
              날짜 카드의 남은 자리는 <b>실제 선정 현황</b>을 그대로 보여 드립니다.
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 11.5, color: C.ink3, padding: "4px 0 30px" }}>
        {ORG_DEFAULT.legalName} · {ORG_DEFAULT.address}
      </div>
    </Shell>
  );
}

// ── 조각 ─────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "20px 16px 0" }}>
      <div style={{ maxWidth: 620, margin: "0 auto", display: "grid", gap: 14 }}>{children}</div>
    </div>
  );
}
const card: React.CSSProperties = {
  background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: "20px 18px",
};
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 10,
  padding: "11px 12px", fontSize: 15, color: C.ink, background: "#fff", outline: "none",
};
const btn: React.CSSProperties = {
  background: C.acc, color: "#fff", border: "none", borderRadius: 10, padding: "13px 18px",
  fontSize: 15, fontWeight: 700, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  background: "#fff", color: C.ink2, border: `1px solid ${C.line}`, borderRadius: 10,
  padding: "13px 18px", fontSize: 15, fontWeight: 600, cursor: "pointer",
};
const optTag: React.CSSProperties = { fontSize: 11, color: C.ink3, fontWeight: 500, marginLeft: 6 };

function SecTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 15, fontWeight: 800, color: C.ink, margin: "0 0 12px" }}>{children}</h2>;
}
function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, margin: "16px 0 6px" }}>
      {children}{required && <span style={{ color: C.bad, marginLeft: 4 }}>*</span>}
    </div>
  );
}
function Help({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: C.ink3, lineHeight: 1.7, margin: "-2px 0 6px" }}>{children}</div>;
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "3px 0" }}>
      <div style={{ flex: "0 0 118px", color: C.ink3, fontWeight: 600, wordBreak: "keep-all" }}>{k}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
function Msg({ children, bad }: { children: React.ReactNode; bad?: boolean }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: bad ? C.bad : C.ok,
      background: bad ? "#fff5f5" : "#f2fbf6", border: `1px solid ${bad ? "#ffd3d3" : "#c9ecd9"}`,
      borderRadius: 10, padding: "10px 12px", margin: "12px 0 0" }}>{children}</div>
  );
}
function Field({ label, required, value, onChange, placeholder, type, help }: {
  label: string; required?: boolean; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; help?: string;
}) {
  return (
    <>
      <Label required={required}>{label}</Label>
      {help && <Help>{help}</Help>}
      <input style={input} type={type ?? "text"} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </>
  );
}
function Chips({ options, value, onPick, block }: {
  options: string[]; value: string; onPick: (v: string) => void; block?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {options.map((o) => {
        const on = value === o;
        return (
          <button key={o} type="button" onClick={() => onPick(o)} aria-pressed={on}
            style={{
              cursor: "pointer", borderRadius: 999, padding: "9px 14px", fontSize: 13.5,
              border: `1.5px solid ${on ? C.acc : C.line}`, background: on ? C.accSoft : "#fff",
              color: on ? C.acc : C.ink2, fontWeight: on ? 700 : 500,
              flex: block ? "1 1 46%" : undefined, textAlign: block ? "left" : "center",
            }}>{o}</button>
        );
      })}
    </div>
  );
}
function Multi({ options, on, toggle }: { options: string[]; on: (v: string) => boolean; toggle: (v: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {options.map((o) => {
        const sel = on(o);
        return (
          <button key={o} type="button" onClick={() => toggle(o)} aria-pressed={sel}
            style={{
              cursor: "pointer", borderRadius: 999, padding: "9px 14px", fontSize: 13.5,
              border: `1.5px solid ${sel ? C.acc : C.line}`, background: sel ? C.accSoft : "#fff",
              color: sel ? C.acc : C.ink2, fontWeight: sel ? 700 : 500,
            }}>{sel ? "✓ " : ""}{o}</button>
        );
      })}
    </div>
  );
}
function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { key: string; label: string }[];
}) {
  return (
    <select style={input} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">선택 안 함</option>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}
function Check({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.ink2,
      marginTop: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={onToggle} style={{ width: 17, height: 17 }} />
      {children}
    </label>
  );
}
function Consent({ on, onToggle, children, strong }: {
  on: boolean; onToggle: () => void; children: React.ReactNode; strong?: boolean;
}) {
  return (
    <label style={{
      display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.7,
      color: C.ink2, cursor: "pointer", border: `1px solid ${on ? C.acc : C.line}`,
      background: on ? C.accSoft : "#fff", borderRadius: 10, padding: "11px 12px",
      fontWeight: strong ? 600 : 400,
    }}>
      <input type="checkbox" checked={on} onChange={onToggle} style={{ width: 18, height: 18, marginTop: 1, flex: "0 0 18px" }} />
      <span>{children}</span>
    </label>
  );
}
function StepBar({ step }: { step: number }) {
  const labels = ["회차", "기본정보", "비즈니스", "추가(선택)", "동의·제출"];
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
      {labels.map((l, i) => (
        <div key={l} style={{ flex: 1, textAlign: "center" }}>
          <div style={{ height: 3, borderRadius: 2, background: i < step ? C.acc : C.line }} />
          <div style={{ fontSize: 10.5, marginTop: 5, color: i < step ? C.acc : C.ink3, fontWeight: i === step - 1 ? 700 : 500 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}
function Nav({ back, next, nextOn }: { back?: () => void; next: () => void; nextOn: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
      {back && <button type="button" style={btnGhost} onClick={back}>이전</button>}
      <button type="button" style={{ ...btn, flex: 1, opacity: nextOn ? 1 : .45, cursor: nextOn ? "pointer" : "not-allowed" }}
        onClick={() => nextOn && next()} disabled={!nextOn}>다음</button>
    </div>
  );
}
