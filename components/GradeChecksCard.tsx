"use client";
// 등급 5대 지표 카드 (기획 확정) — 담당자 보정 + 미입력 "입력 필요" + 저장→등급 재계산.
//   운영(live) 전이 전 5개 모두 입력 필수 — 게이트에서 검사, 여기선 진행 상태 표시.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGradeChecksAction, type CheckValue } from "@/app/(dash)/brand360/grade-actions";

const LABELS: Record<string, string> = {
  q1: "해외 플랫폼 월매출 1천만↑", q2: "수출인증/현지물류 보유", q3: "직수출 6개월↑",
  q4: "해외 팝업/전시 이력", q5: "인플루언서 시딩 10회↑",
};
const KEYS = ["q1", "q2", "q3", "q4", "q5"] as const;

export default function GradeChecksCard({ brandId, initial, grade }: {
  brandId: string; initial: Record<string, boolean>; grade: string | null;
}) {
  const [checks, setChecks] = useState<Record<string, CheckValue>>(() => {
    const c: Record<string, CheckValue> = {};
    for (const k of KEYS) c[k] = k in initial ? initial[k] : null;
    return c;
  });
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const missing = KEYS.filter((k) => checks[k] === null).length;

  const cycle = (k: string) => setChecks((p) => ({ ...p, [k]: p[k] === null ? true : p[k] === true ? false : null }));

  return (
    <div className="card">
      <div className="hd"><b>등급 5대 지표 — 담당 보정</b>
        {grade && <span className={`gr ${grade}`} style={{ marginLeft: 6 }}>{grade}</span>}
        {missing > 0 && <span className="chip red" style={{ marginLeft: "auto" }}>입력 필요 {missing}개</span>}
        {missing === 0 && <span className="chip grn" style={{ marginLeft: "auto" }}>전체 입력 완료</span>}
      </div>
      <div className="bd" style={{ fontSize: 12.5 }}>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 6 }}>
          미팅에서 확인되면 담당이 보정(보정값 우선) · 클릭: 충족 → 미충족 → 미입력 · <b>운영 전이 전 5개 모두 입력 필수</b>
        </div>
        {KEYS.map((k) => {
          const v = checks[k];
          return (
            <div key={k} className={`chk ${v === true ? "c" : ""}`} onClick={() => cycle(k)} style={{ cursor: "pointer" }}>
              <span className="cb" style={v === false ? { background: "#fee2e2", borderColor: "#fca5a5" } : undefined} />
              <span>{LABELS[k]}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: v === null ? "var(--danger)" : "var(--ink3)", fontWeight: v === null ? 700 : 400 }}>
                {v === true ? "충족" : v === false ? "미충족" : "⚠ 입력 필요"}
              </span>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
          <button className="btn sm pri" style={{ flex: 1 }} disabled={pending} onClick={() => start(async () => {
            setMsg("");
            const r = await saveGradeChecksAction(brandId, checks);
            setMsg(r.ok ? `✓ 저장됨 · 등급 ${r.grade}${(r.missing ?? 0) > 0 ? ` · 입력 필요 ${r.missing}개 남음` : ""}` : r.error ?? "실패");
            if (r.ok) router.refresh();  // 헤더 등급 배지·진단 시그널 즉시 갱신
          })}>{pending ? "저장 중…" : "저장 → 등급 재계산"}</button>
        </div>
        {msg && <div className="note" style={{ marginTop: 8, fontSize: 11 }}>{msg}</div>}
        <div className="note" style={{ marginTop: 8, fontSize: 10.5 }}>5/5=S · 4=A · 2~3=B · 0~1=C — 판정 로직은 glovek 셀프진단과 동일(수기 계산 금지)</div>
      </div>
    </div>
  );
}
