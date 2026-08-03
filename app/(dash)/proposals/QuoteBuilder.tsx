"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { won } from "@/components/ScreenHeader";
import { computeQuote, type QuoteTerm } from "@/lib/quote";
import { createAndSendProposalAction } from "./actions";
import ProposalsAiButton from "./ProposalsAiButton";

interface BrandOpt {
  id: string;
  name: string;
}

// 트랙 선택 → plan(+온보딩 티어) 매핑. 원본 UI 옵션 유지.
const TRACKS: { label: string; plan: string; onboardingTier?: string }[] = [
  { label: "온보딩 5M", plan: "onboarding_onetime", onboardingTier: "5month" },
  { label: "온보딩 3M", plan: "onboarding_onetime", onboardingTier: "3month" },
  { label: "Live Focus 49만", plan: "live_focus_490k" },
  { label: "Guarantee 100만", plan: "guarantee_1m" },
];

// 국가 후보(입력 picker) — 견적은 국가 '수'로 계산됨.
const COUNTRY_OPTS = ["US", "JP", "VN", "TH", "ID", "PH", "MY", "SG", "TW"];

export default function QuoteBuilder({ brands }: { brands: BrandOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [brandId, setBrandId] = useState("");
  const [trackIdx, setTrackIdx] = useState(0);
  const [countries, setCountries] = useState<string[]>(["US"]);
  const [term, setTerm] = useState<QuoteTerm>("6month");
  const [discountPct, setDiscountPct] = useState(0);
  // 계약 조건(0020) — 계약서 드라이브 링크(수기) · 계약기간 · 매월 결제일
  const [contractFileUrl, setContractFileUrl] = useState("");
  const [contractTerm, setContractTerm] = useState("");
  const [billingDay, setBillingDay] = useState("");

  const track = TRACKS[trackIdx];
  const isOnboarding = track.plan === "onboarding_onetime";

  const lbl: React.CSSProperties = {
    display: "block",
    fontSize: 11.5,
    color: "var(--ink3)",
    margin: "10px 0 4px",
  };

  const quote = useMemo(() => {
    try {
      return computeQuote({
        plan: track.plan,
        countries: countries,
        term,
        onboardingTier: track.onboardingTier as
          | "3month"
          | "5month"
          | "12month"
          | undefined,
      });
    } catch {
      return null;
    }
  }, [track.plan, track.onboardingTier, countries, term]);

  function addCountry() {
    const next = COUNTRY_OPTS.find((c) => !countries.includes(c));
    if (next) setCountries((cs) => [...cs, next]);
  }
  function removeCountry(c: string) {
    setCountries((cs) => cs.filter((x) => x !== c));
  }

  function submit() {
    setMsg(null);
    start(async () => {
      const bd = billingDay.trim() === "" ? undefined : Number(billingDay);
      const r = await createAndSendProposalAction({
        brand_id: brandId,
        plan: track.plan,
        countries,
        term,
        onboardingTier: track.onboardingTier,
        send: true,
        discountPct,
        contractFileUrl: contractFileUrl.trim() || undefined,
        contractTerm: contractTerm.trim() || undefined,
        billingDay: bd,
      });
      if (r.ok && r.pendingApproval) {
        // 결재선: 20% 초과 할인은 발송 보류, 파트장 결재 대기.
        setMsg({ ok: true, text: "할인 20% 초과 — 파트장 결재 요청됨(결재함)" });
        router.refresh();
      } else if (r.ok) {
        // 생성→발송 준비: 메일은 초안함 승인 후 실제 발송된다.
        setMsg({
          ok: true,
          text: r.draftReady
            ? `제안서 생성 완료 — ${won(r.quote ?? 0)} · 발송 초안 생성됨 → 초안함에서 승인 후 발송됩니다.`
            : `제안서 생성 완료 — ${won(r.quote ?? 0)}${r.note ? ` · ${r.note}` : ""}`,
        });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error ?? "처리 실패" });
      }
    });
  }

  return (
    <div className="card" id="quote-builder">
      <div className="hd">
        <b>견적 빌더</b>
      </div>
      <div className="bd">
        <label style={lbl}>브랜드</label>
        <select
          className="f"
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
        >
          <option value="">브랜드 선택…</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <label style={lbl}>트랙</label>
        <select
          className="f"
          value={trackIdx}
          onChange={(e) => setTrackIdx(Number(e.target.value))}
        >
          {TRACKS.map((t, i) => (
            <option key={t.label} value={i}>
              {t.label}
            </option>
          ))}
        </select>

        <label style={lbl}>
          국가 {isOnboarding ? "(온보딩은 국가수 미반영)" : "(트랙료 × 국가수)"}
        </label>
        <div className="tagz">
          {countries.map((c) => (
            <span
              key={c}
              className="chip"
              onClick={() => removeCountry(c)}
              style={{ cursor: "pointer" }}
              title="클릭 시 제거"
            >
              {c} ✕
            </span>
          ))}
          <button
            type="button"
            className="btn sm"
            onClick={addCountry}
            disabled={countries.length >= COUNTRY_OPTS.length}
          >
            + 국가
          </button>
        </div>

        <label style={lbl}>약정</label>
        <select
          className="f"
          value={term}
          onChange={(e) => setTerm(e.target.value as QuoteTerm)}
        >
          <option value="6month">6개월 (20% 할인)</option>
          <option value="monthly">3개월</option>
        </select>

        <label style={lbl}>추가 할인 % (20% 초과 시 파트장 결재)</label>
        <input
          className="f"
          type="number"
          min={0}
          max={100}
          step={1}
          value={discountPct}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDiscountPct(
              Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0,
            );
          }}
        />

        <label style={lbl}>계약서 첨부 — 구글드라이브 링크(수기)</label>
        <input
          className="f"
          type="url"
          placeholder="https://drive.google.com/…"
          value={contractFileUrl}
          onChange={(e) => setContractFileUrl(e.target.value)}
        />

        <label style={lbl}>계약기간</label>
        <input
          className="f"
          type="text"
          placeholder="예: 12개월 · 2026-09 ~ 2027-08"
          value={contractTerm}
          onChange={(e) => setContractTerm(e.target.value)}
        />

        <label style={lbl}>매월 결제일 (1~31)</label>
        <input
          className="f"
          type="number"
          min={1}
          max={31}
          step={1}
          placeholder="예: 25"
          value={billingDay}
          onChange={(e) => setBillingDay(e.target.value)}
        />

        <hr className="hr" />

        <div className="kv">
          <dt>기본</dt>
          <dd>{quote ? won(quote.base) : "—"}</dd>
          <dt>다국가 할인</dt>
          <dd>{quote && quote.multiDiscount > 0 ? `-${won(quote.multiDiscount)}` : "—"}</dd>
          <dt>약정 할인</dt>
          <dd>{quote && quote.termDiscount > 0 ? `-${won(quote.termDiscount)}` : "—"}</dd>
          <dt>추가 할인</dt>
          <dd>
            {quote && discountPct > 0
              ? `-${won(Math.round(quote.total * (discountPct / 100)))} (${discountPct}%)`
              : "—"}
          </dd>
          <dt>
            <b>합계</b>
          </dt>
          <dd>
            <b style={{ fontSize: 15 }}>
              {quote
                ? `${won(Math.round(quote.total * (1 - discountPct / 100)))} + VAT`
                : "— + VAT"}
              {quote?.recurring ? " / 월" : ""}
            </b>
          </dd>
        </div>

        <div className="note" style={{ marginTop: 10 }}>
          견적 로직은 glovek computeQuote와 동일 — 수기 계산 금지
        </div>

        {msg && (
          <div
            className="note"
            style={{
              marginTop: 8,
              color: msg.ok ? "var(--ok)" : "var(--warn)",
              fontWeight: 700,
            }}
          >
            {msg.text}
          </div>
        )}

        <button
          className="btn pri"
          style={{ width: "100%", marginTop: 10 }}
          disabled={pending || !brandId}
          onClick={submit}
        >
          {pending ? "처리 중…" : "제안서 생성 → 발송"}
        </button>

        <ProposalsAiButton
          brandId={brandId}
          plan={track.plan}
          countries={countries}
          term={term}
        />
      </div>
    </div>
  );
}
