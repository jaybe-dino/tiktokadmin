"use client";
// 공개 신청 폼 — 로그인 없이 열리고, 한 페이지에서 신청이 끝난다.
//   날짜 카드로 희망 회차 1개를 고르고 아래로 쭉 내려가며 입력한다(단계 이동 없음).
//   남은 자리는 설정된 선정 인원에서 실제 선정 수를 뺀 값이다 — 꾸며낸 수를 적지 않는다.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { publicSessionsAction, submitSeminarApplyAction, type PublicSessionView } from "./actions";
import {
  PROGRAM_TITLE, PROGRAM_TAGLINE, SESSION_TIME_NOTE, SAME_PROGRAM_NOTE, INTRO_PARAGRAPH,
  LIMITED_SEATS_NOTE, JOB_ROLES, PRODUCT_CATEGORIES, OVERSEAS_STAGES, TARGET_COUNTRIES,
  REVENUE_BANDS, CONSENT_REQUIRED_LABEL, CONSENT_ADS_LABEL, CONSULT_LABEL,
  COLLECT_REQUIRED, COLLECT_OPTIONAL, PURPOSE_REQUIRED, PURPOSE_OPTIONAL, PURPOSE_ADS,
  REFUSAL_NOTICE, SELECTION_CRITERIA, NOT_CONFIRMED_NOTICE, APPLY_DONE_NOTICE,
  ORG_DEFAULT, RETENTION_DEFAULT, retentionSentence, fmtSessionWhen, fmtSessionShort,
  formBlockers, type SapFormInput,
} from "@/lib/seminar-apply-model";

const C = {
  ink: "#0b1020", ink2: "#39425a", ink3: "#6e7892", line: "#e2e7f0",
  acc: "#3b5bfd", acc2: "#7c3aed", accSoft: "#eef2ff",
  gold: "#ffb020", bg: "#f4f6fb", bad: "#e03131", ok: "#0f9d58",
};
const HERO_BG = "linear-gradient(145deg,#0b1020 0%,#17224d 48%,#2b1d6b 100%)";
const CTA_BG = "linear-gradient(135deg,#3b5bfd 0%,#7c3aed 100%)";

export default function SeminarApplyForm() {
  const [load, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const [sessions, setSessions] = useState<PublicSessionView[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [applyOpen, setApplyOpen] = useState(true);

  const [v, setV] = useState<SapFormInput>({ targetCountries: [] });
  const [err, setErr] = useState("");
  const [done, setDone] = useState<null | { already: boolean }>(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const [utm, setUtm] = useState<{ source?: string; medium?: string; campaign?: string; campaignId?: string }>({});
  const formRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof SapFormInput>(k: K) => (x: SapFormInput[K]) => setV((p) => ({ ...p, [k]: x }));
  const toggleCountry = (val: string) => setV((p) => {
    const cur = Array.isArray(p.targetCountries) ? (p.targetCountries as string[]) : [];
    return { ...p, targetCountries: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] };
  });
  const hasCountry = (val: string) =>
    Array.isArray(v.targetCountries) && (v.targetCountries as string[]).includes(val);

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
  const picked = (sessions ?? []).find((s) => s.sessionNo === Number(v.sessionNo));

  const submit = () => startSend(async () => {
    setErr("");
    const blockers = formBlockers(v);
    if (blockers.length) {
      setErr(blockers[0]);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const r = await submitSeminarApplyAction(v, utm);
    if (!r.ok) { setErr(r.error ?? "저장하지 못했습니다. 다시 시도해 주세요."); return; }
    setDone({ already: Boolean(r.already) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ── 완료 ──
  if (done) {
    return (
      <div style={{ minHeight: "100vh", background: HERO_BG, display: "grid", placeItems: "center", padding: "24px 16px" }}>
        <div style={{ ...card, maxWidth: 520, width: "100%", textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h2 style={{ fontSize: 21, margin: "14px 0 10px", color: C.ink, letterSpacing: "-.02em" }}>
            {done.already ? "이미 접수된 신청이 있습니다" : "신청이 접수되었습니다"}
          </h2>
          <p style={{ fontSize: 14.5, lineHeight: 1.85, color: C.ink2, margin: 0 }}>
            {done.already
              ? "같은 회차에 같은 이메일로 접수된 신청이 있어 새로 접수하지 않았습니다. 선정 결과와 Zoom 접속 링크는 별도로 안내드립니다."
              : APPLY_DONE_NOTICE}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh" }}>
      {/* ══ HERO ══ */}
      <div style={{ background: HERO_BG, color: "#fff", padding: "40px 18px 112px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -90, right: -70, width: 240, height: 240, borderRadius: "50%",
          background: "radial-gradient(circle,rgba(124,58,237,.55),transparent 68%)" }} />
        <div style={{ position: "absolute", bottom: -110, left: -80, width: 260, height: 260, borderRadius: "50%",
          background: "radial-gradient(circle,rgba(59,91,253,.42),transparent 68%)" }} />
        <div style={{ maxWidth: 640, margin: "0 auto", position: "relative" }}>
          <div style={{ fontSize: 11, letterSpacing: ".16em", fontWeight: 800, color: "#9db2ff" }}>
            DINO STUDIO · GloveK
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "16px 0 14px" }}>
            <Pill bg="rgba(255,176,32,.16)" color={C.gold} border="rgba(255,176,32,.42)">무료</Pill>
            <Pill bg="rgba(255,255,255,.1)" color="#dfe6ff" border="rgba(255,255,255,.22)">Zoom 온라인</Pill>
            <Pill bg="rgba(255,255,255,.1)" color="#dfe6ff" border="rgba(255,255,255,.22)">60분</Pill>
          </div>
          <h1 style={{ fontSize: 33, lineHeight: 1.28, margin: 0, fontWeight: 900, letterSpacing: "-.035em" }}>
            브랜드 해외매출<br />
            <span style={{ background: "linear-gradient(90deg,#8ba4ff,#c4a2ff)", WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent", backgroundClip: "text" }}>실행전략 세미나</span>
          </h1>
          <div style={{ display: "inline-block", marginTop: 16, background: "rgba(255,255,255,.12)",
            border: "1px solid rgba(255,255,255,.2)", borderRadius: 999, padding: "8px 16px",
            fontSize: 13.5, fontWeight: 700, color: "#fff" }}>{PROGRAM_TAGLINE}</div>
          <p style={{ fontSize: 15, lineHeight: 1.85, color: "#c3cbe6", margin: "20px 0 0" }}>
            {INTRO_PARAGRAPH}
          </p>
          <div style={{ fontSize: 13, color: "#8e9ac2", marginTop: 14 }}>{SESSION_TIME_NOTE}</div>
        </div>
      </div>

      {/* ══ 본문 ══ */}
      <div style={{ maxWidth: 640, margin: "-66px auto 0", padding: "0 16px 120px", display: "grid", gap: 14 }}>

        {/* ── 신청(한 페이지) ── */}
        <div ref={formRef} style={{ ...card, padding: "22px 18px 24px" }}>
          <h2 style={{ fontSize: 19, fontWeight: 900, color: C.ink, margin: "0 0 4px", letterSpacing: "-.025em" }}>
            세미나 신청
          </h2>
          <div style={{ fontSize: 12.5, color: C.ink3, marginBottom: 18 }}>
            한 페이지에서 바로 끝납니다 · <span style={{ color: C.bad }}>*</span> 는 필수입니다
          </div>

          {loadErr && <Msg bad>{loadErr}</Msg>}
          {!applyOpen && !loadErr && <Msg bad>현재 신청을 받지 않고 있습니다.</Msg>}

          {/* ① 회차 */}
          <Step n={1} title="희망 회차" required />
          <Help>{SAME_PROGRAM_NOTE}</Help>
          {load && !sessions && <div style={{ fontSize: 13, color: C.ink3 }}>회차를 불러오는 중…</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))", gap: 9, marginTop: 10 }}>
            {(sessions ?? []).map((s) => {
              const on = Number(v.sessionNo) === s.sessionNo;
              const full = s.seatsLeft === 0;
              return (
                <button key={s.sessionNo} type="button" disabled={full}
                  onClick={() => set("sessionNo")(s.sessionNo)} aria-pressed={on}
                  style={{
                    textAlign: "left", cursor: full ? "not-allowed" : "pointer", borderRadius: 14,
                    padding: "14px 14px", position: "relative", opacity: full ? .5 : 1,
                    border: `2px solid ${on ? C.acc : C.line}`,
                    background: on ? C.accSoft : "#fff",
                    boxShadow: on ? "0 6px 18px rgba(59,91,253,.18)" : "none",
                    transition: "all .15s",
                  }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: on ? C.acc : C.ink3, letterSpacing: ".04em" }}>
                    {s.sessionNo}회차
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 900, color: C.ink, margin: "3px 0 2px", letterSpacing: "-.03em" }}>
                    {fmtSessionShort(s.startsAt)}
                  </div>
                  <div style={{ fontSize: 12, color: C.ink3 }}>11:00~12:00</div>
                  {/* 남은 자리 = 설정된 선정 인원 − 실제 선정 수 */}
                  <div style={{ fontSize: 12, fontWeight: 800, marginTop: 7,
                    color: full ? C.bad : on ? C.acc : C.ok }}>
                    {full ? "선정 마감" : `남은 자리 ${s.seatsLeft}명`}
                  </div>
                </button>
              );
            })}
          </div>
          {sessions && sessions.length === 0 && !loadErr && <Msg bad>현재 열려 있는 회차가 없습니다.</Msg>}
          {picked && (
            <div style={{ marginTop: 11, fontSize: 12.5, color: C.acc, fontWeight: 700,
              background: C.accSoft, borderRadius: 10, padding: "9px 12px" }}>
              선택: {fmtSessionWhen(picked.startsAt, picked.endsAt)}
            </div>
          )}

          {/* ② 신청자 */}
          <Step n={2} title="신청자 정보" />
          <Field label="회사명" required value={v.companyName ?? ""} onChange={set("companyName")} placeholder="예: (주)디노스튜디오" />
          <Label required>브랜드명</Label>
          <input style={input} value={v.brandName ?? ""} disabled={Boolean(v.noBrand)}
            onChange={(e) => set("brandName")(e.target.value)}
            placeholder={v.noBrand ? "브랜드 미보유" : "브랜드명을 적어 주세요"} />
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
          <Field label="연락처" required type="tel" value={v.phone ?? ""} onChange={set("phone")}
            placeholder="010-0000-0000" />
          <Field label="공식 URL" value={v.siteUrl ?? ""} onChange={set("siteUrl")}
            placeholder="brand.com (선택)" />

          {/* ③ 브랜드 */}
          <Step n={3} title="브랜드 현황" />
          <Label required>상품 카테고리</Label>
          <Chips options={[...PRODUCT_CATEGORIES]} value={v.productCategory ?? ""} onPick={(x) => set("productCategory")(x)} />
          <Label required>현재 해외진출 단계</Label>
          <Chips options={[...OVERSEAS_STAGES]} value={v.overseasStage ?? ""} onPick={(x) => set("overseasStage")(x)} block />
          <Label required>희망 국가 <span style={optTag}>복수 선택 가능</span></Label>
          <Multi options={[...TARGET_COUNTRIES]} on={hasCountry} toggle={toggleCountry} />
          <Label>매출 구간 <span style={optTag}>선택</span></Label>
          <select style={input} value={v.revenueBand ?? ""} onChange={(e) => set("revenueBand")(e.target.value)}>
            <option value="">선택 안 함</option>
            {REVENUE_BANDS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <Label required>세미나에서 듣고 싶은 질문 또는 해결하고 싶은 과제</Label>
          <Help>적어 주신 내용을 선정과 세미나 구성에 참고합니다.</Help>
          <textarea style={{ ...input, minHeight: 104, resize: "vertical" }} value={v.question ?? ""}
            onChange={(e) => set("question")(e.target.value)}
            placeholder="예) 틱톡샵 온보딩 후 초기 주문을 만들려면 콘텐츠를 어떻게 써야 할지 궁금합니다." />

          {/* ④ 동의 */}
          <Step n={4} title="동의" />
          <Consent on={Boolean(v.consentRequired)} onToggle={() => set("consentRequired")(!v.consentRequired)} strong>
            {CONSENT_REQUIRED_LABEL}
            <button type="button" onClick={(e) => { e.preventDefault(); setShowPolicy((x) => !x); }}
              style={linkBtn}>{showPolicy ? "접기" : "자세히"}</button>
          </Consent>
          {showPolicy && (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 13, background: C.bg,
              fontSize: 12, lineHeight: 1.8, color: C.ink2, marginTop: -2 }}>
              <Row k="목적">{PURPOSE_REQUIRED}</Row>
              <Row k="필수 항목">{COLLECT_REQUIRED}</Row>
              <Row k="선택 항목">{COLLECT_OPTIONAL} — {PURPOSE_OPTIONAL}</Row>
              <Row k="보유 기간">{retention.required}</Row>
              <Row k="거부 권리">{REFUSAL_NOTICE}</Row>
              <Row k="광고 수신">{PURPOSE_ADS} · {retention.ads}</Row>
              <div style={{ height: 8 }} />
              <Row k="운영자">{ORG_DEFAULT.legalName}</Row>
              <Row k="보호책임자">{ORG_DEFAULT.repName}</Row>
              {ORG_DEFAULT.bizNo && <Row k="사업자등록번호">{ORG_DEFAULT.bizNo}</Row>}
              <Row k="주소">{ORG_DEFAULT.address}</Row>
              <Row k="문의">{ORG_DEFAULT.contactEmail} · {ORG_DEFAULT.contactPhone}</Row>
            </div>
          )}
          <Consent on={Boolean(v.consentAds)} onToggle={() => set("consentAds")(!v.consentAds)}>
            {CONSENT_ADS_LABEL}
          </Consent>
          <Consent on={Boolean(v.wantsConsult)} onToggle={() => set("wantsConsult")(!v.wantsConsult)}>
            {CONSULT_LABEL}
          </Consent>

          {/* 사람이 채우지 않는 미끼 입력 */}
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={v.trap ?? ""}
            onChange={(e) => set("trap")(e.target.value)}
            style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />

          {err && <Msg bad>{err}</Msg>}

          <button type="button" onClick={submit} disabled={sending || !applyOpen}
            style={{
              width: "100%", marginTop: 20, border: "none", borderRadius: 14, padding: "17px 20px",
              fontSize: 16.5, fontWeight: 900, color: "#fff", background: CTA_BG, letterSpacing: "-.02em",
              cursor: sending ? "wait" : "pointer", opacity: sending || !applyOpen ? .6 : 1,
              boxShadow: "0 10px 24px rgba(59,91,253,.32)",
            }}>
            {sending ? "접수 중…" : "무료로 신청하기"}
          </button>
          <p style={{ fontSize: 11.5, color: C.ink3, lineHeight: 1.75, marginTop: 10, marginBottom: 0, textAlign: "center" }}>
            제출하시면 접수만 완료됩니다. 참석 확정이 아니며, 선정 결과와 Zoom 접속 링크는 별도로 안내드립니다.
          </p>
        </div>

        {/* ── 선정 안내 ── */}
        <div style={{ ...card, background: "linear-gradient(160deg,#fffdf6,#fff8e8)", borderColor: "#f2e3bb" }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, color: C.ink, margin: "0 0 11px", letterSpacing: "-.02em" }}>
            선정 안내
          </h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.85, color: C.ink2, margin: 0, fontWeight: 700 }}>
            {NOT_CONFIRMED_NOTICE}
          </p>
          <p style={{ fontSize: 12.5, lineHeight: 1.85, color: C.ink3, margin: "10px 0 0" }}>
            <b>선정 기준</b> · {SELECTION_CRITERIA}
          </p>
          <p style={{ fontSize: 12.5, lineHeight: 1.85, color: C.ink3, margin: "8px 0 0" }}>
            신청은 인원 제한 없이 받습니다. 접수 순서로 자리가 정해지지 않습니다.
          </p>
        </div>

        {/* ── 한정 참석 ── */}
        <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-start", padding: "17px 18px" }}>
          <div style={{ fontSize: 20, lineHeight: 1.1 }}>🎟️</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14.5, color: C.ink, letterSpacing: "-.02em" }}>{LIMITED_SEATS_NOTE}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.8, color: C.ink3, marginTop: 4 }}>
              회차마다 선정 인원이 정해져 있어 모든 신청자가 참석하실 수는 없습니다.
              날짜 카드의 남은 자리는 <b>실제 선정 현황</b>을 그대로 보여 드립니다.
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", fontSize: 11.5, color: C.ink3, paddingTop: 6 }}>
          {ORG_DEFAULT.legalName} · {ORG_DEFAULT.address}
        </div>
      </div>

      {/* ── 모바일 고정 CTA ── */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, padding: "10px 16px calc(10px + env(safe-area-inset-bottom))",
        background: "rgba(255,255,255,.92)", backdropFilter: "blur(10px)", borderTop: `1px solid ${C.line}`, zIndex: 20,
      }}>
        <button type="button" onClick={submit} disabled={sending || !applyOpen}
          style={{
            width: "100%", maxWidth: 608, margin: "0 auto", display: "block", border: "none", borderRadius: 12,
            padding: "15px 20px", fontSize: 15.5, fontWeight: 900, color: "#fff", background: CTA_BG,
            cursor: sending ? "wait" : "pointer", opacity: sending || !applyOpen ? .6 : 1,
            boxShadow: "0 6px 18px rgba(59,91,253,.3)",
          }}>
          {sending ? "접수 중…" : "무료로 신청하기"}
        </button>
      </div>
    </div>
  );
}

// ── 조각 ─────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "20px 18px",
  boxShadow: "0 2px 14px rgba(11,16,32,.05)",
};
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 11,
  padding: "12px 13px", fontSize: 15, color: C.ink, background: "#fff", outline: "none",
};
const optTag: React.CSSProperties = { fontSize: 11, color: C.ink3, fontWeight: 500, marginLeft: 6 };
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: C.acc, fontSize: 11.5, fontWeight: 700,
  textDecoration: "underline", cursor: "pointer", padding: "0 0 0 6px",
};

function Pill({ children, bg, color, border }: { children: React.ReactNode; bg: string; color: string; border: string }) {
  return (
    <span style={{ background: bg, color, border: `1px solid ${border}`, borderRadius: 999,
      padding: "5px 11px", fontSize: 11.5, fontWeight: 800 }}>{children}</span>
  );
}
function Step({ n, title, required }: { n: number; title: string; required?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "center", margin: "26px 0 10px",
      paddingTop: n > 1 ? 18 : 0, borderTop: n > 1 ? `1px solid ${C.line}` : "none" }}>
      <span style={{ flex: "0 0 23px", height: 23, borderRadius: 7, background: CTA_BG, color: "#fff",
        fontSize: 11.5, fontWeight: 900, display: "grid", placeItems: "center" }}>{n}</span>
      <span style={{ fontSize: 15, fontWeight: 900, color: C.ink, letterSpacing: "-.02em" }}>
        {title}{required && <span style={{ color: C.bad, marginLeft: 3 }}>*</span>}
      </span>
    </div>
  );
}
function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, margin: "16px 0 6px" }}>
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
      <div style={{ flex: "0 0 86px", color: C.ink3, fontWeight: 700, wordBreak: "keep-all" }}>{k}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
function Msg({ children, bad }: { children: React.ReactNode; bad?: boolean }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: bad ? C.bad : C.ok,
      background: bad ? "#fff5f5" : "#f1fbf5", border: `1px solid ${bad ? "#ffd6d6" : "#c7ebd6"}`,
      borderRadius: 11, padding: "11px 13px", margin: "14px 0 0", fontWeight: 600 }}>{children}</div>
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
              color: on ? C.acc : C.ink2, fontWeight: on ? 800 : 500,
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
              color: sel ? C.acc : C.ink2, fontWeight: sel ? 800 : 500,
            }}>{sel ? "✓ " : ""}{o}</button>
        );
      })}
    </div>
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
      display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.7,
      color: C.ink2, cursor: "pointer", border: `1.5px solid ${on ? C.acc : C.line}`,
      background: on ? C.accSoft : "#fff", borderRadius: 12, padding: "12px 13px",
      fontWeight: strong ? 700 : 400, marginBottom: 8,
    }}>
      <input type="checkbox" checked={on} onChange={onToggle}
        style={{ width: 18, height: 18, marginTop: 1, flex: "0 0 18px", accentColor: C.acc }} />
      <span>{children}</span>
    </label>
  );
}
