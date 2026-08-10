"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { won } from "@/components/ScreenHeader";
import { computeOpsQuote, OPS_TRACKS, OPS_COUNTRIES, COMMIT_MONTHS, ADDL_DISCOUNTS, OPS_APPROVAL_THRESHOLD, type OpsPaymentMode } from "@/lib/quote";
import { createOpsProposalAction } from "./actions";

interface BrandOpt { id: string; name: string }

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, color: "var(--ink3)", margin: "10px 0 4px" };

export default function QuoteBuilder({ brands }: { brands: BrandOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 브랜드 검색·선택
  const [brandQ, setBrandQ] = useState("");
  const [brandId, setBrandId] = useState("");
  const selectedBrand = brands.find((b) => b.id === brandId) ?? null;
  const kw = brandQ.trim().toLowerCase();
  const filteredBrands = (kw ? brands.filter((b) => b.name.toLowerCase().includes(kw)) : brands).slice(0, 40);

  const [track, setTrack] = useState(OPS_TRACKS[0].key);
  const [countries, setCountries] = useState<string[]>([]);
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<OpsPaymentMode>("commitment");
  const [commitmentMonths, setCommitmentMonths] = useState(6);
  const [addlDiscountPct, setAddlDiscountPct] = useState(0);
  const [countryDiscountPct, setCountryDiscountPct] = useState(0);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [contractFileUrl, setContractFileUrl] = useState("");

  const monthlyNum = Number((monthlyAmount || "").replace(/[, ]/g, "")) || 0;
  const quote = useMemo(
    () => computeOpsQuote({ monthlyAmount: monthlyNum, paymentMode, commitmentMonths, addlDiscountPct, countryDiscountPct, countries }),
    [monthlyNum, paymentMode, commitmentMonths, addlDiscountPct, countryDiscountPct, countries],
  );
  const needsApproval = quote.totalDiscountPct >= OPS_APPROVAL_THRESHOLD;
  const toggleCountry = (c: string) => setCountries((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]);

  // 견적서 생성만 — 발송은 아래 목록의 발송 버튼에서.
  function generate() {
    setMsg(null);
    start(async () => {
      const r = await createOpsProposalAction({
        brand_id: brandId, track, monthlyAmount: monthlyNum, paymentMode,
        commitmentMonths: paymentMode === "commitment" ? commitmentMonths : undefined,
        addlDiscountPct, countryDiscountPct, countries,
        periodStart: periodStart || undefined, periodEnd: periodEnd || undefined,
        contractFileUrl: contractFileUrl.trim() || undefined,
      });
      if (r.ok && r.pendingApproval) {
        setMsg({ ok: true, text: `합산 할인 ${quote.totalDiscountPct}% — 파트장 결재 요청됨(결재함). 승인 후 다시 생성하세요.` });
        router.refresh();
      } else if (r.ok) {
        setMsg({ ok: true, text: `견적서 생성됨 (${won(r.quote ?? 0)}) — 아래 목록에서 발송 버튼으로 보내세요.` });
        setMonthlyAmount("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error ?? "생성 실패" });
      }
    });
  }

  return (
    <div className="card" id="quote-builder">
      <div className="hd"><b>운영 견적서 생성</b></div>
      <div className="bd">
        {/* 브랜드 검색·선택 */}
        <label style={lbl}>브랜드 (검색 후 선택)</label>
        <input className="f" placeholder="브랜드명 검색…" value={brandQ} onChange={(e) => setBrandQ(e.target.value)} />
        <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginTop: 6 }}>
          {filteredBrands.length === 0 && <div style={{ padding: 8, fontSize: 12, color: "var(--ink3)" }}>검색 결과 없음</div>}
          {filteredBrands.map((b) => (
            <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", background: b.id === brandId ? "var(--tint,#eef5ff)" : undefined, fontSize: 13 }}>
              <input type="radio" name="ops-brand" checked={b.id === brandId} onChange={() => setBrandId(b.id)} />
              {b.name}
            </label>
          ))}
        </div>
        {selectedBrand && <div style={{ fontSize: 12, marginTop: 4, color: "var(--acc)" }}>선택: <b>{selectedBrand.name}</b></div>}

        {/* 트랙 3종 */}
        <label style={lbl}>트랙</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OPS_TRACKS.map((t) => (
            <button key={t.key} type="button" className={`chip ${track === t.key ? "chip-grn" : ""}`} style={{ cursor: "pointer", border: "1px solid var(--line)" }} onClick={() => setTrack(t.key)}>
              {track === t.key ? "✓ " : ""}{t.label}
            </button>
          ))}
        </div>

        {/* 국가(중복선택) */}
        <label style={lbl}>대상 국가 (중복 선택)</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OPS_COUNTRIES.map((c) => (
            <button key={c.code} type="button" className={`chip ${countries.includes(c.code) ? "chip-grn" : ""}`} style={{ cursor: "pointer", border: "1px solid var(--line)" }} onClick={() => toggleCountry(c.code)}>
              {countries.includes(c.code) ? "✓ " : ""}{c.label}
            </button>
          ))}
        </div>

        {/* 월 정기결제 금액(수기) */}
        <label style={lbl}>월 정기 결제 금액 (수기, 원)</label>
        <input className="f" inputMode="numeric" placeholder="예: 4900000" value={monthlyAmount} onChange={(e) => setMonthlyAmount(e.target.value)} />

        {/* 결제 방식 */}
        <label style={lbl}>결제 방식</label>
        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 13 }}>
            <input type="radio" name="ops-mode" checked={paymentMode === "commitment"} onChange={() => setPaymentMode("commitment")} /> 약정할인 (일시불)
          </label>
          <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 13 }}>
            <input type="radio" name="ops-mode" checked={paymentMode === "monthly"} onChange={() => setPaymentMode("monthly")} /> 매월 결제
          </label>
        </div>

        {paymentMode === "commitment" && (
          <>
            <label style={lbl}>약정 기간</label>
            <div style={{ display: "flex", gap: 6 }}>
              {COMMIT_MONTHS.map((m) => (
                <button key={m} type="button" className={`chip ${commitmentMonths === m ? "chip-grn" : ""}`} style={{ cursor: "pointer", border: "1px solid var(--line)" }} onClick={() => setCommitmentMonths(m)}>
                  {commitmentMonths === m ? "✓ " : ""}{m}개월
                </button>
              ))}
            </div>
          </>
        )}

        {/* 추가 할인 · 국가 추가할인 */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>추가 할인</label>
            <select className="f" style={{ width: "100%" }} value={addlDiscountPct} onChange={(e) => setAddlDiscountPct(Number(e.target.value))}>
              {ADDL_DISCOUNTS.map((d) => <option key={d} value={d}>{d}%</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>국가 추가할인</label>
            <select className="f" style={{ width: "100%" }} value={countryDiscountPct} onChange={(e) => setCountryDiscountPct(Number(e.target.value))}>
              {ADDL_DISCOUNTS.map((d) => <option key={d} value={d}>{d}%</option>)}
            </select>
          </div>
        </div>
        {needsApproval && <div className="note" style={{ marginTop: 4, color: "var(--warn)", fontSize: 11 }}>합산 할인 {quote.totalDiscountPct}% — 30%↑ 파트장 결재 대상</div>}

        {/* 계약기간 캘린더 */}
        <label style={lbl}>계약기간</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="f" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          <span style={{ color: "var(--ink3)" }}>~</span>
          <input className="f" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>

        <label style={lbl}>계약서 첨부 — 구글드라이브 링크(선택)</label>
        <input className="f" type="url" placeholder="https://drive.google.com/…" value={contractFileUrl} onChange={(e) => setContractFileUrl(e.target.value)} />

        <hr className="hr" />

        {/* 합계 — 할인 0%는 표기하지 않음 */}
        <div className="kv">
          <dt>월 금액(수기)</dt><dd>{monthlyNum ? won(monthlyNum) : "—"}</dd>
          {addlDiscountPct > 0 && (<><dt>추가 할인</dt><dd>-{addlDiscountPct}%</dd></>)}
          {countryDiscountPct > 0 && (<><dt>국가 추가할인</dt><dd>-{countryDiscountPct}%</dd></>)}
          {quote.totalDiscountPct > 0 && (<><dt>할인 후 월</dt><dd>{won(quote.monthlyNet)}</dd></>)}
          <dt><b>{quote.label}</b></dt>
          <dd><b style={{ fontSize: 15 }}>{won(quote.total)} + VAT{quote.recurring ? " / 월" : ""}</b></dd>
        </div>
        <div className="note" style={{ marginTop: 6, fontSize: 11 }}>{quote.breakdown}</div>

        {msg && <div className="note" style={{ marginTop: 8, color: msg.ok ? "var(--ok)" : "var(--warn)", fontWeight: 700 }}>{msg.text}</div>}

        <button className="btn pri" style={{ width: "100%", marginTop: 10 }} disabled={pending || !brandId || monthlyNum <= 0} onClick={generate}>
          {pending ? "생성 중…" : needsApproval ? "견적서 생성 (파트장 결재 대상)" : "견적서 생성"}
        </button>
        <div className="note" style={{ marginTop: 6, fontSize: 11 }}>생성 후 <b>아래 목록의 발송 버튼</b>에서 내용을 확인하고 메일(문자 선택)로 보냅니다.</div>
      </div>
    </div>
  );
}
