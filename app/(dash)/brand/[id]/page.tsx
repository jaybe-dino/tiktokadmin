import Link from "next/link";
import { notFound } from "next/navigation";
import Brand360AiButton from "@/components/Brand360AiButton";
import Brand360Comments, { type CommentRow, type HistoryRow } from "@/components/Brand360Comments";
import Brand360Company from "@/components/Brand360Company";
import { listCategoryNames } from "@/lib/brand-categories";
import ImportanceStars from "@/components/ImportanceStars";
import Brand360Onboarding from "@/components/Brand360Onboarding";
import Brand360TiktokAccount from "@/components/Brand360TiktokAccount";
import Brand360Contacts from "@/components/Brand360Contacts";
import Brand360Contract from "@/components/Brand360Contract";
import Brand360Docs from "@/components/Brand360Docs";
import Brand360GateCard, { type GateView } from "@/components/Brand360GateCard";
import GradeChecksCard from "@/components/GradeChecksCard";
import Brand360Header from "@/components/Brand360Header";
import Brand360Meetings, { type DraftRow, type MeetingRow } from "@/components/Brand360Meetings";
import Brand360Products from "@/components/Brand360Products";
import Brand360SurveyCard, { Brand360SurveyPanel } from "@/components/Brand360SurveyCard";
import Brand360Compose from "@/components/Brand360Compose";
import { getQuestions } from "@/lib/survey-db";
import CustomerEmails from "@/components/CustomerEmails";
import { listBrandComms } from "@/lib/email-link";
import Brand360Tabs, { type Brand360Tab } from "@/components/Brand360Tabs";
import TabJumpButton from "@/components/TabJumpButton";
import { GradeBadge, StateBadge } from "@/components/badges";
import { cardDeep } from "@/lib/repo/card";
import { query } from "@/lib/db";
import { brand360 } from "@/lib/repo/queries";
import { aggregateProgressCountries } from "@/lib/progress-countries";
import { currentUser } from "@/lib/auth";
import { listMeetingNotes } from "@/lib/meeting-notes";
import Brand360MeetingNotes from "@/components/Brand360MeetingNotes";
import Brand360Danger from "@/components/Brand360Danger";
import Brand360IntroSend from "@/components/Brand360IntroSend";
import TimelineAddEntry from "./TimelineAddEntry";
import TimelineJump from "./TimelineJump";
import { stageChecklist } from "@/lib/requirements";
import { humanElapsed } from "@/lib/time";
import { nextStepGuide } from "@/lib/meetings";
import { buildGateContext } from "@/lib/gates";
import { SOURCE_LABELS, STATE_LABELS, type Brand, type State } from "@/lib/types";

export const dynamic = "force-dynamic";
// 회의록 녹음 전사(Whisper)·AI 요약 서버액션이 이 라우트에서 실행 — 최대 60초 허용.
export const maxDuration = 60;

// 진행 스텝퍼 정의 — canonical state → 10단계 (dropped/churned 는 종료라 미표시)
const STEP_DEFS: { label: string; states: State[] }[] = [
  { label: "리드", states: ["lead_new"] },
  { label: "담당자배정", states: ["seminar"] },
  { label: "1:1 미팅", states: ["meeting"] },
  { label: "컨택", states: ["contact"] },
  { label: "계약검토", states: ["contract_review"] },
  { label: "계약완료", states: ["contract_done"] },
  { label: "서류", states: ["docs"] },
  { label: "셋업", states: ["setup"] },
  { label: "운영", states: ["live_mall", "live_onboarding"] },
  { label: "정산", states: ["settling"] },
];

function dday(due: string | null): string | null {
  if (!due) return null;
  const diff = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(diff)) return null;
  return diff === 0 ? "D-DAY" : diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

function initials(name: string): string {
  return (name || "?").trim().slice(0, 2);
}

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = rawId.trim(); // 복사된 URL의 꼬리 공백(%20) 방어
  const data = await brand360(id);
  if (!data) notFound();
  const { brand, signals, docs, paymentsManual, glovekSubs, timeline, stageHistory, adminUsers } = data;

  // 성능(Stage0): 서로 독립적인 조회는 한 번에 병렬 실행 — 순차 왕복 제거.
  //   (brand.id/brand.state 만 필요, 상호 의존 없음)
  const safe = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
  const progressCountries = await aggregateProgressCountries(brand.id).catch(() => [] as string[]);
  const [rawReqs, deep, emails, extra, gateCtx] = await Promise.all([
    stageChecklist(brand.id, brand.state).catch(() => []),
    cardDeep(brand.id).catch(() => null),
    listBrandComms(brand.id).catch(() => []),
    Promise.all([
      safe(query<{ alias: string }>(
        "SELECT alias FROM brand_aliases WHERE brand_id=$1 AND kind='name' ORDER BY created_at", [brand.id])),
      safe(query<CommentRow>(
        "SELECT id, author, body, created_at FROM comments WHERE brand_id=$1 ORDER BY created_at ASC LIMIT 50", [brand.id])),
      safe(query<{ name: string }>(
        `SELECT COALESCE(u.name, p.admin_user_id) AS name FROM presence p
           LEFT JOIN admin_users u ON u.id=p.admin_user_id
          WHERE p.brand_id=$1 AND p.at > now() - interval '15 minutes'`, [brand.id])),
      safe(query<DraftRow>(
        "SELECT id, kind, to_email, subject, body_md, created_at FROM email_drafts WHERE brand_id=$1 AND status='draft' ORDER BY created_at DESC LIMIT 5",
        [brand.id])),
      safe(query<MeetingRow>(
        `SELECT id, topic, status, started_at, scheduled_at, duration_min, recording_url,
                left(transcript, 20000) AS transcript, summary_md
           FROM meetings WHERE brand_id=$1
          ORDER BY COALESCE(started_at, scheduled_at, created_at) DESC LIMIT 8`, [brand.id])),
    ]),
    buildGateContext(brand).catch(() => null),
  ]);
  const [aliases, comments, presence, drafts, meetings] = extra;
  // moveHistory(성공 이동 이력)는 brand360 이 이미 가져온 stageHistory 에서 파생 — 중복 조회 제거.
  //   (브랜드 전이 이력은 십수 건 수준이라 최근 30 조회에 항상 포함 → 기존 LIMIT 10 결과와 동일)
  const moveHistory: HistoryRow[] = stageHistory
    .filter((h) => h.gate_passed)
    .slice(0, 10)
    .map((h) => ({ from_state: h.from_state, to_state: h.to_state, actor: h.actor, at: h.at }));
  const viewer = await currentUser();
  const canForce = viewer?.role === "lead" || viewer?.role === "exec";
  const meetingNotes = await listMeetingNotes(brand.id).catch(() => []);

  // 다음 스텝 게이트(현재) + 그다음 게이트(예고 — v3.1 gateNext) — 순수 로직(저렴)
  const gateRaw = gateCtx ? await nextStepGuide(brand, gateCtx).catch(() => null) : null;
  const gate: GateView | null = gateRaw
    ? { from: STATE_LABELS[gateRaw.from], toState: gateRaw.to, to: STATE_LABELS[gateRaw.to], items: gateRaw.items }
    : null;
  let gateNext: { from: string; to: string; items: { label: string; done: boolean }[] } | null = null;
  if (gateRaw && gateCtx) {
    const pseudo: Brand = { ...brand, state: gateRaw.to };
    const g2 = await nextStepGuide(pseudo, { ...gateCtx, brand: pseudo }).catch(() => null);
    if (g2) gateNext = { from: STATE_LABELS[g2.from], to: STATE_LABELS[g2.to], items: g2.items };
  }

  const stageReqs = rawReqs.map((r) => {
    if (r.kind === "field" && r.field_key) {
      const v = (brand as unknown as Record<string, unknown>)[r.field_key];
      const done = Array.isArray(v) ? v.length > 0 : Boolean(v);
      return { ...r, done };
    }
    return r;
  });

  // 스텝퍼 현재 위치
  const curStep = STEP_DEFS.findIndex((s) => s.states.includes(brand.state));
  const isTerminal = brand.state === "dropped" || brand.state === "churned";

  // 회사정보(사업자·세금·대표·온보딩 담당) 파생 담당자 — '브랜드측 담당자' 카드에 읽기전용으로 함께 표기.
  //   brand_contacts 에 이미 있는 이름은 중복 제외.
  const co = deep?.company;
  const existingNames = new Set((deep?.contacts ?? []).map((c) => c.name?.trim()).filter(Boolean));
  const companyContacts = ([
    co?.contact_name ? { label: "온보딩 담당", name: co.contact_name, email: co.contact_email ?? null, phone: co.contact_phone ?? null } : null,
    co?.rep_name ? { label: "대표자", name: co.rep_name, email: null, phone: null } : null,
    co?.tax_contact_name ? { label: "세금 담당", name: co.tax_contact_name, email: co.tax_email ?? null, phone: co.tax_contact_phone ?? null } : null,
    brand.contact_name ? { label: "기본 담당", name: brand.contact_name, email: brand.email ?? null, phone: brand.phone ?? null } : null,
  ].filter(Boolean) as { label: string; name: string; email: string | null; phone: string | null }[])
    .filter((c) => c.name.trim() && !existingNames.has(c.name.trim()))
    // 파생 목록 내 동일 이름 중복 제거(첫 항목 유지)
    .filter((c, i, arr) => arr.findIndex((x) => x.name.trim() === c.name.trim()) === i);

  const sourceLabel = SOURCE_LABELS[brand.source] ?? brand.source;
  const nextDday = dday(brand.due_date);

  // 설문 문항 라벨(DB 문항뱅크) — 응답 키를 한글 라벨·섹션으로 표시(원본 키 노출 방지). 실패 시 상수 폴백.
  const [preQ, postQ] = await Promise.all([
    getQuestions("pre_meeting").catch(() => []),
    getQuestions("post_meeting").catch(() => []),
  ]);
  const questionSets = { pre_meeting: preQ, post_meeting: postQ };
  const categoryNames = await listCategoryNames().catch(() => ["스킨케어", "색조", "더마"]);

  // 메일 수신자 후보 — 브랜드측 담당자(연락처 카드) + 회사정보 담당자, 이메일 있는 항목만·중복 제거.
  const mailContacts = (() => {
    const out: { name: string; email: string }[] = [];
    const seen = new Set<string>();
    const push = (name: string, email: string | null | undefined) => {
      const e = (email ?? "").trim().toLowerCase();
      if (!e || seen.has(e)) return;
      seen.add(e);
      out.push({ name: (name ?? "").trim() || e, email: e });
    };
    push(brand.contact_name ?? brand.brand_name, brand.email);
    for (const c of deep?.contacts ?? []) push(c.name, c.email);
    for (const c of companyContacts) push(`${c.label} ${c.name}`, c.email);
    return out;
  })();

  // 헤더 메타 (v3.1: 카테고리 · URL · 사업자 · 유입 · 접촉)
  const metaBits = [
    brand.category || "카테고리 미상",
    brand.brand_url || null,
    brand.biz_no ? `사업자 ${brand.biz_no}` : null,
    `${sourceLabel} 유입`,
    brand.last_contact_at ? `접촉 ${humanElapsed(brand.last_contact_at)} 전` : "접촉 기록 없음",
  ].filter(Boolean) as string[];

  // ── 탭 패널 (v3.1 s-b360) ──────────────────────────────────
  // 개요 — g31: 좌측 AI브리프·설문·담당자, 우측 게이트·5대 지표
  const panelOverview = (
    <div className="grid g31" style={{ gap: 14 }}>
      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <div className="aiw">
          <h5>
            🤖 AI 사전분석 브리프
            {brand.grade && <span style={{ color: "var(--ink3)", fontWeight: 400 }}>· 등급 {brand.grade}</span>}
            <TabJumpButton label="회사정보" className="btn sm" style={{ marginLeft: "auto" }}>심층 분석 →</TabJumpButton>
          </h5>
          {brand.brief_md ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.7, fontFamily: "inherit", color: "var(--ink)" }}>{brand.brief_md}</pre>
          ) : (
            <p className="note" style={{ marginTop: 4 }}>브리프 미생성 (사전분석 에이전트 대기 중)</p>
          )}
        </div>

        <Brand360SurveyCard brandId={brand.id} surveys={deep?.surveys ?? []} state={brand.state} />

        <Brand360Contacts brandId={brand.id} contacts={deep?.contacts ?? []} companyContacts={companyContacts} />
      </div>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        {/* 진행국가 — 목표국·운영견적·온보딩 KYC·물류에서 합산(중복 제거) */}
        <div className="card" style={{ padding: 14 }}>
          <b style={{ display: "block", marginBottom: 8, fontSize: 13 }}>🌏 진행국가</b>
          {progressCountries.length === 0 ? (
            <p className="note" style={{ margin: 0 }}>아직 진행국가가 없습니다 — 운영견적·온보딩 서류에서 국가를 입력하면 표기됩니다.</p>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {progressCountries.map((c) => <span key={c} className="pill" style={{ background: "#eef5ff", color: "#1e40af", fontSize: 12 }}>{c}</span>)}
            </div>
          )}
        </div>

        <Brand360GateCard brandId={brand.id} gate={gate} gateNext={gateNext} stageReqs={stageReqs} canForce={canForce} />

        {/* 기획 확정: 담당자 보정 + 미입력 "입력 필요" + 운영 전이 전 전부 입력 */}
        <GradeChecksCard
          brandId={brand.id}
          initial={((brand as unknown as Record<string, unknown>).grade_checks as Record<string, boolean>) ?? {}}
          grade={brand.grade}
        />

        <div className="card">
          <div className="hd"><b>진단 시그널</b>{brand.grade && <GradeBadge grade={brand.grade} />}</div>
          <div className="bd" style={{ fontSize: 12.5 }}>
            {brand.grade ? (
              <div className="gi" style={{ display: "flex", gap: 8, padding: "4px 0" }}>
                <span style={{ color: "var(--ok)" }}>✓</span>
                진단 등급 <b>{brand.grade}</b>
                {brand.rec_track && <span className="chip" style={{ fontSize: 10 }}>{brand.rec_track === "onboarding" ? "온보딩 추천" : "라이브 추천"}</span>}
              </div>
            ) : (
              <p className="note">진단 미완료 — 셀프진단 5문항(사전분석) 응답 시 등급이 산출됩니다.</p>
            )}
            {signals.length > 0 && (
              <table className="t" style={{ marginTop: 8 }}>
                <thead>
                  <tr><th>지표</th><th>값</th><th>신뢰도</th></tr>
                </thead>
                <tbody>
                  {signals.slice(0, 6).map((s, i) => (
                    <tr key={i}>
                      <td>{s.source} · {s.metric}</td>
                      <td>{s.value_num ?? s.value_text ?? "—"}</td>
                      <td>{s.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Brand360AiButton brandId={brand.id} />
        </div>
      </div>
    </div>
  );

  // 회사정보 — v3.1 심층 분석 + 사업자/세금계산서/정산 계좌/브랜드 정보 + 온보딩 KYC
  const panelCompany = (
    <>
      <Brand360Company brand={brand} company={deep?.company ?? null} assets={deep?.assets ?? []} categories={categoryNames} />
      <Brand360Onboarding brand={brand} company={deep?.company ?? null} />
      <Brand360TiktokAccount brand={brand} />
    </>
  );

  // 타임라인
  const panelTimeline = (
    <section className="card">
      <div className="bd">
        <TimelineAddEntry brandId={brand.id} />
        {timeline.length === 0 ? (
          <p className="note">기록된 이력이 없습니다.</p>
        ) : (
          <div className="tl">
            {timeline.map((t, i) => {
              const auto = !t.actor || t.actor === "system" || t.actor === "auto";
              return (
                <div key={i} className={`ev${auto ? " auto" : ""}`}>
                  <div className="w">
                    {t.at.slice(5, 16).replace("T", " ")}
                    {t.actor && ` · ${t.actor}`}
                  </div>
                  {t.kind === "gate_fail" && <span className="chip red" style={{ marginRight: 6, fontSize: 10 }}>게이트 실패</span>}
                  {t.link ? (
                    <TimelineJump tab={t.link.tab} anchor={t.link.anchor}>{t.text} ↗</TimelineJump>
                  ) : (
                    <span style={{ fontSize: 12.5 }}>{t.text}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  // 회의록 — 자동(미팅 요약·전사) 날짜별 + 직접 입력(텍스트·파일)
  const panelMeetingNotes = (
    <Brand360MeetingNotes
      brandId={brand.id}
      meetings={meetings.map((m) => ({ id: m.id, topic: m.topic, status: m.status, started_at: m.started_at, scheduled_at: m.scheduled_at, summary_md: m.summary_md, transcript: m.transcript }))}
      notes={meetingNotes}
    />
  );

  // 미팅·메일 — 미팅(회의록·다음 액션 반영) + 팔로업 초안(승인·발송) + 연동 메일(기존 기능 유지)
  const panelMail = (
    <div style={{ display: "grid", gap: 14 }}>
      <Brand360Compose brandId={brand.id} brandEmail={brand.email} contacts={mailContacts} />
      <Brand360Meetings brandId={brand.id} meetings={meetings} drafts={drafts} />
      <CustomerEmails brandId={brand.id} emails={emails} />
    </div>
  );

  // 서류·물류 — 체크리스트(토글) + 물류 계약 현황(등록·갱신)
  const panelDocs = (
    <Brand360Docs
      brandId={brand.id}
      docItems={docs.items.map((i) => ({ item_key: i.item_key, label: i.label, done: i.done, source: i.source }))}
      done={docs.done}
      total={docs.total}
      logistics={deep?.logistics ?? []}
    />
  );

  // 제품·인증·재고 — 제품 마스터 · 인증 매트릭스 · 초기 재고
  const panelProducts = (
    <Brand360Products
      brandId={brand.id}
      products={deep?.products ?? []}
      certs={deep?.certs ?? []}
      inventory={deep?.inventory ?? []}
      setupStage={brand.state === "setup" || brand.state === "live_mall" || brand.state === "live_onboarding" || brand.state === "settling"}
    />
  );

  // 계약·결제 — 계약 등록/상태 + 결제 안내·수기 확인
  const panelContract = (
    <Brand360Contract
      brandId={brand.id}
      contracts={deep?.contracts ?? []}
      paymentsManual={paymentsManual}
      glovekSubs={glovekSubs}
      proposals={(data.proposals ?? []).map((p) => ({ id: p.id, title: p.title, amount: p.amount, status: p.status }))}
    />
  );

  // 운영·정산
  const panelOps = (
    <section className="card">
      <div className="bd">
        <p className="note">
          운영·정산 데이터는 <b>운영 중</b> 단계부터 활성화됩니다 — 사이클·시딩·라이브·CS·정산 런이 이 탭에 나타납니다.{" "}
          (<Link href="/ops" style={{ color: "var(--acc)", fontWeight: 700 }}>좌측 메뉴 → 운영 사이클</Link>)
        </p>
      </div>
    </section>
  );

  // 메모·협업 — 코멘트(실등록) + 감사 이력
  const panelNotes = (
    <Brand360Comments
      brandId={brand.id}
      comments={comments}
      history={moveHistory}
      viewers={presence.map((p) => p.name)}
    />
  );

  // 설문 — 전체 응답 상세(섹션별·겹침 없음). 문항 라벨은 DB 문항뱅크 사용.
  const panelSurvey = (
    <Brand360SurveyPanel surveys={deep?.surveys ?? []} questionSets={questionSets} />
  );

  const tabs: Brand360Tab[] = [
    { key: "ov", label: "개요", node: panelOverview },
    { key: "sv", label: "설문", node: panelSurvey },
    { key: "co", label: "회사정보", node: panelCompany },
    { key: "tl", label: "타임라인", node: panelTimeline },
    { key: "mm", label: "미팅·메일", node: panelMail },
    { key: "mn", label: "회의록", node: panelMeetingNotes },
    { key: "dc", label: "서류·물류", node: panelDocs },
    { key: "pd", label: "제품·인증·재고", node: panelProducts },
    { key: "ct", label: "계약·결제", node: panelContract },
    { key: "op", label: "운영·정산", node: panelOps },
    { key: "nt", label: "메모·협업", node: panelNotes },
  ];

  return (
    <div className="max-w-6xl">
      <Link href="/" className="text-sm text-muted hover:text-pink">← 보드</Link>

      {/* ===== 헤더 카드 (v3.1 s-b360) ===== */}
      <div className="card" style={{ marginTop: 8, marginBottom: 14 }}>
        <div className="bd" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg,#a78bfa,#7c3aed)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800,
            }}
          >
            {initials(brand.brand_name)}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 18, fontWeight: 800 }}>{brand.brand_name}</h1>
              <ImportanceStars brandId={brand.id} value={brand.importance ?? 0} size={17} />
              <GradeBadge grade={brand.grade} />
              <StateBadge state={brand.state} />
              {brand.rec_track && <span className="chip">{brand.rec_track === "onboarding" ? "온보딩 추천" : "라이브 추천"}</span>}
              {aliases.length > 0 && <span className="chip amb" title={aliases.map((a) => a.alias).join(", ")}>별칭 {aliases.length}</span>}
            </div>
            <div style={{ color: "var(--ink3)", fontSize: 12, marginTop: 2 }}>{metaBits.join(" · ")}</div>
          </div>
          <Brand360Header brand={brand} adminUsers={adminUsers} ddayLabel={nextDday} />
          <Brand360IntroSend brandId={brand.id} />
        </div>

        {/* 진행 스텝퍼 */}
        <div className="bd" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div className="step">
            {STEP_DEFS.map((s, i) => {
              const done = !isTerminal && curStep >= 0 && i < curStep;
              const cur = !isTerminal && i === curStep;
              return (
                <div key={s.label} className={`s${done ? " done" : ""}${cur ? " cur" : ""}`}>
                  <span className="b">{done ? "✓" : i + 1}</span>
                  {s.label}
                </div>
              );
            })}
          </div>
          {isTerminal && (
            <div className="note" style={{ marginTop: 8 }}>
              이 브랜드는 <b>{brand.state === "dropped" ? "드랍(보류)" : "해지"}</b> 상태입니다 — 진행 스텝이 중단되었습니다.
            </div>
          )}
        </div>
      </div>

      {/* ===== 상단 탭 (v3.1 s-b360 구성) ===== */}
      <Brand360Tabs tabs={tabs} />

      {/* ===== 위험 구역 — 완전 삭제(파트장/대표 전용) ===== */}
      {canForce && <Brand360Danger brandId={brand.id} brandName={brand.brand_name} />}
    </div>
  );
}
