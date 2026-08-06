"use client";
// ④ 틱톡샵 계정(운영·정산) — 개설 정보(셀러센터/ID/PW) 입력 + 개설 안내 자동 문자·이메일 발송.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTiktokAccountAction } from "@/app/(dash)/brand360/actions";
import type { Brand } from "@/lib/types";
import { kstDateTime } from "@/lib/time";

type TBrand = Brand & {
  tiktok_shop_url?: string | null; tiktok_seller_id?: string | null; tiktok_seller_pw?: string | null;
  tiktok_opened_at?: string | null; tiktok_sent_at?: string | null;
};

export default function Brand360TiktokAccount({ brand }: { brand: TBrand }) {
  const router = useRouter();
  const [url, setUrl] = useState(brand.tiktok_shop_url ?? "");
  const [id, setId] = useState(brand.tiktok_seller_id ?? "");
  const [pw, setPw] = useState(brand.tiktok_seller_pw ?? "");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const sentAt = brand.tiktok_sent_at ? kstDateTime(brand.tiktok_sent_at) : null;

  async function save(sendNotify: boolean) {
    if (sendNotify && !confirm("브랜드 담당자에게 셀러센터 링크·ID·PW를 문자/이메일로 발송합니다. 진행할까요?")) return;
    setBusy(true);
    const r = await saveTiktokAccountAction(brand.id, {
      tiktok_shop_url: url, tiktok_seller_id: id, tiktok_seller_pw: pw,
      markOpened: sendNotify, sendNotify,
    });
    setBusy(false);
    if (r.ok) {
      setMsg(sendNotify ? (r.sent?.length ? `발송 완료: ${r.sent.map((s) => (s === "sms" ? "문자" : "이메일")).join("·")}` : "발송 실패 — 연락처/발송설정 확인") : "저장되었습니다.");
      router.refresh();
    } else setMsg(r.error ?? "실패");
    setTimeout(() => setMsg(""), 3500);
  }

  return (
    <div className="card" style={{ marginTop: 14, borderColor: "#c7f0e0" }}>
      <div className="hd" style={{ background: "linear-gradient(90deg,#effcf6,#fff)", flexWrap: "wrap" }}>
        <b>🛍️ 틱톡샵 계정 (운영·정산)</b>
        {brand.tiktok_opened_at
          ? <span className="chip grn" style={{ fontSize: 10 }}>개설됨{sentAt ? ` · 안내발송 ${sentAt}` : ""}</span>
          : <span className="chip amb" style={{ fontSize: 10 }}>미개설</span>}
      </div>
      <div className="bd">
        <div style={{ display: "grid", gap: 8 }}>
          <label className="label">셀러센터 / 판매 링크
            <input className="f" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seller.tiktokglobalshop.com/…" />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label className="label">아이디
              <input className="f" value={id} onChange={(e) => setId(e.target.value)} placeholder="seller@brand.com" />
            </label>
            <label className="label">비밀번호(초기)
              <div style={{ display: "flex", gap: 4 }}>
                <input className="f" type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="초기 비밀번호" />
                <button type="button" className="btn sm" onClick={() => setShowPw((s) => !s)}>{showPw ? "숨김" : "보기"}</button>
              </div>
            </label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button className="btn sm" disabled={busy} onClick={() => save(false)}>저장</button>
          <button className="btn sm pri" disabled={busy || !url || !id} onClick={() => save(true)}>개설 완료 &amp; 안내 발송</button>
          {msg && <span className="note" style={{ marginLeft: "auto", fontSize: 12 }}>{msg}</span>}
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          서류 수급 최종 승인·개설 후 계정 정보를 입력하고 <b>안내 발송</b>을 누르면, 브랜드 담당자에게 셀러센터 링크·ID·PW가 문자·이메일로 1회 발송됩니다.
          비밀번호는 발송 후 고객이 변경하도록 안내되며, 화면에는 가림 처리됩니다.
        </div>
      </div>
    </div>
  );
}
