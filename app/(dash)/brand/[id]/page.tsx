import Link from "next/link";
import { notFound } from "next/navigation";
import Brand360AiButton from "@/components/Brand360AiButton";
import Brand360Comments, { type CommentRow, type HistoryRow } from "@/components/Brand360Comments";
import Brand360Company from "@/components/Brand360Company";
import Brand360Contacts from "@/components/Brand360Contacts";
import Brand360Contract from "@/components/Brand360Contract";
import Brand360Docs from "@/components/Brand360Docs";
import Brand360GateCard, { type GateView } from "@/components/Brand360GateCard";
import Brand360Header from "@/components/Brand360Header";
import Brand360Meetings, { type DraftRow, type MeetingRow } from "@/components/Brand360Meetings";
import Brand360Products from "@/components/Brand360Products";
import Brand360SurveyCard from "@/components/Brand360SurveyCard";
import CustomerEmails from "@/components/CustomerEmails";
import { listBrandEmails } from "@/lib/email-link";
import Brand360Tabs, { type Brand360Tab } from "@/components/Brand360Tabs";
import TabJumpButton from "@/components/TabJumpButton";
import { GradeBadge, StateBadge } from "@/components/badges";
import { cardDeep } from "@/lib/repo/card";
import { query } from "@/lib/db";
import { brand360 } from "@/lib/repo/queries";
import { stageChecklist } from "@/lib/requirements";
import { humanElapsed } from "@/lib/time";
import { nextStepGuide } from "@/lib/meetings";
import { buildGateContext } from "@/lib/gates";
import { SOURCE_LABELS, STATE_LABELS, type Brand, type State } from "@/lib/types";

export const dynamic = "force-dynamic";

// 진행 스텝퍼 정의 — canonical state → 10단계 (dropped/churned 는 종료라 미표시)
const STEP_DEFS: { label: string; states: State[] }[] = [
  { label: "리드", states: ["lead_new"] },
  { label: "세미나", states: ["seminar"] },
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
  const { brand, signals, docs, paymentsManual, glovekSubs, timeline, adminUsers } = data;

  // 현재 단계 필수항목. field형은 브랜드 값으로 done 판정. (0002 미적용 DB 방어)
  const rawReqs = await stageChecklist(brand.id, brand.state).catch(() => []);
  const deep = await cardDeep(brand.id).catch(() => null);
  const emails = await listBrandEmails(brand.id).catch(() => []);

  // v3.1 추가 조회 — 존재 테이블만, 각 조회 개별 방어.
  const safe = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
  const [aliases, comments, presence, drafts, meetings, moveHistory] = await Promise.all([
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
    safe(query<HistoryRow>(
      "SELECT from_state, to_state, actor, at FROM stage_history WHERE brand_id=$1 AND gate_passed ORDER BY at DESC LIMIT 10",
      [brand.id])),
  ]);

  // 다음 스텝 게이트(현재) + 그다음 게이트(예고 — v3.1 gateNext)
  const gateCtx = await buildGateContext(brand).catch(() => null);
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

  const sourceLabel = SOURCE_LABELS[brand.source] ?? brand.source;
  const nextDday = dday(brand.due_date);
  const latestSurvey = deep?.surveys[0] ?? null;

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

        <Brand360SurveyCard brandId={brand.id} survey={latestSurvey} />

        <Brand360Contacts brandId={brand.id} contacts={deep?.contacts ?? []} />
      </div>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <Brand360GateCard brandId={brand.id} gate={gate} gateNext={gateNext} stageReqs={stageReqs} />

        <div className="card">
          <div className="hd"><b>등급 5대 지표</b>{brand.grade && <GradeBadge grade={brand.grade} />}</div>
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

        <Brand360AiButton brandId={brand.id} />
      </div>
    </div>
  );

  // 회사정보 — v3.1 심층 분석 + 사업자/세금계산서/정산 계좌/브랜드 정보
  const panelCompany = (
    <Brand360Company brand={brand} company={deep?.company ?? null} assets={deep?.assets ?? []} />
  );

  // 타임라인
  const panelTimeline = (
    <section className="card">
      <div className="bd">
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
                  <span style={{ fontSize: 12.5 }}>{t.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  // 미팅·메일 — 미팅(회의록·다음 액션 반영) + 팔로업 초안(승인·발송) + 연동 메일(기존 기능 유지)
  const panelMail = (
    <div style={{ display: "grid", gap: 14 }}>
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

  const tabs: Brand360Tab[] = [
    { key: "ov", label: "개요", node: panelOverview },
    { key: "co", label: "회사정보", node: panelCompany },
    { key: "tl", label: "타임라인", node: panelTimeline },
    { key: "mm", label: "미팅·메일", node: panelMail },
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
              <GradeBadge grade={brand.grade} />
              <StateBadge state={brand.state} />
              {brand.rec_track && <span className="chip">{brand.rec_track === "onboarding" ? "온보딩 추천" : "라이브 추천"}</span>}
              {aliases.length > 0 && <span className="chip amb" title={aliases.map((a) => a.alias).join(", ")}>별칭 {aliases.length}</span>}
            </div>
            <div style={{ color: "var(--ink3)", fontSize: 12, marginTop: 2 }}>{metaBits.join(" · ")}</div>
          </div>
          <Brand360Header brand={brand} adminUsers={adminUsers} ddayLabel={nextDday} />
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
    </div>
  );
}
