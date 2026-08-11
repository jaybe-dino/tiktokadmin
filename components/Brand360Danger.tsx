"use client";
// 브랜드360 위험 구역 — 브랜드 및 연관 데이터 완전 삭제(파트장/대표 전용).
//   미팅·메일·서류·제품·계약·결제·타임라인 등 연관 행이 CASCADE 로 함께 제거된다(복구 불가).
//   실수 방지: 브랜드명을 정확히 입력해야 삭제 버튼이 활성화된다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBrandAction } from "@/app/actions";

export default function Brand360Danger({ brandId, brandName }: { brandId: string; brandName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const canDelete = confirmText.trim() === brandName.trim() && brandName.trim().length > 0;

  function doDelete() {
    if (!canDelete) return;
    setErr("");
    start(async () => {
      const r = await deleteBrandAction(brandId);
      if (r.ok) {
        router.push("/customers");
      } else {
        setErr(r.error ?? "삭제 실패");
      }
    });
  }

  return (
    <div className="card" style={{ marginTop: 18, border: "1px solid var(--danger, #dc2626)", borderRadius: 12 }}>
      <div className="bd">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div>
            <b style={{ color: "var(--danger, #dc2626)", fontSize: 13 }}>⚠️ 위험 구역 — 브랜드 완전 삭제</b>
            <div className="note" style={{ marginTop: 4 }}>
              이 브랜드와 <b>모든 연관 데이터</b>(미팅·메일·서류·제품·계약·결제·타임라인 등)를 영구 삭제합니다. 복구할 수 없습니다.
              {" "}보류만 원한다면 대신 <b>드랍(보류)</b>을 사용하세요.
            </div>
          </div>
          {!open && (
            <button className="btn" style={{ color: "var(--danger, #dc2626)", borderColor: "var(--danger, #dc2626)", flexShrink: 0 }} onClick={() => setOpen(true)}>
              완전 삭제…
            </button>
          )}
        </div>

        {open && (
          <div style={{ marginTop: 12, display: "grid", gap: 8, maxWidth: 460 }}>
            <label style={{ fontSize: 12.5 }}>
              삭제를 확인하려면 브랜드명 <b>{brandName}</b> 을(를) 정확히 입력하세요.
            </label>
            <input
              className="f"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={brandName}
              autoComplete="off"
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                style={{ background: canDelete ? "var(--danger, #dc2626)" : undefined, color: canDelete ? "#fff" : undefined, opacity: canDelete ? 1 : 0.5 }}
                disabled={!canDelete || pending}
                onClick={doDelete}
              >
                {pending ? "삭제 중…" : "영구 삭제"}
              </button>
              <button className="btn sm" disabled={pending} onClick={() => { setOpen(false); setConfirmText(""); setErr(""); }}>
                취소
              </button>
            </div>
            {err && <span className="note" style={{ color: "var(--danger, #dc2626)" }}>{err}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
