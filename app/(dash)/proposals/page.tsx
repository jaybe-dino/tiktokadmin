import Link from "next/link";
import { won } from "@/components/ScreenHeader";
import { allProposals } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "초안", c: "cc-warn" },
  sent: { ko: "발송됨", c: "cc-ing" },
  accepted: { ko: "수락 → 계약검토", c: "cc-ok" },
  rejected: { ko: "거절", c: "cc-exp" },
  superseded: { ko: "대체됨", c: "cc-no" },
};

function fmtDate(v: unknown): string {
  return v ? new Date(v as string).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "—";
}

export default async function ProposalsPage() {
  const rows = (await allProposals().catch(() => [])) as Record<string, unknown>[];
  const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, color: "var(--ink3)", margin: "10px 0 4px" };

  return (
    <div>
      <div className="ph">
        <div>
          <h1>제안서</h1>
          <p>진단·설문·견적 로직을 조합해 생성 — 발송 기록이 계약검토 게이트 조건입니다.</p>
        </div>
        <button className="btn pri">+ 새 제안서</button>
      </div>

      <div className="grid g31">
        {/* 좌: 제안서 목록 */}
        <div className="card overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>브랜드</th>
                <th>플랜 구성</th>
                <th>견적</th>
                <th>상태</th>
                <th>발송</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--ink3)" }}>제안서가 없습니다.</td>
                </tr>
              )}
              {rows.map((p) => {
                const st = ST[p.status as string] ?? { ko: (p.status as string) ?? "—", c: "cc-no" };
                const status = p.status as string;
                const plan = (p.plan as string) ?? "—";
                const term = (p.term as string) ?? "";
                const countries = ((p.countries as string[]) ?? []).join("·");
                const planLine = [plan, countries].filter(Boolean).join(" · ");
                return (
                  <tr key={p.id as string}>
                    <td>
                      <Link href={`/brand/${p.brand_id}`} className="hover:underline"><b>{p.brand_name as string}</b></Link>
                      {p.grade ? <span className={`gr ${p.grade as string}`} style={{ marginLeft: 6 }}>{p.grade as string}</span> : null}
                    </td>
                    <td>
                      {planLine}
                      {term ? <span className="sub">{term}</span> : null}
                    </td>
                    <td className="font-semibold">{status === "draft" ? "작성 중" : won(p.amount as number)}</td>
                    <td><span className={`cellchip ${st.c}`}>{st.ko}</span></td>
                    <td style={{ color: "var(--ink3)" }}>{fmtDate(p.sent_at)}</td>
                    <td>
                      {status === "draft" ? (
                        <Link href={`/brand/${p.brand_id}`} className="btn sm pri">이어서 작성</Link>
                      ) : status === "accepted" ? (
                        <Link href="/contracts" className="btn sm">계약으로 →</Link>
                      ) : (
                        <Link href={`/brand/${p.brand_id}`} className="btn sm">보기</Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 우: 견적 빌더 */}
        <div className="card">
          <div className="hd"><b>견적 빌더</b></div>
          <div className="bd">
            <label style={lbl}>트랙</label>
            <select className="f" defaultValue="">
              <option value="">온보딩 5M</option>
              <option>온보딩 3M</option>
              <option>Live Focus 49만</option>
              <option>Guarantee 100만</option>
            </select>

            <label style={lbl}>국가 (트랙료 × 국가수)</label>
            <div className="tagz">
              <span className="chip">🇺🇸 US</span>
              <button className="btn sm">+ 국가</button>
            </div>

            <label style={lbl}>약정</label>
            <select className="f" defaultValue="">
              <option value="">6개월 (20% 할인)</option>
              <option>3개월</option>
            </select>

            <hr className="hr" />

            <div className="kv">
              <dt>기본</dt><dd>—</dd>
              <dt>다국가 할인</dt><dd>—</dd>
              <dt>약정 할인</dt><dd>—</dd>
              <dt><b>합계</b></dt><dd><b style={{ fontSize: 15 }}>— + VAT</b></dd>
            </div>

            <div className="note" style={{ marginTop: 10 }}>견적 로직은 glovek computeQuote와 동일 — 수기 계산 금지</div>
            <button className="btn pri" style={{ width: "100%", marginTop: 10 }}>제안서 생성 → 발송</button>
          </div>
        </div>
      </div>
    </div>
  );
}
