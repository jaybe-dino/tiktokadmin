"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addContractAction } from "@/app/actions";
import { markBrandMarketingTrackAction } from "./actions";

// 헤더 "+ 계약 등록" — 인라인 폼 토글 → addContractAction(기존 액션) 으로 실제 계약 생성(draft).
export default function RegisterContractButton({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [kind, setKind] = useState("mall");
  const [feePct, setFeePct] = useState("");
  const [start1, setStart1] = useState("");
  const [end1, setEnd1] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    setErr("");
    if (!brandId) {
      setErr("브랜드를 선택하세요.");
      return;
    }
    start(async () => {
      const r = await addContractAction({
        brand_id: brandId,
        kind,
        fee_pct: feePct.trim() ? Number(feePct) : undefined,
        start_date: start1 || undefined,
        end_date: end1 || undefined,
        note: note.trim() || undefined,
      });
      if (r.ok) {
        // 마케팅 계약이면 원장 트랙 보정(contract_type 비어 있을 때만 'marketing').
        if (kind.startsWith("marketing")) {
          await markBrandMarketingTrackAction(brandId);
        }
        setOpen(false);
        setFeePct("");
        setStart1("");
        setEnd1("");
        setNote("");
        router.refresh();
      } else {
        setErr(r.error ?? "계약 등록 실패");
      }
    });
  }

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button className="btn pri" onClick={() => setOpen((v) => !v)}>
        + 계약 등록
      </button>

      {open && (
        <div
          className="card"
          style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 30, width: 340, padding: 14, textAlign: "left" }}
        >
          <div className="hd" style={{ marginBottom: 8 }}><b>새 계약 등록</b></div>
          <label className="f">브랜드</label>
          <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            {brands.length === 0 && <option value="">브랜드가 없습니다</option>}
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <label className="f" style={{ marginTop: 8 }}>계약 종류</label>
          <select className="f" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="mall">멀티몰</option>
            <option value="onboarding">온보딩</option>
            <option value="guarantee">Guarantee</option>
            <option value="marketing">마케팅</option>
            <option value="marketing_retainer">마케팅 리테이너</option>
          </select>
          <label className="f" style={{ marginTop: 8 }}>수수료 %</label>
          <input className="f" type="number" value={feePct} onChange={(e) => setFeePct(e.target.value)} placeholder="예: 15" />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="f">시작일</label>
              <input className="f" type="date" value={start1} onChange={(e) => setStart1(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="f">종료일</label>
              <input className="f" type="date" value={end1} onChange={(e) => setEnd1(e.target.value)} />
            </div>
          </div>
          <label className="f" style={{ marginTop: 8 }}>메모</label>
          <input className="f" value={note} onChange={(e) => setNote(e.target.value)} placeholder="선택" />
          {err && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)", marginTop: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button className="btn" style={{ flex: 1 }} disabled={pending} onClick={() => setOpen(false)}>취소</button>
            <button className="btn pri" style={{ flex: 1 }} disabled={pending} onClick={submit}>
              {pending ? "등록 중…" : "등록"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
