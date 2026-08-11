"use client";
// 상단 알림 종 — 할 일이 있으면 빨간 배지, 클릭 시 레이어로 목록 표시.
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NotifItem } from "@/lib/notifications";

const PRI_DOT = (p: number) => (p === 0 ? "🔴" : p === 1 ? "🟠" : "🔵");

export default function NotificationBell({ count, items }: { count: number; items: NotifItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={count > 0 ? `할 일 ${count}건` : "할 일 없음"}
        style={{
          position: "relative", width: 36, height: 36, borderRadius: 9, border: "1px solid var(--line)",
          background: open ? "var(--bg)" : "#fff", fontSize: 17, cursor: "pointer", lineHeight: 1,
        }}
      >
        🔔
        {count > 0 && (
          <span
            style={{
              position: "absolute", top: -5, right: -5, minWidth: 17, height: 17, padding: "0 4px",
              borderRadius: 9, background: "#dc2626", color: "#fff", fontSize: 10.5, fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff",
            }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: 44, right: 0, width: 340, maxHeight: 460, overflowY: "auto",
            background: "#fff", border: "1px solid var(--line)", borderRadius: 12,
            boxShadow: "0 12px 32px rgba(15,23,42,.16)", zIndex: 60,
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 13 }}>🔔 내 할 일</b>
            <span className="chip" style={{ fontSize: 10 }}>{count}건</span>
            <Link href="/queue" className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>워크큐 →</Link>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--ink3)", fontSize: 12.5 }}>
              지금 처리할 할 일이 없습니다 🎉
            </div>
          ) : (
            <div>
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => { setOpen(false); router.push(it.link); }}
                  style={{
                    display: "flex", gap: 8, width: "100%", textAlign: "left", padding: "9px 14px",
                    borderBottom: "1px solid var(--line)", background: "none", border: "none", borderBottomWidth: 1,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{PRI_DOT(it.priority)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.8, fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--ink3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
