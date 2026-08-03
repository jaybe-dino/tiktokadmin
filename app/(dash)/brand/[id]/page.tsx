import Link from "next/link";
import { notFound } from "next/navigation";
import Brand360Actions from "@/components/Brand360Actions";
import Brand360AiButton from "@/components/Brand360AiButton";
import Brand360Tabs, { type Brand360Tab } from "@/components/Brand360Tabs";
import CustomerDetail from "@/components/CustomerDetail";
import CustomerEmails from "@/components/CustomerEmails";
import CardTabs from "@/components/CardTabs";
import ComposeEmailButton from "@/components/ComposeEmailButton";
import { cardDeep } from "@/lib/repo/card";
import { listBrandEmails } from "@/lib/email-link";
import { GradeBadge, PayBadge, PlanBadge, StateBadge, TierBadge } from "@/components/badges";
import { brand360 } from "@/lib/repo/queries";
import { stageChecklist } from "@/lib/requirements";
import { humanElapsed } from "@/lib/time";
import { nextStepGuide } from "@/lib/meetings";
import { buildGateContext } from "@/lib/gates";
import { SOURCE_LABELS, STATE_LABELS, type State } from "@/lib/types";

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
  const { brand, signals, docs, paymentsManual, glovekSubs, timeline, alerts, adminUsers, files, proposals, sites } = data;

  const SITE_LABEL: Record<string, string> = { glovek: "glovek", apply: "apply", tpartners: "tpartners", manual: "직접입력" };

  // 현재 단계 필수항목. field형은 브랜드 값으로 done 판정. (0002 미적용 DB 방어)
  const rawReqs = await stageChecklist(brand.id, brand.state).catch(() => []);
  const emails = await listBrandEmails(brand.id).catch(() => []);
  const deep = await cardDeep(brand.id).catch(() => null);

  // 다음 스텝 게이트 체크리스트 — 현재 state 의 다음 전이 게이트 항목 (충족/미충족)
  const gateCtx = await buildGateContext(brand).catch(() => null);
  const gate = gateCtx ? await nextStepGuide(brand, gateCtx).catch(() => null) : null;
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

  // 담당자 이름 매핑
  const userName = (uid: string | null): string | null => (uid ? adminUsers.find((u) => u.id === uid)?.name ?? "지정됨" : null);
  const salesName = userName(brand.owner_sales);
  const onboardName = userName(brand.owner_onboard);
  const sourceLabel = SOURCE_LABELS[brand.source] ?? brand.source;
  const nextDday = dday(brand.due_date);

  // 개요 kv 메타
  const metaBits = [
    brand.category || "카테고리 미상",
    brand.brand_url || null,
    brand.biz_no ? `사업자 ${brand.biz_no}` : null,
    `${sourceLabel} 유입`,
    `현 단계 ${humanElapsed(brand.stage_entered_at)} 경과`,
  ].filter(Boolean) as string[];

  // ── 탭 패널(프로토타입 s-b360 탭 구성) ──────────────────────────
  // 개요 — g31: 좌측 AI브리프·시그널·개요, 우측 게이트·액션
  const panelOverview = (
    <div className="grid g31" style={{ gap: 14 }}>
      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <div className="aiw">
          <h5>🤖 AI 사전분석 브리프</h5>
          {brand.brief_md ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.7, fontFamily: "inherit", color: "var(--ink)" }}>{brand.brief_md}</pre>
          ) : (
            <p className="note" style={{ marginTop: 4 }}>브리프 미생성 (사전분석 에이전트 대기 중)</p>
          )}
        </div>

        <section className="card">
          <div className="card-hd"><b>개요</b></div>
          <div className="card-bd">
            <div className="kv">
              <dt>담당</dt>
              <dd>{salesName ? `영업 ${salesName}` : "영업 미지정"}{onboardName ? ` · 온보딩 ${onboardName}` : ""}</dd>
              <dt>카테고리</dt>
              <dd>{brand.category || "—"}</dd>
              <dt>목표국</dt>
              <dd>{brand.countries.length ? brand.countries.join(", ") : "미정"}</dd>
              <dt>인증국</dt>
              <dd>{brand.certified_countries.length ? brand.certified_countries.join(", ") : "—"}</dd>
              <dt>유입 소스</dt>
              <dd>{sourceLabel}</dd>
              <dt>연락처</dt>
              <dd>{[brand.email, brand.phone].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>다음 액션</dt>
              <dd>{brand.next_action || "—"}{nextDday ? ` (${nextDday})` : ""}</dd>
              <dt>마지막 접촉</dt>
              <dd>{brand.last_contact_at ? brand.last_contact_at.slice(0, 10) : "기록 없음"}</dd>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-hd"><b>사전분석 시그널</b><span className="gr" style={{ marginLeft: 6, background: "#94a3b8" }}>{signals.length}</span></div>
          <div className="card-bd">
            {signals.length === 0 ? (
              <p className="note">수집된 시그널이 없습니다.</p>
            ) : (
              <table className="t">
                <thead>
                  <tr><th>출처</th><th>지표</th><th>값</th><th>신뢰도</th></tr>
                </thead>
                <tbody>
                  {signals.map((s, i) => (
                    <tr key={i}>
                      <td>{s.source}</td>
                      <td>{s.metric}</td>
                      <td>{s.value_num ?? s.value_text ?? "—"}</td>
                      <td>{s.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <Brand360AiButton brandId={brand.id} />

        {gate && (
          <div className="gate">
            <h5>▶ 다음 스텝 게이트: {STATE_LABELS[gate.from]} → {STATE_LABELS[gate.to]}</h5>
            {gate.items.length === 0 ? (
              <div className="gi"><span className="ok">✅</span> 게이트 조건 없음 — 바로 이동 가능</div>
            ) : (
              gate.items.map((it, i) => (
                <div key={i} className="gi">
                  <span className={it.done ? "ok" : "no"}>{it.done ? "✅" : "⬜"}</span> {it.label}
                </div>
              ))
            )}
          </div>
        )}

        <Brand360Actions
          brand={brand}
          adminUsers={adminUsers}
          docItems={docs.items.map((i) => ({ item_key: i.item_key, label: i.label, done: i.done, source: i.source }))}
          stageReqs={stageReqs}
        />
      </div>
    </div>
  );

  // 회사정보 — 고객 상세(국가·자료·제안) + 심화 카드(연락처·설문·회사·제품·계약 등)
  const panelCompany = (
    <div style={{ display: "grid", gap: 14 }}>
      <CustomerDetail brand={brand} files={files} proposals={proposals} />
      {deep ? (
        <CardTabs brandId={brand.id} deep={deep} />
      ) : (
        <div className="card"><div className="card-bd"><p className="note">심화 카드 데이터를 불러올 수 없습니다.</p></div></div>
      )}
    </div>
  );

  // 타임라인
  const panelTimeline = (
    <section className="card">
      <div className="card-hd"><b>타임라인</b></div>
      <div className="card-bd">
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

  // 미팅·메일 — 관련 메일 연동 + AI 메일 초안
  const panelMail = (
    <div style={{ display: "grid", gap: 14 }}>
      <CustomerEmails brandId={brand.id} emails={emails} />
      <ComposeEmailButton brandId={brand.id} />
    </div>
  );

  // 서류·물류 — 서류 체크리스트(실데이터)
  const panelDocs = (
    <section className="card">
      <div className="card-hd">
        <b>서류 체크리스트</b>
        <span className="chip" style={{ marginLeft: 6 }}>{docs.done}/{docs.total}</span>
      </div>
      <div className="card-bd">
        {docs.items.length === 0 ? (
          <p className="note">이 브랜드는 아직 서류 체크리스트가 없습니다. 계약 완료로 이동하면 계약형태·국가에 맞는 서류 템플릿이 자동 생성됩니다.</p>
        ) : (
          <table className="t">
            <thead>
              <tr><th>항목</th><th>상태</th><th>출처</th></tr>
            </thead>
            <tbody>
              {docs.items.map((it) => (
                <tr key={it.item_key}>
                  <td>{it.label}</td>
                  <td><span className={`cellchip ${it.done ? "cc-ok" : "cc-no"}`}>{it.done ? "완료" : "대기"}</span></td>
                  <td>{it.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="note" style={{ marginTop: 10 }}>물류 계약은 [회사정보] 탭의 심화 카드 · 물류에서 관리합니다 — 계약 없으면 셋업 이동 불가.</div>
      </div>
    </section>
  );

  // 제품·인증·재고 — 심화 카드로 안내(편집 단일 원천)
  const panelProducts = (
    <section className="card">
      <div className="card-hd"><b>제품·인증·재고</b></div>
      <div className="card-bd">
        {deep && deep.products.length > 0 ? (
          <table className="t">
            <thead>
              <tr><th>제품</th><th>등록 인증</th></tr>
            </thead>
            <tbody>
              {deep.products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name_kr}</td>
                  <td>{deep.certs.filter((c) => c.product_id === p.id).length}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="note">등록된 제품이 없습니다.</p>
        )}
        <div className="note" style={{ marginTop: 10 }}>제품 마스터·국가×인증 매트릭스·초기 재고는 [회사정보] 탭의 심화 카드(제품·인증 / 재고)에서 관리합니다.</div>
      </div>
    </section>
  );

  // 계약·결제 — glovek 구독 + 수기 결제(실데이터)
  const panelContract = (
    <div className="grid g2" style={{ gap: 14 }}>
      <section className="card">
        <div className="card-hd"><b>결제</b></div>
        <div className="card-bd">
          {glovekSubs.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, marginBottom: 4 }}>glovek 정기(구독)</div>
              {glovekSubs.map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                  <span>{s.plan} · <span className="chip grn">{s.status}</span></span>
                  <span>{s.amount ? `₩${s.amount.toLocaleString()}` : ""} {s.next_charge_at ? `· ${s.next_charge_at.slice(0, 10)}` : ""}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, marginBottom: 4 }}>수기 결제</div>
          {paymentsManual.length === 0 ? (
            <p className="note">기록된 수기 결제가 없습니다.</p>
          ) : (
            paymentsManual.map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                <span>{p.plan} · {p.method}</span>
                <span>₩{p.amount.toLocaleString()} · {p.paid_at}</span>
              </div>
            ))
          )}
          <div className="note" style={{ marginTop: 10 }}>카드결제(온보딩·개런티·구독)는 glovek 수납 → 웹훅 자동 확인 · 계약서·이체는 수기 확인.</div>
        </div>
      </section>
      <section className="card">
        <div className="card-hd"><b>계약</b></div>
        <div className="card-bd">
          {deep && deep.contracts.length > 0 ? (
            <table className="t">
              <thead>
                <tr><th>종류</th><th>상태</th><th>만료</th></tr>
              </thead>
              <tbody>
                {deep.contracts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.kind} v{c.version}</td>
                    <td><span className="cellchip cc-ing">{c.status}</span></td>
                    <td>{c.end_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="note">등록된 계약이 없습니다. 조건 빌더·계약 등록은 [회사정보] 탭의 심화 카드 · 계약에서 진행합니다.</p>
          )}
        </div>
      </section>
    </div>
  );

  // 운영·정산
  const panelOps = (
    <section className="card">
      <div className="card-bd">
        <p className="note">운영·정산 데이터는 <b>운영 중</b> 단계부터 활성화됩니다 — 사이클·시딩·라이브·CS·정산 런이 이 탭에 나타납니다.</p>
      </div>
    </section>
  );

  // 메모·협업
  const panelNotes = (
    <section className="card">
      <div className="card-bd">
        <p className="note">코멘트·멘션·감사 이력은 협업 모듈 연동 시 이 탭에 표시됩니다.</p>
      </div>
    </section>
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

      {/* ===== 헤더 카드 (b360) ===== */}
      <div className="card" style={{ marginTop: 8, marginBottom: 14 }}>
        <div className="card-bd" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "14px 16px" }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg,#a78bfa,#7c3aed)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800,
            }}
          >
            {initials(brand.brand_name)}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 18, fontWeight: 800 }}>{brand.brand_name}</h1>
              <GradeBadge grade={brand.grade} />
              <StateBadge state={brand.state} />
              <PlanBadge plan={brand.plan} />
              <PayBadge status={brand.pay_status} />
              <span className="chip">{sourceLabel}</span>
              {brand.churn_risk === "high" && <span className="chip red">이탈위험 high</span>}
            </div>
            <div style={{ color: "var(--ink3)", fontSize: 12, marginTop: 3 }}>{metaBits.join(" · ")}</div>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
            <div>
              <div style={{ color: "var(--ink3)", fontSize: 10.5, fontWeight: 700 }}>영업 담당</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                {salesName ? (
                  <>
                    <span className="av" style={{ width: 20, height: 20, fontSize: 9 }}>{initials(salesName)}</span> {salesName}
                  </>
                ) : (
                  <span style={{ color: "var(--ink3)" }}>미지정</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--ink3)", fontSize: 10.5, fontWeight: 700 }}>온보딩</div>
              <div style={{ marginTop: 2, color: onboardName ? undefined : "var(--ink3)" }}>{onboardName ?? "미지정"}</div>
            </div>
            <div>
              <div style={{ color: "var(--ink3)", fontSize: 10.5, fontWeight: 700 }}>다음 액션</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>
                {brand.next_action || "—"}
                {nextDday && <span style={{ color: "var(--warn)", marginLeft: 4 }}>({nextDday})</span>}
              </div>
            </div>
          </div>
        </div>

        {/* 진행 스텝퍼 */}
        <div className="card-bd" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
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

      {/* 유입 소스 사이트 */}
      {sites.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-bd" style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700 }}>유입 소스</span>
            {sites.map((s) => (
              <span key={s} className="chip">{SITE_LABEL[s] ?? s}</span>
            ))}
            <span style={{ fontSize: 11, color: "var(--ink3)" }}>— 이 사이트들의 데이터가 하나의 카드로 매칭됨</span>
          </div>
        </div>
      )}

      {/* 미해결 알림 */}
      {alerts.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: "#fecaca" }}>
          <div className="card-bd" style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {alerts.map((a) => (
              <span key={a.id} className="chip red" style={{ gap: 5 }}>
                <TierBadge tier={a.tier} /> {a.kind} · {a.message}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ===== 상단 탭 (프로토타입 s-b360 구성) ===== */}
      <Brand360Tabs tabs={tabs} />
    </div>
  );
}
