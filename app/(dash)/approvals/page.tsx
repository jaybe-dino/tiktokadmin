import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allApprovals } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { drop: "드랍 승인", refund: "환불 승인", settlement: "정산 승인" };
const ST: Record<string, { ko: string; c: string }> = {
  pending: { ko: "대기", c: "chip-amb" }, approved: { ko: "승인", c: "chip-grn" }, rejected: { ko: "반려", c: "chip-red" },
};

export default async function ApprovalsPage() {
  const rows = (await allApprovals().catch(() => [])) as Record<string, unknown>[];
  const pending = rows.filter((r) => r.status === "pending").length;
  return (
    <div className="max-w-3xl">
      <ScreenHeader title="결재함" desc={`대기 ${pending}건 · 드랍·환불·정산 승인 (12 결재선)`} />
      <div className="space-y-2">
        {rows.length === 0 && <div className="card p-6 text-sm" style={{ color: "var(--ink3)" }}>결재 요청이 없습니다.</div>}
        {rows.map((a) => {
          const payload = (a.payload as Record<string, unknown>) ?? {};
          return (
            <div key={a.id as string} className="card p-4 flex items-center gap-3 flex-wrap">
              <span className="pill chip">{KIND[a.kind as string] ?? (a.kind as string)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">
                  {a.brand_id ? <Link href={`/brand/${a.brand_id}`} className="hover:underline">{a.brand_name as string}</Link> : "브랜드 무관"}
                </div>
                <div className="text-[12px]" style={{ color: "var(--ink3)" }}>
                  {Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"} · 요청 {a.requested_by as string}
                </div>
              </div>
              <span className={`pill ${ST[a.status as string]?.c ?? ""}`}>{ST[a.status as string]?.ko ?? (a.status as string)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
