"use client";
import { useState } from "react";
import Link from "next/link";

// 마케팅 프로젝트 화면 — 프로토타입 s-mkt 3탭 구성(파이프라인 / 루틴 운영대행 / 브랜드사별 매핑).
// 데이터는 서버(allMktProjects)에서 내려온 실데이터만 사용한다.
export interface MktRow {
  id: string;
  title: string;
  kind: string; // 'project' | 'routine'
  proposal_status: string; // draft|sent|negotiating|won|dropped
  note: string | null;
  brand_name: string;
  brand_id: string;
}

// proposal_status → 라벨 · .cellchip 색상
const ST: Record<string, { ko: string; cc: string }> = {
  draft: { ko: "작성 중", cc: "cc-ing" },
  sent: { ko: "발송", cc: "cc-warn" },
  negotiating: { ko: "협의 중", cc: "cc-warn" },
  won: { ko: "수주", cc: "cc-ok" },
  dropped: { ko: "드랍", cc: "cc-no" },
};

// 파이프라인 열 (project 트랙)
const PIPE: { key: string; label: string; dot: string }[] = [
  { key: "draft", label: "제안 작성 중", dot: "var(--sales)" },
  { key: "sent", label: "발송·협의", dot: "var(--warn)" },
  { key: "negotiating", label: "협의 중", dot: "var(--warn)" },
  { key: "won", label: "수주·계약", dot: "var(--ok)" },
  { key: "dropped", label: "완료·드랍", dot: "#64748b" },
];

type Tab = "pipe" | "routine" | "map";

export default function MktScreen({ rows }: { rows: MktRow[] }) {
  const [tab, setTab] = useState<Tab>("pipe");
  const projects = rows.filter((r) => r.kind !== "routine");
  const routines = rows.filter((r) => r.kind === "routine");

  return (
    <div>
      <div className="tabs">
        <button className={tab === "pipe" ? "on" : ""} onClick={() => setTab("pipe")}>
          개별 프로젝트 — 파이프라인 보드
        </button>
        <button className={tab === "routine" ? "on" : ""} onClick={() => setTab("routine")}>
          루틴 운영대행 (시딩·라이브)
        </button>
        <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>
          브랜드사별 매핑
        </button>
      </div>

      {tab === "pipe" && <Pipeline projects={projects} />}
      {tab === "routine" && <Routine routines={routines} />}
      {tab === "map" && <BrandMap rows={rows} />}
    </div>
  );
}

// ── 탭 1: 파이프라인 보드 ─────────────────────────────────────
function Pipeline({ projects }: { projects: MktRow[] }) {
  const count = (k: string) => projects.filter((r) => r.proposal_status === k).length;
  return (
    <div>
      <div className="bar">
        {PIPE.map((c) => (
          <span key={c.key} className={`chip ${c.key === "won" ? "grn" : c.key === "dropped" ? "" : c.key === "draft" ? "" : "amb"}`}>
            {c.label} {count(c.key)}
          </span>
        ))}
        <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: "11.5px" }}>
          수주→진행은 계약 등록이 필요합니다 — 카드 이동도 게이트 검증
        </span>
      </div>
      {projects.length === 0 ? (
        <div className="note">진행 중인 개별 프로젝트가 없습니다. RFP 접수·인바운드 문의가 등록되면 여기에 카드로 표시됩니다.</div>
      ) : (
        <div className="kb">
          {PIPE.map((col) => {
            const list = projects.filter((r) => r.proposal_status === col.key);
            return (
              <div key={col.key} className="kcol">
                <h4>
                  <span className="dot" style={{ background: col.dot }} />
                  {col.label} <span className="c">{list.length}</span>
                </h4>
                {list.map((m) => (
                  <div key={m.id} className="kcard">
                    <div className="nm">{m.title}</div>
                    <div className="mt">
                      <Link href={`/brand/${m.brand_id}`} className="hover:underline">
                        {m.brand_name}
                      </Link>
                      {m.note ? ` · ${m.note}` : ""}
                    </div>
                    <div className="ft">
                      <span className={`cellchip ${ST[m.proposal_status]?.cc ?? "cc-no"}`}>
                        {ST[m.proposal_status]?.ko ?? m.proposal_status}
                      </span>
                    </div>
                  </div>
                ))}
                {list.length === 0 && <div className="mt" style={{ padding: "2px 4px" }}>—</div>}
              </div>
            );
          })}
        </div>
      )}
      <div className="note" style={{ marginTop: 8 }}>
        💡 완료된 프로젝트의 성과(GMV·콘텐츠)는 다음 제안의 근거 자료로 자동 축적 · 드랍 사유는 주간 자가학습에 반영
      </div>
    </div>
  );
}

// ── 탭 2: 루틴 운영대행 ───────────────────────────────────────
function Routine({ routines }: { routines: MktRow[] }) {
  // 브랜드별로 루틴 프로젝트를 묶는다.
  const byBrand = new Map<string, MktRow[]>();
  for (const r of routines) {
    const arr = byBrand.get(r.brand_id) ?? [];
    arr.push(r);
    byBrand.set(r.brand_id, arr);
  }
  const groups = [...byBrand.values()];
  return (
    <div>
      <div className="bar">
        <span className="chip grn">운영대행 계약 {groups.length}건</span>
        <span className="chip">루틴 캠페인 {routines.length}개</span>
        <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: "11.5px" }}>
          회차가 끝나면 리포트 → 승인 → 다음 회차 자동 개설 (지속관리)
        </span>
      </div>
      {groups.length === 0 ? (
        <div className="note">루틴 운영대행(월 회차 반복) 프로젝트가 없습니다. 계약이 등록되면 브랜드별 회차 카드가 여기에 표시됩니다.</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {groups.map((g) => (
            <div key={g[0].brand_id} className="card">
              <div className="hd">
                <b>
                  <Link href={`/brand/${g[0].brand_id}`} className="hover:underline">
                    {g[0].brand_name}
                  </Link>{" "}
                  — 마케팅 운영대행
                </b>
                <span className="chip grn">루틴 {g.length}건</span>
              </div>
              <table className="t">
                <tbody>
                  <tr>
                    <th>캠페인</th>
                    <th>메모</th>
                    <th>상태</th>
                  </tr>
                  {g.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.title}</b>
                      </td>
                      <td>{r.note || "—"}</td>
                      <td>
                        <span className={`cellchip ${ST[r.proposal_status]?.cc ?? "cc-no"}`}>
                          {ST[r.proposal_status]?.ko ?? r.proposal_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="hd">
            <b>회차 사이클 규칙 (지속관리)</b>
          </div>
          <div className="bd" style={{ fontSize: "12.5px", lineHeight: 1.8 }}>
            ① 회차(월) 시작 시 계약 범위대로 캠페인 자동 개설(시딩·라이브·소재)
            <br />② 정해진 기간 내 마무리 — 마감 D-3부터 지연 알림
            <br />③ 회차 종료 → <b>AI 결과 리포트 초안</b> → 담당 승인 → 브랜드 발송·포털 게시
            <br />④ <b>다음 회차 자동 개설</b> + 전 회차 학습(잘된 크리에이터·시간대 반영)
          </div>
        </div>
        <div className="card">
          <div className="hd">
            <b>루틴 운영 요약</b>
          </div>
          <div className="bd" style={{ fontSize: "12px" }}>
            <div className="row">
              <span className="ico i-grn">🔁</span>
              <div>
                <div className="tt">운영대행 브랜드 {groups.length}곳</div>
                <div className="ss">루틴 캠페인 총 {routines.length}건 지속관리 중</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 탭 3: 브랜드사별 매핑 ─────────────────────────────────────
function BrandMap({ rows }: { rows: MktRow[] }) {
  const byBrand = new Map<string, MktRow[]>();
  for (const r of rows) {
    const arr = byBrand.get(r.brand_id) ?? [];
    arr.push(r);
    byBrand.set(r.brand_id, arr);
  }
  const brands = [...byBrand.entries()].map(([id, list]) => ({
    id,
    name: list[0].brand_name,
    list,
  }));
  const [sel, setSel] = useState<string | null>(brands[0]?.id ?? null);
  const cur = brands.find((b) => b.id === sel) ?? brands[0];

  if (brands.length === 0) {
    return <div className="note">마케팅 프로젝트가 연결된 브랜드사가 없습니다.</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", gap: 14 }}>
      <div className="card">
        <div className="hd">
          <b>브랜드사</b>
          <span style={{ color: "var(--ink3)", fontSize: "11px" }}>마케팅 프로젝트 보유</span>
        </div>
        <div style={{ padding: "4px 0 8px" }}>
          <div className="ml">
            {brands.map((b) => (
              <div
                key={b.id}
                className={`it ${b.id === sel ? "on" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSel(b.id)}
              >
                <div className="fr">
                  {b.name} <span>{b.list.length}건</span>
                </div>
                <div className="pv">
                  {b.list.some((r) => r.kind === "routine") && (
                    <span className="cellchip cc-ing" style={{ fontSize: "9.5px" }}>
                      운영대행
                    </span>
                  )}{" "}
                  {b.list.some((r) => r.proposal_status === "won") && (
                    <span className="cellchip cc-ok" style={{ fontSize: "9.5px" }}>
                      수주
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        {cur && (
          <div className="card">
            <div className="hd">
              <b>
                <Link href={`/brand/${cur.id}`} className="hover:underline">
                  {cur.name}
                </Link>{" "}
                — 프로젝트 {cur.list.length}건
              </b>
              <div className="rt">
                <Link href={`/brand/${cur.id}`} className="btn sm">
                  브랜드 카드
                </Link>
              </div>
            </div>
            <table className="t">
              <tbody>
                <tr>
                  <th>구분</th>
                  <th>프로젝트</th>
                  <th>메모</th>
                  <th>제안 현황</th>
                </tr>
                {cur.list.map((r) => (
                  <tr key={r.id} style={r.kind === "routine" ? { background: "#f0fdf4" } : undefined}>
                    <td>
                      <span className={`cellchip ${r.kind === "routine" ? "cc-ok" : "cc-ing"}`}>
                        {r.kind === "routine" ? "루틴" : "개별"}
                      </span>
                    </td>
                    <td>
                      <b>{r.title}</b>
                    </td>
                    <td>{r.note || "—"}</td>
                    <td>
                      <span className={`cellchip ${ST[r.proposal_status]?.cc ?? "cc-no"}`}>
                        {ST[r.proposal_status]?.ko ?? r.proposal_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
