"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { won } from "@/components/ScreenHeader";
import { computeQuote, type QuoteTerm } from "@/lib/quote";
import { createAndSendProposalAction } from "./actions";

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
      const r = await createAndSendProposalAction({
        brand_id: brandId,
        plan: track.plan,
        countries,
        term,
        onboardingTier: track.onboardingTier,
        send: true,
      });
      if (r.ok) {
        setMsg({ ok: true, text: `발송 완료 — ${won(r.quote ?? 0)}` });
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

        <hr className="hr" />

        <div className="kv">
          <dt>기본</dt>
          <dd>{quote ? won(quote.base) : "—"}</dd>
          <dt>다국가 할인</dt>
          <dd>{quote && quote.multiDiscount > 0 ? `-${won(quote.multiDiscount)}` : "—"}</dd>
          <dt>약정 할인</dt>
          <dd>{quote && quote.termDiscount > 0 ? `-${won(quote.termDiscount)}` : "—"}</dd>
          <dt>
            <b>합계</b>
          </dt>
          <dd>
            <b style={{ fontSize: 15 }}>
              {quote ? `${won(quote.total)} + VAT` : "— + VAT"}
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
      </div>
    </div>
  );
}
