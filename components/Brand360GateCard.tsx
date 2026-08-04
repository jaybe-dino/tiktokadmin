"use client";

// v3.1 개요 우측 — 다음 스텝 게이트(현재) + 그다음 게이트(예고).
// "게이트 통과" 버튼은 transitionAction(게이트 검증 경유)로 실제 이동.
// 현재 단계 필수항목(stage_requirements)도 게이트 카드에 함께 표시 — 체크는 stageCheckAction.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stageCheckAction, transitionAction } from "@/app/actions";
import type { State } from "@/lib/types";

export interface GateView {
  from: string;
  toState: State;
  to: string;
  items: { label: string; done: boolean }[];
}

interface StageReq { id: string; label: string; kind: string; field_key: string | null; done: boolean }

export default function Brand360GateCard({ brandId, gate, gateNext, stageReqs }: {
  brandId: string;
  gate: GateView | null;
  gateNext: { from: string; to: string; items: { label: string; done: boolean }[] } | null;
  stageReqs: StageReq[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null);

  if (!gate && stageReqs.length === 0 && !gateNext) return null;

  const allDone = gate ? gate.items.every((i) => i.done) && stageReqs.every((r) => r.done) : false;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {gate && (
        <div className="gate">
          <h5>▶ 다음 스텝 게이트: {gate.from} → {gate.to}</h5>
          {gate.items.length === 0 && stageReqs.length === 0 && (
            <div className="gi"><span className="ok">✅</span> 게이트 조건 없음 — 바로 이동 가능</div>
          )}
          {gate.items.map((it, i) => (
            <div key={i} className="gi">
              <span className={it.done ? "ok" : "no"}>{it.done ? "✅" : "⬜"}</span> {it.label}
            </div>
          ))}
          {/* 현재 단계 필수항목(관리자 설정) — check 형은 여기서 직접 체크 */}
          {stageReqs.map((r) => (
            <div key={r.id} className="gi">
              {r.kind === "check" ? (
                <input
                  type="checkbox"
                  checked={r.done}
                  disabled={pending}
                  onChange={(e) =>
                    start(async () => {
                      await stageCheckAction(brandId, r.id, e.target.checked);
                      router.refresh();
                    })
                  }
                />
              ) : (
                <span className={r.done ? "ok" : "no"}>{r.done ? "✅" : "⬜"}</span>
              )}
              {r.label}
              {r.kind === "field" && !r.done && (
                <span style={{ color: "var(--ink3)", fontSize: 11 }}>(필드 {r.field_key} 미입력)</span>
              )}
            </div>
          ))}
          <button
            className={`btn ${allDone ? "grn" : ""}`}
            style={{ width: "100%", marginTop: 8 }}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await transitionAction(brandId, gate.toState);
                if (r.ok) setMsg({ t: `게이트 통과 — ${gate.to}(으)로 이동됨`, bad: false });
                else setMsg({ t: r.failed?.length ? `이동 조건 미충족: ${r.failed.map((f) => f.label).join(" · ")}` : (r.error || "게이트 미충족"), bad: true });
                setTimeout(() => setMsg(null), 4000);
                router.refresh();
              })
            }
          >
            게이트 통과 — {gate.to}(으)로 이동
          </button>
          {msg && (
            <div className="note" style={{ marginTop: 6, color: msg.bad ? "var(--danger)" : "var(--ok)", fontWeight: 700 }}>
              {msg.t}
            </div>
          )}
        </div>
      )}

      {gateNext && gateNext.items.length > 0 && (
        <div className="gate" style={{ borderColor: "var(--line)", background: "#f8fafc" }}>
          <h5 style={{ color: "var(--ink3)" }}>그다음: {gateNext.from} → {gateNext.to}</h5>
          {gateNext.items.map((it, i) => (
            <div key={i} className="gi">
              <span className={it.done ? "ok" : "no"}>{it.done ? "✅" : "⬜"}</span> {it.label}
              {it.label.includes("제안") && !it.done && (
                <Link href="/proposals" className="btn sm" style={{ marginLeft: "auto" }}>작성 →</Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
