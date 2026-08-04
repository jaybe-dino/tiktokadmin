"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ProductsAiButton from "@/components/ProductsAiButton";

type Row = Record<string, unknown>;

const FLAG: Record<string, string> = {
  US: "🇺🇸", VN: "🇻🇳", TH: "🇹🇭", MY: "🇲🇾", SG: "🇸🇬", KR: "🇰🇷",
  JP: "🇯🇵", ID: "🇮🇩", PH: "🇵🇭", TW: "🇹🇼", CN: "🇨🇳",
};

function flag(c?: string) {
  if (!c) return "";
  return FLAG[c.toUpperCase()] ?? "";
}

// 제품 단위 인증 롤업 상태
function prodStatus(total: number, ready: number, risk: number) {
  if (total === 0) return { cls: "cc-no", label: "미착수" };
  if (risk > 0) return { cls: "cc-exp", label: `리스크 ${risk}` };
  if (ready >= total) return { cls: "cc-ok", label: "완료" };
  return { cls: "cc-ing", label: "진행" };
}

// 출처(products_master.source) — apply/glovek 유래는 원본 읽기전용, 어드민 보정값(원장) 우선.
const SOURCE_CHIP: Record<string, { label: string; title: string }> = {
  apply_step4: { label: "apply", title: "apply 스텝4 유래 — 원본 읽기전용, 어드민 보정값 우선" },
  glovek_onb: { label: "glovek", title: "glovek 온보딩 유래 — 원본 읽기전용, 어드민 보정값 우선" },
};

// 서류(자료) 단위 상태
function docChip(status?: string) {
  switch (status) {
    case "expired": return { cls: "cc-exp", label: "만료" };
    case "rejected": return { cls: "cc-warn", label: "반려" };
    case "none": return { cls: "cc-no", label: "미착수" };
    case "ready": return { cls: "cc-warn", label: "만료 임박" };
    case "pending": return { cls: "cc-ing", label: "검토 중" };
    default: return { cls: "cc-ing", label: status ?? "진행" };
  }
}

export default function ProductsView({ products, risks }: { products: Row[]; risks: Row[] }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all|cc-ok|cc-ing|cc-exp|cc-no
  const [country, setCountry] = useState("all");

  const term = q.trim().toLowerCase();

  // 빠른 선택 칩 (실제 브랜드명에서 추출)
  const brandChips = useMemo(
    () => [...new Set(products.map((p) => p.brand_name as string).filter(Boolean))].slice(0, 5),
    [products],
  );

  // 국가 옵션 (실제 리스크 데이터에서 추출)
  const countryOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of risks) s.add(((r.country as string) || "공통").toUpperCase());
    return [...s].sort();
  }, [risks]);

  // 제품 매트릭스 필터 (검색 + 상태)
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const hay = `${p.brand_name ?? ""} ${p.name_kr ?? ""}`.toLowerCase();
      if (term && !hay.includes(term)) return false;
      if (statusFilter !== "all") {
        const total = (p.cert_total as number) ?? 0;
        const ready = (p.cert_ready as number) ?? 0;
        const risk = (p.cert_risk as number) ?? 0;
        if (prodStatus(total, ready, risk).cls !== statusFilter) return false;
      }
      return true;
    });
  }, [products, term, statusFilter]);

  // 서류(자료) 리스크 필터 (검색 + 국가)
  const filteredRisks = useMemo(() => {
    return risks.filter((r) => {
      const hay = `${r.brand_name ?? ""} ${r.product ?? ""}`.toLowerCase();
      if (term && !hay.includes(term)) return false;
      if (country !== "all" && ((r.country as string) || "공통").toUpperCase() !== country) return false;
      return true;
    });
  }, [risks, term, country]);

  // 롤업 집계 (필터 반영)
  const totalCert = filteredProducts.reduce((s, p) => s + ((p.cert_total as number) ?? 0), 0);
  const readyCert = filteredProducts.reduce((s, p) => s + ((p.cert_ready as number) ?? 0), 0);
  const readyRate = totalCert ? Math.round((readyCert / totalCert) * 100) : 0;

  // 국가별 리스크 집계 (필터 반영)
  const byCountry = new Map<string, number>();
  for (const r of filteredRisks) {
    const c = ((r.country as string) || "공통").toUpperCase();
    byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
  }
  const countryRisks = [...byCountry.entries()].sort((a, b) => b[1] - a[1]);

  const toggleChip = (b: string) => setQ((cur) => (cur.trim().toLowerCase() === b.toLowerCase() ? "" : b));

  return (
    <div>
      <div className="ph">
        <div>
          <h1>제품·인증</h1>
          <p>제품 마스터는 apply와 자동 동기 · 인증 만료 30일 전 알림</p>
        </div>
        <div className="bar" style={{ margin: 0 }}>
          <input
            className="f"
            style={{ width: 210 }}
            placeholder="🔍 브랜드 검색 (계약된 업체)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">상태 전체</option>
            <option value="cc-ok">완료</option>
            <option value="cc-ing">진행</option>
            <option value="cc-exp">리스크</option>
            <option value="cc-no">미착수</option>
          </select>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">국가 전체</option>
            {countryOptions.map((c) => (
              <option key={c} value={c}>{flag(c)} {c}</option>
            ))}
          </select>
        </div>
      </div>

      {brandChips.length > 0 && (
        <div className="bar" style={{ marginTop: -6 }}>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>빠른 선택:</span>
          {brandChips.map((b) => {
            const active = q.trim().toLowerCase() === b.toLowerCase();
            return (
              <button
                key={b}
                type="button"
                className="chip"
                aria-pressed={active}
                onClick={() => toggleChip(b)}
                style={{
                  cursor: "pointer",
                  ...(active ? { background: "var(--accent, #2563eb)", color: "#fff", borderColor: "transparent" } : {}),
                }}
              >
                {b}
              </button>
            );
          })}
        </div>
      )}

      {/* 인증 필요서류 AI 가이드 — 제품·국가 선택 맥락으로 체크리스트 초안 생성 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="hd">
          <b>인증 필요서류 AI 가이드</b>
          <div className="rt"><span style={{ color: "var(--ink3)", fontSize: 11 }}>제품·국가 선택 → 필요 인증·서류 체크리스트 초안</span></div>
        </div>
        <div className="bd">
          <ProductsAiButton products={products} countries={countryOptions} />
        </div>
      </div>

      <div className="grid g31 gap-3.5">
        {/* 좌: 인증 현황 매트릭스 (제품 롤업) */}
        <div className="card">
          <div className="hd"><b>인증 현황 (제품 롤업)</b></div>
          <table className="t matrix">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>브랜드 · 제품</th>
                <th>카테고리</th>
                <th>인증 완료율</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "left", color: "var(--ink3)" }}>조건에 맞는 제품이 없습니다.</td></tr>
              )}
              {filteredProducts.map((p) => {
                const total = (p.cert_total as number) ?? 0;
                const ready = (p.cert_ready as number) ?? 0;
                const risk = (p.cert_risk as number) ?? 0;
                const pct = total ? Math.round((ready / total) * 100) : 0;
                const st = prodStatus(total, ready, risk);
                return (
                  <tr key={p.id as string}>
                    <td style={{ textAlign: "left" }}>
                      {/* 브랜드 클릭 → 브랜드360 제품·인증·재고 탭 딥링크(#tab=pd) */}
                      <Link href={`/brand/${p.brand_id}#tab=pd`} className="hover:underline" title="브랜드360 제품 탭으로 이동"><b>{p.brand_name as string}</b></Link>{" "}
                      {p.name_kr as string}
                      {SOURCE_CHIP[p.source as string] && (
                        <span className="cellchip cc-warn" style={{ marginLeft: 6 }} title={SOURCE_CHIP[p.source as string].title}>
                          {SOURCE_CHIP[p.source as string].label}
                        </span>
                      )}
                    </td>
                    <td>{(p.category as string) || "—"}</td>
                    <td>
                      <div className="flex items-center gap-2 justify-center">
                        <div className="pr"><i className={pct >= 100 ? "g" : pct >= 50 ? "" : "w"} style={{ width: `${pct}%` }} /></div>
                        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{ready}/{total}</span>
                      </div>
                    </td>
                    <td><span className={`cellchip ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px" }} className="note">
            국가×제품 매트릭스의 상태는 서류들의 롤업(전부 유효 → 완료) · 만료 30일 전 자료 단위로 알림
          </div>
        </div>

        {/* 우: 리스크 요약 · 국가별 리스크 */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd"><b>인증 요약</b></div>
            <div className="bd" style={{ fontSize: 12 }}>
              <div className="row">
                <span className="ico i-blu">📦</span>
                <div><div className="tt">제품 {filteredProducts.length}종</div><div className="ss">계약 브랜드 제품 마스터</div></div>
              </div>
              <div className="row">
                <span className="ico i-grn">✅</span>
                <div><div className="tt">인증 완료율 {readyRate}%</div><div className="ss">유효 {readyCert} / 전체 {totalCert}</div></div>
              </div>
              <div className="row">
                <span className={`ico ${filteredRisks.length ? "i-red" : "i-grn"}`}>{filteredRisks.length ? "⚠️" : "🟢"}</span>
                <div><div className="tt">인증 리스크 {filteredRisks.length}건</div><div className="ss">만료·미비·반려 포함</div></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd"><b>국가별 리스크</b>{filteredRisks.length > 0 && <span className="chip red">{filteredRisks.length}</span>}</div>
            <div className="bd" style={{ fontSize: 12 }}>
              {countryRisks.length === 0 && <div className="note">인증 리스크가 없습니다.</div>}
              {countryRisks.map(([c, n]) => (
                <button
                  type="button"
                  className="row"
                  key={c}
                  onClick={() => setCountry((cur) => (cur === c ? "all" : c))}
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", color: "inherit" }}
                >
                  <span className="ico i-amb">{flag(c) || "🌐"}</span>
                  <div><div className="tt">{flag(c)} {c}</div><div className="ss">리스크 {n}건{country === c ? " · 필터 적용됨" : ""}</div></div>
                  <div className="rt"><span className="cellchip cc-exp">{n}</span></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 하단: 제품별 인증 서류 — 자료 단위 관리 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd">
          <b>제품별 인증 서류 — 자료 단위 관리</b>
          <div className="rt"><span style={{ color: "var(--ink3)", fontSize: 11 }}>만료·미비 자료 {filteredRisks.length}건</span></div>
        </div>
        <table className="t">
          <thead>
            <tr><th>자료</th><th>브랜드 · 제품</th><th>국가</th><th>상태</th><th>만료</th></tr>
          </thead>
          <tbody>
            {filteredRisks.length === 0 && (
              <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>관리가 필요한 인증 서류가 없습니다.</td></tr>
            )}
            {filteredRisks.map((r) => {
              const d = docChip(r.status as string);
              return (
                <tr key={r.id as string}>
                  <td><b>{(r.cert_type as string) || "—"}</b></td>
                  <td>
                    {r.brand_id ? (
                      <Link href={`/brand/${r.brand_id}#tab=pd`} className="hover:underline" title="브랜드360 제품 탭으로 이동">{r.brand_name as string}</Link>
                    ) : (
                      r.brand_name as string
                    )}{" "}
                    · {r.product as string}
                  </td>
                  <td>{flag(r.country as string)} {(r.country as string) || "공통"}</td>
                  <td><span className={`cellchip ${d.cls}`}>{d.label}</span></td>
                  <td style={{ color: "var(--ink3)" }}>{(r.expires_at as string) ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px" }} className="note">
          상태는 서류(자료) 단위로 관리 · 만료 30일 전 자료 단위로 알림 · 파일은 자산 저장소 참조(민감서류는 링크만)
        </div>
      </div>
    </div>
  );
}
