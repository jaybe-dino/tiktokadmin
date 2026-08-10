"use client";

// v3.1 계약·결제 탭 — 계약(+계약 등록·상태 변경) + 결제 이력(결제 안내 발송 · 수기 확인 입력).
// contracts · payments_manual · mall_subscriptions(읽기전용) 실데이터.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addContractAction, composeEmailAction, manualPaymentAction, setContractStatusAction } from "@/app/actions";
import { PLANS, PLAN_LABELS } from "@/lib/types";
import type { Contract } from "@/lib/repo/card";

interface PaymentRow { id: string; plan: string; amount: number; method: string; paid_at: string; note: string }
interface SubRow { plan: string; amount: number | null; status: string; next_charge_at: string | null }

const CONTRACT_KIND: Record<string, string> = {
  mall: "멀티몰", onboarding: "온보딩", guarantee: "개런티", marketing: "마케팅", marketing_retainer: "마케팅 리테이너",
};
const CONTRACT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "초안", cls: "cc-no" },
  review: { label: "검토", cls: "cc-warn" },
  sent: { label: "발송", cls: "cc-ing" },
  signed: { label: "체결", cls: "cc-ok" },
  expired: { label: "만료", cls: "cc-exp" },
  terminated: { label: "해지", cls: "cc-exp" },
};

interface ProposalOpt { id: string; title: string; amount: number | null; status: string }

export default function Brand360Contract({ brandId, contracts, paymentsManual, glovekSubs, proposals = [] }: {
  brandId: string; contracts: Contract[]; paymentsManual: PaymentRow[]; glovekSubs: SubRow[]; proposals?: ProposalOpt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openC, setOpenC] = useState(false);
  const [openP, setOpenP] = useState(false);
  const [msg, setMsg] = useState("");

  return (
    <div className="grid g2" style={{ gap: 14 }}>
      {/* ── 계약 ── */}
      <div className="card">
        <div className="hd">
          <b>계약</b>
          <button className="btn sm pri" style={{ marginLeft: "auto" }} onClick={() => setOpenC((o) => !o)}>
            {openC ? "닫기" : "+ 계약 등록"}
          </button>
        </div>
        <div className="bd">
          {openC && (
            <form
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                start(async () => {
                  const r = await addContractAction({
                    brand_id: brandId,
                    kind: String(f.get("kind") ?? "onboarding"),
                    fee_pct: Number(f.get("fee_pct")) || undefined,
                    term_months: Number(f.get("term_months")) || undefined,
                    start_date: String(f.get("start_date") ?? "") || undefined,
                    end_date: String(f.get("end_date") ?? "") || undefined,
                    note: String(f.get("note") ?? "") || undefined,
                    proposal_id: String(f.get("proposal_id") ?? "") || undefined,
                  });
                  setMsg(r.ok ? "계약 등록됨" : r.error ?? "실패");
                  if (r.ok) { form.reset(); setOpenC(false); }
                  router.refresh();
                });
              }}
            >
              <select name="kind" className="f" defaultValue="onboarding">
                {Object.entries(CONTRACT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input name="fee_pct" className="f" type="number" step="0.1" placeholder="정산율 %" />
              <input name="term_months" className="f" type="number" placeholder="기간(개월)" />
              <input name="note" className="f" placeholder="특약·메모" />
              <input name="start_date" className="f" type="date" title="시작일" />
              <input name="end_date" className="f" type="date" title="종료일" />
              {/* 운영제안서(견적) 연결 — 영업파트 계약·결제에서 어느 제안에서 나온 계약인지 추적 */}
              <select name="proposal_id" className="f" style={{ gridColumn: "1 / -1" }} defaultValue="" title="연결할 운영제안서">
                <option value="">운영제안서 연결 안 함</option>
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>
                    📄 {p.title || "(제목 없음)"}{p.amount != null ? ` · ${p.amount.toLocaleString("ko-KR")}원` : ""} ({p.status})
                  </option>
                ))}
              </select>
              <button className="btn sm pri" style={{ gridColumn: "1 / -1" }} disabled={pending} type="submit">등록</button>
            </form>
          )}
          {contracts.length === 0 ? (
            <div className="note">
              아직 등록된 계약이 없습니다. 제안 확정 후 <b>온보딩/마케팅/멀티몰</b> 계약을 등록하세요 — 조건 빌더(기간·정산율·특약)와 계약서 파일 첨부 지원.
            </div>
          ) : (
            <table className="t">
              <thead>
                <tr><th>종류</th><th>상태</th><th>기간</th><th>만료</th></tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const st = CONTRACT_STATUS[c.status] ?? { label: c.status, cls: "cc-no" };
                  return (
                    <tr key={c.id}>
                      <td>
                        {CONTRACT_KIND[c.kind] ?? c.kind} v{c.version}
                        {c.proposal_id && (
                          <div className="sub" title="연결된 운영제안서"><span className="cellchip cc-ing" style={{ fontSize: 10 }}>📄 {proposals.find((p) => p.id === c.proposal_id)?.title ?? "제안서 연결됨"}</span></div>
                        )}
                      </td>
                      <td>
                        <select
                          className="f"
                          style={{ width: "auto", padding: "2px 6px", fontSize: 11.5 }}
                          defaultValue={c.status}
                          disabled={pending}
                          onChange={(e) =>
                            start(async () => {
                              const r = await setContractStatusAction(brandId, c.id, e.target.value);
                              setMsg(r.ok ? "계약 상태 변경됨" : r.error ?? "실패");
                              router.refresh();
                            })
                          }
                        >
                          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <span className={`cellchip ${st.cls}`} style={{ marginLeft: 4 }}>{st.label}</span>
                      </td>
                      <td>{(c.terms as { term_months?: number })?.term_months ? `${(c.terms as { term_months?: number }).term_months}개월` : "—"}</td>
                      <td>{c.end_date?.slice(0, 10) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── 결제 이력 ── */}
      <div className="card">
        <div className="hd">
          <b>결제 이력</b>
          <div className="rt" style={{ display: "flex", gap: 6 }}>
            <button
              className="btn sm pri"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await composeEmailAction(brandId, "결제 안내");
                  setMsg(r.ok ? `결제 안내 초안 생성됨 → 미팅·메일 탭/초안함에서 승인·발송 (${r.subject ?? ""})` : r.error ?? "실패");
                  router.refresh();
                })
              }
            >
              결제 안내 발송
            </button>
            <button className="btn sm" onClick={() => setOpenP((o) => !o)}>{openP ? "닫기" : "수기 확인 입력"}</button>
          </div>
        </div>
        <div className="bd">
          {openP && (
            <form
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                start(async () => {
                  const r = await manualPaymentAction({
                    brandId,
                    plan: String(f.get("plan") ?? "guarantee_1m"),
                    amount: Number(f.get("amount")),
                    paid_at: String(f.get("paid_at") ?? ""),
                    next_due: String(f.get("next_due") ?? "") || undefined,
                    note: String(f.get("note") ?? "") || undefined,
                  });
                  setMsg(r.ok ? "수기 결제 기록됨" : r.error ?? "실패");
                  if (r.ok) { form.reset(); setOpenP(false); }
                  router.refresh();
                });
              }}
            >
              <select name="plan" className="f" defaultValue="guarantee_1m">
                {PLANS.map((p) => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
              </select>
              <input name="amount" className="f" type="number" placeholder="금액(원) *" required />
              <input name="paid_at" className="f" type="date" required />
              <input name="next_due" className="f" type="date" title="다음 결제일" />
              <input name="note" className="f" style={{ gridColumn: "1 / -1" }} placeholder="메모 (이체·계약서 건 등)" />
              <button className="btn sm pri" style={{ gridColumn: "1 / -1" }} disabled={pending} type="submit">기록</button>
            </form>
          )}
          {glovekSubs.length === 0 && paymentsManual.length === 0 ? (
            <div className="note">
              결제 이력이 없습니다. <b>카드결제(온보딩·개런티·구독)는 glovek에서 직접 수납</b> — 어드민에서 결제 안내 메일만 발송하면, 브랜드가 glovek 로그인 후 결제하고 <b>웹훅으로 자동 확인·상태 전진</b>합니다. 계약서·계좌이체 건만 수기 확인으로 입력하세요.
            </div>
          ) : (
            <>
              {glovekSubs.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, marginBottom: 4 }}>glovek 정기(구독) — 웹훅 자동 확인</div>
                  {glovekSubs.map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                      <span>{s.plan} · <span className="chip grn">{s.status}</span></span>
                      <span>{s.amount ? `₩${s.amount.toLocaleString()}` : ""} {s.next_charge_at ? `· ${s.next_charge_at.slice(0, 10)}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, marginBottom: 4 }}>수기 확인</div>
              {paymentsManual.length === 0 ? (
                <p className="note">수기 확인 건 없음.</p>
              ) : (
                paymentsManual.map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                    <span>{PLAN_LABELS[p.plan as keyof typeof PLAN_LABELS] ?? p.plan} · {p.method}</span>
                    <span>₩{p.amount.toLocaleString()} · {p.paid_at?.slice(0, 10)}</span>
                  </div>
                ))
              )}
            </>
          )}
          {msg && <div className="note" style={{ marginTop: 10 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}
