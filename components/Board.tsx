"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { transitionAction } from "@/app/actions";
import { STATES, STATE_LABELS, SOURCE_LABELS, PLAN_LABELS, GRADES, type State } from "@/lib/types";
import type { BoardCard } from "@/lib/repo/queries";
import { businessDaysBetween } from "@/lib/time";
import BoardCardLayer, { TRACK_LABELS, TRACK_COLORS } from "@/components/BoardCardLayer";
import ImportanceStars from "@/components/ImportanceStars";
import KanbanScroll from "@/components/KanbanScroll";

// v3.1 s-kanban → 기획 8절: 8컬럼 (계약완료→계약 검토에 합류, 정산중→운영 중에 통합 표시).
// 상태 자체는 canonical enum 유지 — 표시만 병합.
type ColDef = { key: string; label: string; part: string; dot: string; states: State[]; drop: State };

const COLS: ColDef[] = [
  { key: "hold", label: "보류", part: "hold", dot: "#f59e0b", states: ["hold"], drop: "hold" },
  { key: "lead_new", label: "리드 확보", part: "mkt", dot: "var(--mkt)", states: ["lead_new"], drop: "lead_new" },
  { key: "seminar", label: "담당자배정", part: "mkt", dot: "var(--mkt)", states: ["seminar"], drop: "seminar" },
  { key: "meeting", label: "1:1 미팅", part: "sales", dot: "var(--sales)", states: ["meeting"], drop: "meeting" },
  { key: "contact", label: "개별 컨택", part: "sales", dot: "var(--sales)", states: ["contact"], drop: "contact" },
  { key: "contract", label: "계약 검토", part: "sales", dot: "var(--sales)", states: ["contract_review"], drop: "contract_review" },
  { key: "contract_done", label: "계약 완료", part: "sales", dot: "var(--sales)", states: ["contract_done"], drop: "contract_done" },
  // 서류수급·입점셋업 단계 폐지(0085) — 계약완료 다음은 운영 중으로 직행.
  // 레거시 docs/setup 상태(마이그레이션 미적용 DB)도 여기 병합 표시.
  { key: "live", label: "운영 중", part: "ops", dot: "var(--ops)", states: ["docs", "setup", "live_mall", "live_onboarding", "settling"], drop: "live_mall" },
];

const PARTS: { value: string; label: string }[] = [
  { value: "", label: "전체 파트" },
  { value: "mkt", label: "마케팅" },
  { value: "sales", label: "영업" },
  { value: "ops", label: "운영" },
];

// 계약완료 이후 상태부터 트랙 배지 노출
const CONTRACT_DONE_IDX = STATES.indexOf("contract_done");
const showTrack = (s: State) => STATES.indexOf(s) >= CONTRACT_DONE_IDX && s !== "dropped" && s !== "churned" && s !== "hold";

// 경과일은 영업일(주말 제외) 기준 — SLA 정책과 동일 기준으로 표시.
function ageOf(iso: string): { hours: number; days: number; label: string } {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const hours = Math.floor(ms / 3600000);
  const days = businessDaysBetween(new Date(iso), new Date());
  return { hours, days, label: hours < 24 ? `${Math.max(1, hours)}h` : `${days}영업일` };
}
function initials(name: string): string {
  return name.replace(/@.*/, "").slice(0, 2);
}

export default function Board({
  cards: propCards,
  sla,
  me,
  canForce = false,
  owners = [],
}: {
  cards: BoardCard[];
  sla: Record<string, number>;
  me: string | null;
  canForce?: boolean;
  owners?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [cards, setCards] = useState(propCards);
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // 기획 8절: 카드 클릭 → 요약 레이어 (브랜드360은 레이어에서 이동)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 필터 (v3.1 bar) — 파트 / 담당 / 등급
  const [part, setPart] = useState("");
  const [ownerF, setOwnerF] = useState<"mine" | "all">("all");
  const [ownerId, setOwnerId] = useState(""); // 특정 담당자 필터
  const [gradeF, setGradeF] = useState("");
  // 보류 컬럼 리스트 접기(많이 쌓일 수 있어 기본 접힘) — localStorage 유지.
  const [holdCollapsed, setHoldCollapsed] = useState(true);

  // 서버 새로고침으로 새 데이터가 오면 로컬 상태 동기화
  useEffect(() => setCards(propCards), [propCards]);
  useEffect(() => { try { const v = localStorage.getItem("sales-hold-collapsed"); if (v != null) setHoldCollapsed(v === "1"); } catch { /* noop */ } }, []);
  const toggleHold = () => setHoldCollapsed((c) => { const n = !c; try { localStorage.setItem("sales-hold-collapsed", n ? "1" : "0"); } catch { /* noop */ } return n; });

  const isMine = (c: BoardCard) =>
    !!me && [c.owner_intake, c.owner_sales, c.owner_onboard, c.owner_ads].includes(me);

  const hasOwner = (c: BoardCard, id: string) =>
    [c.owner_intake, c.owner_sales, c.owner_onboard, c.owner_ads].includes(id);
  const visible = cards.filter(
    (c) => (gradeF === "" || c.grade === gradeF)
      && (ownerF !== "mine" || isMine(c))
      && (ownerId === "" || hasOwner(c, ownerId)),
  );
  // 보류 컬럼은 파트 필터와 무관하게 항상 맨 앞에 노출(어느 파트에서든 넣을 수 있어야 함).
  const shownCols = COLS.filter((col) => col.key === "hold" || part === "" || col.part === part);
  const inCol = (col: ColDef) => visible.filter((c) => col.states.includes(c.state));
  const selected = selectedId ? (cards.find((c) => c.id === selectedId) ?? null) : null;

  async function onDrop(col: ColDef) {
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || col.states.includes(card.state)) return;
    // 병합 컬럼의 실제 목적 상태 결정 (운영 중 → 계약 유형에 따라)
    const to: State =
      col.key === "live" ? (card.contract_type === "onboarding" ? "live_onboarding" : "live_mall") : col.drop;

    // 보류 이동은 메모(사유) 필수 — 나중에 왜 보류했는지 추적할 수 있게 타임라인에 기록된다.
    let holdReason: string | undefined;
    if (col.key === "hold") {
      const r = window.prompt(`'${card.brand_name}' 보류 사유를 입력하세요 (필수)\n예: 추후 재컨택 / 완전 보류 / 예산 확정 대기`, "");
      if (!r || !r.trim()) return; // 미입력·취소 → 이동하지 않음
      holdReason = r.trim();
    }

    // 낙관적 업데이트 — 카드를 즉시 이동
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, state: to } : c)));

    let res = await transitionAction(id, to, holdReason);
    // 뒤로 되돌리기(후퇴 전이) 등 사유가 필요한 경우 — 사유를 입력받아 재시도.
    if (!res.ok && res.needReason) {
      const reason = window.prompt(`'${STATE_LABELS[card.state]}' → '${STATE_LABELS[to]}' 단계 변경 사유를 입력하세요:`, "");
      if (reason && reason.trim()) {
        res = await transitionAction(id, to, reason.trim());
      } else {
        setCards(prev); // 취소 → 원위치
        return;
      }
    }
    // 파트장·대표: 게이트 미충족으로 막혀도 사유 입력 → 한 번에 강제 이동.
    if (!res.ok && !res.needReason && canForce) {
      const detail = res.failed?.map((f) => f.label).join(" · ") || res.error || "이동 조건 미충족";
      const reason = window.prompt(
        `이동 조건 미충족: ${detail}\n\n'${STATE_LABELS[card.state]}' → '${STATE_LABELS[to]}' 강제 이동 사유를 입력하세요(파트장/대표):`,
        "",
      );
      if (reason && reason.trim()) {
        res = await transitionAction(id, to, reason.trim(), true);
      } else {
        setCards(prev); // 취소 → 원위치
        return;
      }
    }
    if (res.ok) {
      setToast({ msg: `${card.brand_name} → ${STATE_LABELS[to]}`, bad: false });
      router.refresh();
    } else {
      setCards(prev); // 실패 시 원위치
      const detail = res.failed?.map((f) => f.label).join(" · ") || res.error || "이동 실패";
      setToast({ msg: `이동 불가: ${detail}`, bad: true });
    }
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div>
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg ${
            toast.bad ? "bg-bad text-white" : "bg-good text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* v3.1 .ph 헤더 + 필터 바 */}
      <div className="ph">
        <div>
          <h1>영업 파이프라인</h1>
          <p>카드를 옮기면 게이트가 검증됩니다 — 조건 미충족이면 이동이 거부되고 부족 항목이 표시돼요.</p>
        </div>
        <div className="bar" style={{ margin: 0 }}>
          <select value={part} onChange={(e) => setPart(e.target.value)}>
            {PARTS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <select value={ownerF} onChange={(e) => setOwnerF(e.target.value as "mine" | "all")}>
            <option value="mine">내 담당만</option>
            <option value="all">전체</option>
          </select>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} title="담당자별 보기">
            <option value="">담당자 전체</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={gradeF} onChange={(e) => setGradeF(e.target.value)}>
            <option value="">등급 전체</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      {cards.length === 0 && (
        <div className="card p-6 text-center text-muted mb-4" style={{ padding: 24 }}>
          아직 브랜드가 없습니다.{" "}
          <Link href="/import" className="font-semibold underline">데이터 가져오기</Link>에서 직접 추가하거나
          CSV로 불러오세요. 사이트 연동이 붙으면 자동으로 쌓입니다.
        </div>
      )}

      <KanbanScroll>
      <div className="kb">
        {shownCols.map((col) => {
          const list = inCol(col);
          const slaDays = sla[col.drop];
          const over = dragId && !col.states.includes(cards.find((c) => c.id === dragId)?.state as State);
          return (
            <div
              key={col.key}
              className={`kcol ${over ? "dragover" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(col)}
            >
              <h4>
                <span className="dot" style={{ background: col.dot }} />
                {col.label}
                <span className="c">
                  {list.length}
                  {slaDays != null && ` · SLA ${slaDays}일`}
                </span>
                {col.key === "hold" && (
                  <button onClick={toggleHold} title={holdCollapsed ? "보류 목록 펼치기" : "보류 목록 접기"}
                    style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "var(--acc)", fontWeight: 700 }}>
                    {holdCollapsed ? "펼치기 ▸" : "접기 ▾"}
                  </button>
                )}
              </h4>
              <div className="min-h-[60px]">
                {col.key === "hold" && holdCollapsed && list.length > 0 ? (
                  <div style={{ padding: "12px 8px", textAlign: "center", color: "var(--ink3)", fontSize: 12 }}>
                    {list.length}건 보류 중 · <button onClick={toggleHold} style={{ border: "none", background: "none", color: "var(--acc)", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>목록 보기</button>
                  </div>
                ) : list.map((c) => {
                  const owner = c.owners_display?.split(",")[0]?.trim() ?? "";
                  const age = ageOf(c.stage_entered_at);
                  const p = sla[c.state];
                  const mt =
                    c.next_action ||
                    [SOURCE_LABELS[c.source] ?? c.source, c.category].filter(Boolean).join(" · ");
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDragId(c.id)}
                      onClick={() => setSelectedId(c.id)}
                      className="kcard"
                      style={c.has_breach ? { borderColor: "#fca5a5", background: "#fff5f5" } : undefined}
                      title={c.has_breach ? "SLA 초과 · 정체 카드" : undefined}
                    >
                      <div className="nm" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {c.grade && <span className={`gr ${c.grade}`}>{c.grade}</span>}
                        <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{c.brand_name}</span>
                        <ImportanceStars brandId={c.id} value={c.importance ?? 0} size={13} />
                      </div>
                      {mt && <div className="mt truncate">{mt}</div>}
                      {/* 기획 확정: 카드에 플랜·금액 + 기한 + 트랙(계약완료 이후) + 정산중 표시 */}
                      {(c.plan || c.due_date || (showTrack(c.state) && c.contract_type) || c.state === "settling") && (
                        <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                          {showTrack(c.state) && c.contract_type && (
                            <span
                              className="pill"
                              style={{
                                background: TRACK_COLORS[c.contract_type]?.bg ?? "#e2e8f0",
                                color: TRACK_COLORS[c.contract_type]?.fg ?? "#334155",
                                fontSize: 10,
                                fontWeight: 700,
                              }}
                            >
                              {TRACK_LABELS[c.contract_type] ?? c.contract_type}
                            </span>
                          )}
                          {c.state === "settling" && (
                            <span className="pill" style={{ background: "#fef9c3", color: "#854d0e", fontSize: 10, fontWeight: 700 }}>정산중</span>
                          )}
                          {c.plan && <span className="pill" style={{ background: "#eef2ff", color: "#3730a3", fontSize: 10 }}>{PLAN_LABELS[c.plan] ?? c.plan}</span>}
                          {c.due_date && <span className="pill" style={{ background: "#fef3c7", color: "#92400e", fontSize: 10 }}>기한 {String(c.due_date).slice(5, 10)}</span>}
                        </div>
                      )}
                      <div className="ft">
                        {owner ? (
                          <span className="av" title={owner}>{initials(owner)}</span>
                        ) : (
                          <>
                            <span className="av" style={{ background: "#94a3b8" }}>미</span>
                            <span style={{ fontSize: 10, color: "var(--danger)", fontWeight: 700 }}>담당 미배정</span>
                          </>
                        )}
                        {c.has_breach ? (
                          <span className="sla t2">{p != null && age.days > p ? `정체 +${age.days - p}일` : "SLA 초과"}</span>
                        ) : p != null ? (
                          <span className={`sla ${age.days >= p - 1 ? "t1" : "ok"}`}>D{age.days}</span>
                        ) : null}
                        <span className="dy">{age.label}</span>
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && (
                  <div style={{ padding: "16px 8px", textAlign: "center", color: "var(--ink3)", fontSize: 11.5, lineHeight: 1.5 }}>
                    {over ? "여기로 이동" : "이 단계에 카드가 없습니다"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </KanbanScroll>

      {selected && <BoardCardLayer card={selected} onClose={() => setSelectedId(null)} />}

      <div className="note" style={{ marginTop: 8 }}>
        💡 카드 드래그 시 서버 게이트 검증 → 미충족이면 <b style={{ color: "var(--danger)" }}>이동 거부 + 부족 항목 표시</b>{" "}
        (예: &quot;진단 등급이 없습니다 · 영업 담당이 지정되지 않았습니다&quot;)
      </div>
    </div>
  );
}
