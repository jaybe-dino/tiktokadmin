"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { STATE_LABELS } from "@/lib/types";
import type { BoardCard } from "@/lib/repo/queries";

/** 트랙(계약 유형) 라벨 — 기획 8절: 멀티몰/온보딩/마케팅 */
export const TRACK_LABELS: Record<string, string> = {
  mall: "멀티몰",
  onboarding: "온보딩",
  marketing: "마케팅",
};

export const TRACK_COLORS: Record<string, { bg: string; fg: string }> = {
  mall: { bg: "#ccfbf1", fg: "#115e59" },
  onboarding: { bg: "#ede9fe", fg: "#5b21b6" },
  marketing: { bg: "#fce7f3", fg: "#9d174d" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 보드 카드 요약 레이어(모달) — 기획 8절: 카드 클릭 시 /brand 이동 대신 요약을 먼저 보여주고,
 * 브랜드360은 레이어의 링크로 이동한다.
 */
export default function BoardCardLayer({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const track = card.contract_type ? (TRACK_LABELS[card.contract_type] ?? card.contract_type) : null;
  const trackColor = card.contract_type ? TRACK_COLORS[card.contract_type] : undefined;

  const rows: { label: string; node: ReactNode }[] = [
    {
      label: "트랙",
      node: track ? (
        <span
          className="pill"
          style={{ background: trackColor?.bg ?? "#e2e8f0", color: trackColor?.fg ?? "#334155", fontSize: 11, fontWeight: 700 }}
        >
          {track}
        </span>
      ) : (
        <span className="text-muted">미지정</span>
      ),
    },
    { label: "담당", node: card.owners_display || <span style={{ color: "var(--danger)", fontWeight: 700 }}>담당 미배정</span> },
    { label: "다음 액션", node: card.next_action || "—" },
    { label: "기한", node: fmtDate(card.due_date) },
    { label: "최근 접촉", node: fmtDate(card.last_contact_at) },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${card.brand_name} 요약`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--card, #fff)",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 20px 50px rgba(15,23,42,.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          {card.grade && <span className={`gr ${card.grade}`}>{card.grade}</span>}
          <h2 style={{ fontSize: 16, fontWeight: 800, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {card.brand_name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{ fontSize: 18, lineHeight: 1, color: "var(--muted, #64748b)", padding: 4 }}
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <span className="pill" style={{ background: "#f1f5f9", color: "#334155", fontSize: 11 }}>
            {STATE_LABELS[card.state] ?? card.state}
          </span>
          {card.state === "settling" && (
            <span className="pill" style={{ background: "#fef9c3", color: "#854d0e", fontSize: 11, fontWeight: 700 }}>
              정산중
            </span>
          )}
        </div>

        <dl style={{ display: "grid", gridTemplateColumns: "88px 1fr", rowGap: 8, columnGap: 8, fontSize: 13 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "contents" }}>
              <dt style={{ color: "var(--muted, #64748b)", fontWeight: 600 }}>{r.label}</dt>
              <dd style={{ minWidth: 0, wordBreak: "break-word" }}>{r.node}</dd>
            </div>
          ))}
        </dl>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            className="pill"
            style={{ background: "#f1f5f9", color: "#334155", fontSize: 13, padding: "6px 14px", fontWeight: 600 }}
          >
            닫기
          </button>
          <Link
            href={`/brand/${card.id}`}
            className="pill"
            style={{ background: "var(--sales, #2563eb)", color: "#fff", fontSize: 13, padding: "6px 14px", fontWeight: 700 }}
          >
            브랜드360 열기
          </Link>
        </div>
      </div>
    </div>
  );
}
