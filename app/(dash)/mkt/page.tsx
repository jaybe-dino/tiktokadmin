import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allMktProjects } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const PS: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "chip-amb" }, sent: { ko: "발송", c: "chip" }, negotiating: { ko: "협의중", c: "chip-amb" },
  won: { ko: "수주", c: "chip-grn" }, dropped: { ko: "드랍", c: "chip-red" },
};
const COLS = [
  { key: "draft", label: "작성중" }, { key: "sent", label: "발송·협의" },
  { key: "negotiating", label: "협의중" }, { key: "won", label: "수주" },
];

export default async function MktPage() {
  const rows = (await allMktProjects().catch(() => [])) as Record<string, unknown>[];
  const byStatus = (s: string) => rows.filter((r) => r.proposal_status === s || (s === "sent" && r.proposal_status === "sent"));
  return (
    <div>
      <ScreenHeader title="마케팅 프로젝트" desc={`총 ${rows.length}건 · RFP→제안→수주 파이프라인`} />
      <div className="kb">
        {COLS.map((col) => {
          const list = rows.filter((r) => r.proposal_status === col.key);
          return (
            <div key={col.key} className="kcol">
              <h4 className="flex items-center gap-1.5 text-[12px] mx-1 mt-0.5 mb-2.5" style={{ color: "var(--ink2)" }}>
                {col.label}<span className="ml-auto bg-white rounded-lg px-1.5 text-[11px]" style={{ color: "var(--ink3)" }}>{list.length}</span>
              </h4>
              {list.map((m) => (
                <div key={m.id as string} className="kcard">
                  <div className="font-bold text-[12.5px]">{m.title as string}</div>
                  <Link href={`/brand/${m.brand_id}`} className="text-[11px] hover:underline" style={{ color: "var(--ink3)" }}>{m.brand_name as string}</Link>
                  <div className="mt-1.5"><span className={`pill ${PS[m.proposal_status as string]?.c ?? ""}`}>{PS[m.proposal_status as string]?.ko ?? (m.proposal_status as string)}</span></div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
