"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manualPaymentAction } from "@/app/actions";
import { sendPaymentGuideAction } from "./actions";

// 결제 안내·확인 카드 — 방식 선택(①/②) 실제 동작.
//   ① glovek 카드결제 안내 메일 발송(canSend 게이트 경유)
//   ② 계좌이체·수기 확인 → manualPaymentAction(기존 게이트 액션)
export default function PaymentPanel({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [item, setItem] = useState("온보딩 (카드)");
  const [method, setMethod] = useState<1 | 2>(1);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");

  function run() {
    setMsg(null);
    if (!brandId) {
      setMsg({ ok: false, text: "브랜드를 선택하세요." });
      return;
    }
    start(async () => {
      if (method === 1) {
        const r = await sendPaymentGuideAction({ brandId, item });
        if (r.ok) {
          setMsg({ ok: true, text: r.sent ? "결제 안내 메일을 발송했습니다." : "발송 접수(메일 연동 미설정 — 기록만 저장)." });
          router.refresh();
        } else {
          setMsg({ ok: false, text: r.error ?? "발송 실패" });
        }
      } else {
        const amt = Number(amount);
        if (!amt || amt <= 0) {
          setMsg({ ok: false, text: "금액을 입력하세요." });
          return;
        }
        if (!paidAt) {
          setMsg({ ok: false, text: "입금일을 입력하세요." });
          return;
        }
        const r = await manualPaymentAction({ brandId, plan: item, amount: amt, paid_at: paidAt });
        if (r.ok) {
          setMsg({ ok: true, text: "수기 결제를 기록했습니다." });
          setAmount("");
          setPaidAt("");
          router.refresh();
        } else {
          setMsg({ ok: false, text: r.error ?? "기록 실패" });
        }
      }
    });
  }

  return (
    <div className="bd">
      <label className="f">브랜드 / 결제 항목</label>
      <div style={{ display: "flex", gap: 6 }}>
        <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          {brands.length === 0 && <option value="">계약된 브랜드가 없습니다</option>}
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select className="f" value={item} onChange={(e) => setItem(e.target.value)}>
          <option>온보딩 (카드)</option>
          <option>Guarantee (카드)</option>
          <option>추가 결제 (금액 입력)</option>
        </select>
      </div>
      <label className="f" style={{ marginTop: 8 }}>결제 방식</label>
      <div
        className={`radio${method === 1 ? " sel" : ""}`}
        onClick={() => setMethod(1)}
        style={{ cursor: "pointer" }}
      >
        <span className="rb" />
        <div>
          <b>① glovek 카드결제 안내 발송</b>
          <div style={{ color: "var(--ink3)", fontSize: 11 }}>이메일 안내 → 브랜드가 glovek 로그인 → 카드결제 · 결제 완료 시 <b>웹훅 자동 확인 → 상태 자동 전진</b></div>
        </div>
      </div>
      <div
        className={`radio${method === 2 ? " sel" : ""}`}
        onClick={() => setMethod(2)}
        style={{ cursor: "pointer" }}
      >
        <span className="rb" />
        <div>
          <b>② 계약서·계좌이체 (수기 확인)</b>
          <div style={{ color: "var(--ink3)", fontSize: 11 }}>금액·입금일 입력 → <b>수동 확인 → 게이트 충족</b></div>
        </div>
      </div>

      {method === 2 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input className="f" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="금액(원)" />
          <input className="f" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
      )}

      <button className="btn pri" style={{ width: "100%", marginTop: 10 }} disabled={pending} onClick={run}>
        {pending ? "처리 중…" : method === 1 ? "결제 안내 메일 발송" : "수기 결제 확인 기록"}
      </button>

      {msg && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msg.ok ? "var(--ok)" : "var(--warn)" }}>
          {msg.text}
        </div>
      )}

      <div className="note" style={{ marginTop: 8 }}>발송 후 "결제 대기" 상태로 추적 — 미결제 3일 시 리마인더 자동 · 링크 열람 횟수 기록</div>
    </div>
  );
}
