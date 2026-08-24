"use client";
// 신청서 미시작 고객 — 담당자가 강제 승인(신청서 생성+즉시 승인) 또는 계정 삭제.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { forceApproveCustomerAction, deleteOnbCustomerAction } from "../actions";

export default function NoAppActions({ customerId, hasBrand }: { customerId: string; hasBrand: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function forceApprove() {
    if (!hasBrand) { setMsg("먼저 목록에서 연결 브랜드를 지정하세요 — 승인 시 해당 브랜드 원장에 매핑됩니다."); return; }
    if (!confirm("고객이 작성하지 않았어도 신청서를 만들어 즉시 승인하고 브랜드 원장에 매핑합니다. 진행할까요?")) return;
    setBusy(true); setMsg("");
    const r = await forceApproveCustomerAction(customerId);
    setBusy(false);
    if (r.ok) { setMsg(`강제 승인 완료 — 제품 ${r.mappedProducts ?? 0} · 국가 ${r.mappedCountries ?? 0} 매핑됨`); router.refresh(); }
    else setMsg(r.error ?? "승인 실패");
  }
  async function remove() {
    if (!confirm("이 계정과 신청서·서류를 완전히 삭제합니다. 되돌릴 수 없습니다. 진행할까요?")) return;
    setBusy(true); setMsg("");
    const r = await deleteOnbCustomerAction(customerId);
    setBusy(false);
    if (r.ok) router.push("/onboarding");
    else setMsg(r.error ?? "삭제 실패");
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 10 }}>
        고객이 아직 신청서를 작성하지 않았습니다. 담당자가 <b>강제 승인</b>하면 빈 신청서를 만들어 즉시 승인하고,
        연결된 브랜드 원장에 매핑합니다{hasBrand ? "." : " — 먼저 목록에서 브랜드를 연결하세요."}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" disabled={busy || !hasBrand} onClick={forceApprove}>강제 승인 &amp; 원장 매핑</button>
        <button className="btn sm" disabled={busy} onClick={remove} style={{ color: "#e03131", marginLeft: "auto" }}>계정·신청서 삭제</button>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink2)" }}>{msg}</div>}
    </div>
  );
}
