import Link from "next/link";
import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";
import { STATE_LABELS, type State } from "@/lib/types";
import UploadDocButton from "./UploadDocButton";

export const dynamic = "force-dynamic";

const TRACK_KO: Record<string, string> = { onboarding: "온보딩", mall: "멀티몰" };

// 포털 온보딩 (v3.1 s-portal) — 파트너 포털 메인 카드:
//   그라데이션 헤더 + 📂 제출 서류 현황(업로드 배선) + 안내 note + 정산 리포트·문의하기 카드.
//   brand_id 격리(pq) · 데모 수치 없음(실데이터).
export default async function PortalOnboarding() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const brand = (await pq<{ brand_name: string; state: string; contract_type: string | null; manager: string | null }>(
    s.brand_id,
    `SELECT b.brand_name, b.state, b.contract_type, au.name AS manager
       FROM brands b
       LEFT JOIN admin_users au ON au.id = COALESCE(b.owner_onboard, b.owner_sales, b.owner_intake)
      WHERE b.id=$1 AND EXISTS (SELECT 1 FROM portal_sessions ps WHERE ps.brand_id=$1)`,
  ).catch(() => []))[0];

  const docs = await pq<{ item_key: string; label: string; done: boolean }>(
    s.brand_id,
    "SELECT item_key, label, done FROM doc_items WHERE brand_id=$1 ORDER BY done DESC, label ASC",
  ).catch(() => []);

  // 포털에서 업로드 접수된 항목(assets 색인) → '검토중' 표시.
  const submittedRefs = await pq<{ source_ref: string }>(
    s.brand_id,
    "SELECT DISTINCT source_ref FROM assets WHERE brand_id=$1 AND kind='doc' AND source_ref LIKE 'doc_item:%'",
  ).catch(() => []);
  const submitted = new Set(submittedRefs.map((r) => String(r.source_ref).replace(/^doc_item:/, "")));

  const settle = (await pq<{ n: number; latest: string | null }>(
    s.brand_id,
    "SELECT count(*)::int AS n, max(month)::text AS latest FROM settlements WHERE brand_id=$1",
  ).catch(() => []))[0];

  const faq = (await pq<{ n: number }>(
    s.brand_id,
    "SELECT count(*)::int AS n FROM qna_entries WHERE approved AND EXISTS (SELECT 1 FROM portal_sessions WHERE brand_id=$1)",
  ).catch(() => []))[0];

  const total = docs.length;
  const done = docs.filter((d) => d.done).length;
  const pendingDocs = docs.filter((d) => !d.done);
  const stageLabel = STATE_LABELS[brand?.state as State] ?? brand?.state ?? "";

  const subtitle = [
    brand?.contract_type ? (TRACK_KO[brand.contract_type] ?? brand.contract_type) : null,
    brand?.manager ? `담당 ${brand.manager} 매니저` : null,
    stageLabel ? `진행 단계: ${stageLabel}${total > 0 ? ` (${done}/${total})` : ""}` : null,
  ].filter(Boolean).join(" · ");

  const settleCount = Number(settle?.n ?? 0);
  const faqCount = Number(faq?.n ?? 0);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 30px rgba(15,36,64,.12)" }}>
      <div style={{ background: "linear-gradient(135deg,#0f2440,#1e3a5f)", color: "#fff", padding: "20px 24px" }}>
        <div style={{ fontSize: 11, color: "#93c5fd", fontWeight: 700, letterSpacing: ".1em" }}>GLOVEK PARTNER PORTAL</div>
        <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4 }}>{brand?.brand_name ?? "파트너"} 님, 안녕하세요 👋</div>
        {subtitle && <div style={{ fontSize: 12, color: "#bfdbfe", marginTop: 2 }}>{subtitle}</div>}
      </div>

      <div style={{ padding: "20px 24px", background: "#fff" }}>
        <b style={{ fontSize: 13.5 }}>📂 제출 서류 현황</b>

        {total === 0 ? (
          <p style={{ color: "var(--ink3)", fontSize: 13, marginTop: 8 }}>
            아직 제출할 서류가 없습니다. 계약 완료 후 서류 체크리스트가 생성됩니다.
          </p>
        ) : (
          <table className="t" style={{ marginTop: 8 }}>
            <tbody>
              {docs.map((d) => (
                <tr key={d.item_key}>
                  <td>{d.done ? d.label : <b>{d.label}</b>}</td>
                  <td>
                    {d.done ? (
                      <span className="cellchip cc-ok">승인 ✓</span>
                    ) : (
                      <>
                        {submitted.has(d.item_key)
                          ? <span className="cellchip cc-ing">검토중</span>
                          : <span className="cellchip cc-warn">제출 필요</span>}{" "}
                        <UploadDocButton itemKey={d.item_key} submitted={submitted.has(d.item_key)} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > 0 && (
          <div className="note" style={{ margin: "12px 0" }}>
            {pendingDocs.length === 0
              ? "✅ 모든 서류가 승인되었습니다. 입점 셋업이 진행 중입니다."
              : pendingDocs.length === 1
                ? `ℹ️ ${pendingDocs[0].label}만 제출하시면 입점 셋업이 시작됩니다 (예상 소요 2주)`
                : `ℹ️ 남은 서류 ${pendingDocs.length}건을 제출하시면 입점 셋업이 시작됩니다 (예상 소요 2주)`}
          </div>
        )}

        <div className="grid g2" style={{ gap: 12, marginTop: total === 0 ? 12 : 0 }}>
          <Link href="/portal/settlement" className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="bd">
              <b style={{ fontSize: 12.5 }}>💰 정산 리포트</b>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>
                {settleCount > 0
                  ? `게시된 리포트 ${settleCount}건 · 최근 ${String(settle?.latest ?? "").slice(0, 7)}`
                  : "운영 시작 후 매월 이곳에 게시됩니다"}
              </div>
            </div>
          </Link>
          <Link href="/portal/inquiry" className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="bd">
              <b style={{ fontSize: 12.5 }}>💬 문의하기</b>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>
                담당 매니저에게 메시지{faqCount > 0 ? ` · FAQ ${faqCount}건` : ""}
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
