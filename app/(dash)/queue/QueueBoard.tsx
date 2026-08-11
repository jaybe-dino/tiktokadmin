"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GradeBadge, StateBadge } from "@/components/badges";
import type { Grade, State } from "@/lib/types";

export interface QueueRow {
  id: string;
  brand_name: string;
  grade: Grade | null;
  state: State;
  next_action: string;
  due_date: string | null;
  owners: string;
  ownerIds: string[];
  rank: number;
  elapsed: number | null;
  elapsedRed: boolean;
  tier: { label: string; cls: string };
  // 유형 필터 태그
  sla: boolean;
  approve: boolean;
  docs: boolean;
  replyNeeded: boolean;
}

type TypeFilter = "all" | "sla" | "approve" | "docs";

export default function QueueBoard({
  rows,
  ownerOptions,
  defaultOwner,
  userName,
  userRole,
}: {
  rows: QueueRow[];
  ownerOptions: { id: string; name: string }[];
  defaultOwner: string;
  userName: string;
  userRole: string;
}) {
  const [owner, setOwner] = useState<string>(defaultOwner);
  const [type, setType] = useState<TypeFilter>("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (owner !== "all" && !r.ownerIds.includes(owner)) return false;
      if (type === "sla" && !r.sla) return false;
      if (type === "approve" && !r.approve) return false;
      if (type === "docs" && !r.docs) return false;
      return true;
    });
  }, [rows, owner, type]);

  return (
    <>
      <div className="ph">
        <div>
          <h1>워크큐 — 내 할 일</h1>
          <p>
            {userName} ({userRole}) · 시스템이 계산한 &quot;지금 해야 할 것&quot; 우선순위 순.
            처리하면 자동으로 사라집니다.
          </p>
        </div>
        <div className="bar" style={{ margin: 0 }}>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">전체 담당</option>
            {ownerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
            <option value="all">전체 유형</option>
            <option value="sla">SLA</option>
            <option value="approve">승인</option>
            <option value="docs">서류</option>
          </select>
        </div>
      </div>

      <div className="card">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 44 }}>우선</th>
              <th>브랜드</th>
              <th>할 일</th>
              <th style={{ width: 96 }}>유형</th>
              <th style={{ width: 72 }}>경과</th>
              <th style={{ width: 56 }}>티어</th>
              <th style={{ width: 190 }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="note">
                    {rows.length === 0
                      ? "담당 브랜드 없음 — 워크큐가 비어 있습니다"
                      : "조건에 맞는 할 일이 없습니다 — 필터를 바꿔보세요"}
                  </div>
                </td>
              </tr>
            )}
            {filtered.map((c, i) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 700, color: "var(--ink3)" }}>{i + 1}</td>
                <td>
                  <Link href={`/brand/${c.id}`} style={{ fontWeight: 700 }}>
                    {c.brand_name}
                  </Link>{" "}
                  <GradeBadge grade={c.grade} />
                  <span className="sub">{c.owners ? c.owners : "미배정"}</span>
                </td>
                <td>
                  {c.replyNeeded && (
                    <span className="pill" style={{ background: "#fef3c7", color: "#92400e", marginRight: 6 }}>📩 회신 필요</span>
                  )}
                  {c.next_action ? (
                    c.next_action
                  ) : c.replyNeeded ? (
                    <span>수신 메일 회신 필요 — 초안함에서 검토·발송</span>
                  ) : (
                    <span style={{ color: "var(--ink3)" }}>다음 액션 미설정 — 지정 필요</span>
                  )}
                  {c.due_date && <span className="sub">마감 {c.due_date}</span>}
                </td>
                <td>
                  <StateBadge state={c.state} />
                </td>
                <td
                  style={{
                    fontWeight: 700,
                    color: c.elapsedRed ? "var(--danger)" : "var(--ink3)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.elapsed === null ? "–" : `${c.elapsed}일`}
                </td>
                <td>
                  <span className={c.tier.cls}>{c.tier.label}</span>
                </td>
                <td>
                  <Link href={`/brand/${c.id}`} className={`btn sm ${c.rank <= 1 ? "pri" : ""}`}>
                    열기
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
