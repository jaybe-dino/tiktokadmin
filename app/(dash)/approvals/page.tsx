import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allApprovals } from "@/lib/repo/global";
import ApprovalActions from "./ApprovalActions";

export const dynamic = "force-dynamic";

const KIND: Record<string, { ko: string; bdg: string }> = {
  drop: { ko: "드랍", bdg: "st-dropped" },
  refund: { ko: "환불", bdg: "st-churned" },
  settlement: { ko: "정산 확정", bdg: "st-set" },
};

function kindOf(k: string) {
  return KIND[k] ?? { ko: k, bdg: "" };
}

function reasonOf(payload: Record<string, unknown>): string {
  const r = payload.reason ?? payload.note ?? payload.memo;
  if (r) return String(r);
  const s = Object.entries(payload)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  return s || "—";
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("ko-KR");
}

export default async function ApprovalsPage() {
  const rows = (await allApprovals().catch(() => [])) as Record<string, unknown>[];
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  return (
    <div>
      <ScreenHeader
        title="결재함"
        desc="드랍·후퇴·정산 확정·정책 변경은 결재선을 경유합니다 — 요청·승인·반려 모두 이력 보존"
      />

      <div className="card">
        <table className="t">
          <tbody>
            <tr>
              <th>유형</th>
              <th>대상</th>
              <th>요청자</th>
              <th>사유</th>
              <th>요청일</th>
              <th style={{ width: 170 }}>결재</th>
            </tr>
            {pending.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--ink3)", textAlign: "center", padding: "22px 0" }}>
                  대기 중인 결재 요청이 없습니다.
                </td>
              </tr>
            )}
            {pending.map((a) => {
              const payload = (a.payload as Record<string, unknown>) ?? {};
              const k = kindOf(a.kind as string);
              return (
                <tr key={a.id as string}>
                  <td>
                    <span className={`bdg ${k.bdg}`}>{k.ko}</span>
                  </td>
                  <td>
                    {a.brand_id ? (
                      <Link href={`/brand/${a.brand_id}`} className="hover:underline">
                        <b>{a.brand_name as string}</b>
                      </Link>
                    ) : (
                      <b>브랜드 무관</b>
                    )}
                  </td>
                  <td>{(a.requested_by as string) ?? "—"}</td>
                  <td>{reasonOf(payload)}</td>
                  <td>{fmtDate(a.created_at)}</td>
                  <td>
                    <ApprovalActions id={a.id as string} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="hd">
            <b>최근 처리</b>
          </div>
          <div className="bd" style={{ fontSize: 12 }}>
            {done.length === 0 && <div style={{ color: "var(--ink3)" }}>처리 이력이 없습니다.</div>}
            {done.map((a) => {
              const payload = (a.payload as Record<string, unknown>) ?? {};
              const k = kindOf(a.kind as string);
              const ok = a.status === "approved";
              return (
                <div className="row" key={a.id as string}>
                  <span className={`ico ${ok ? "i-grn" : "i-red"}`}>{ok ? "✓" : "✕"}</span>
                  <div>
                    <div className="tt">
                      {(a.brand_name as string) ?? "브랜드 무관"} · {k.ko} {ok ? "승인" : "반려"} ({fmtDate(a.created_at)})
                    </div>
                    <div className="ss">사유: {reasonOf(payload)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="hd">
            <b>결재 규칙</b>
          </div>
          <div className="bd" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            드랍·후퇴 → 파트장 · 정산 확정 → 파트장 · 해지/환불·SLA 정책 변경 → 대표. 승인 권한이 없는 담당이 시도하면
            자동으로 이 결재함에 요청이 생성됩니다(막히지 않고, 새지 않게).
          </div>
        </div>
      </div>
    </div>
  );
}
