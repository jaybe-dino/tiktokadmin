import ScreenHeader from "@/components/ScreenHeader";
import MktScreen, { type MktRow } from "@/components/MktScreen";
import { allMktProjects } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

export default async function MktPage() {
  const raw = (await allMktProjects().catch(() => [])) as Record<string, unknown>[];
  const rows: MktRow[] = raw.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    kind: String(r.kind ?? "project"),
    proposal_status: String(r.proposal_status ?? "draft"),
    note: r.note == null ? null : String(r.note),
    brand_name: String(r.brand_name ?? ""),
    brand_id: String(r.brand_id ?? ""),
  }));

  return (
    <div>
      <ScreenHeader
        title="마케팅 프로젝트"
        desc="2가지 트랙 — ① 개별 프로젝트(RFP→제안→수주) 파이프라인 · ② 루틴 운영대행(회차 캠페인 반복·지속관리)"
      />
      <MktScreen rows={rows} />
    </div>
  );
}
