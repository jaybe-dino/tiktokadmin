import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { listCustomers } from "@/lib/onboarding";
import { query } from "@/lib/db";
import IssueForm from "./IssueForm";
import CustomerRow from "./CustomerRow";

export const dynamic = "force-dynamic";

// 관리자 온보딩 신청서 — 고객 계정 발급 + 신청서 검토/승인.
export default async function OnboardingPage() {
  const user = (await currentUser())!;
  const [customers, brands] = await Promise.all([
    listCustomers(),
    query<{ id: string; brand_name: string }>("SELECT id, brand_name FROM brands WHERE state NOT IN ('dropped','churned') ORDER BY brand_name").catch(() => []),
  ]);

  const submitted = customers.filter((c) => c.app_status === "submitted").length;
  const approved = customers.filter((c) => c.app_status === "approved").length;

  return (
    <div style={{ background: "#fff", margin: "-20px -22px -64px", padding: "20px 22px 64px", minHeight: "calc(100vh - 52px)" }}>
    <div className="max-w-5xl">
      <ScreenHeader
        title="온보딩 신청서 (고객 작성)"
        desc={`고객 ${customers.length} · 검토대기 ${submitted} · 승인완료 ${approved}`}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="tile"><div className="tile-k">발급 고객</div><div className="tile-v">{customers.length}</div></div>
        <div className="tile"><div className="tile-k">검토 대기</div><div className="tile-v">{submitted}</div></div>
        <div className="tile"><div className="tile-k">승인 완료</div><div className="tile-v">{approved}</div></div>
      </div>

      <IssueForm brands={brands} />

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>발급된 고객 계정</div>
        {customers.length === 0 ? (
          <div style={{ padding: 24, color: "var(--ink2)", fontSize: 14 }}>아직 발급된 고객이 없습니다. 위에서 이메일로 발급하세요.</div>
        ) : (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink2)", fontSize: 12 }}>
                <th style={th}>이메일</th><th style={th}>연결 브랜드</th><th style={th}>입점 국가</th><th style={th}>신청서 상태</th>
                <th style={th}>제출 단계</th><th style={th}>최근 로그인</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <CustomerRow key={c.id} c={c} brands={brands} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 14, padding: 16 }}>
        <b>동작 방식</b>
        <ol style={{ margin: "8px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "var(--ink2)" }}>
          <li><b>고객 발급</b> → 이메일 + 8자리 코드가 생성됩니다. 코드는 <b>이 순간 한 번만</b> 표시되니 고객에게 안전하게 전달하세요.</li>
          <li>고객은 <code>/apply</code> 에서 이메일+코드로 로그인 → <b>5단계 KYC</b>(기본신청·수권서서명·회사추가정보·제품등록·물류계약서)를 작성·제출.</li>
          <li>각 단계는 <b>제출 → 검토(승인/반려)</b>. 승인 시 다음 단계가 열립니다. 반려 시 피드백과 함께 재작성.</li>
          <li><b>전체 승인 & 매핑</b> → 회사정보·대표자서류는 <code>brand_company</code>, 제품은 <code>products_master</code>, 입점국가·물류는 <code>logistics_contracts</code> 로 자동 반영됩니다(연결 브랜드 필요).</li>
        </ol>
      </div>
    </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "9px 14px", borderBottom: "1px solid var(--line)", fontWeight: 600 };
