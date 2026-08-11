import ScreenHeader from "@/components/ScreenHeader";
import MktScreen, { type MktProposalRow, type MktRow } from "@/components/MktScreen";
import { allMktProjects } from "@/lib/repo/global";
import { query } from "@/lib/db";

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
    proposal_id: r.proposal_id == null ? null : String(r.proposal_id),
    prop_title: r.prop_title == null ? null : String(r.prop_title),
    prop_amount: r.prop_amount == null ? null : Number(r.prop_amount),
    prop_status: r.prop_status == null ? null : String(r.prop_status),
    prop_url: r.prop_url == null ? null : String(r.prop_url),
  }));

  // 마케팅 제안서 (proposals kind='marketing') + 초안함 발송 연결(email_drafts.proposal_id).
  // 0018 마이그레이션 전 DB 방어: 실패 시 빈 목록.
  const proposalsRaw = (await query(
    `SELECT p.id, p.title, p.amount, p.status, p.note, p.url,
            p.period_start::text AS period_start, p.period_end::text AS period_end,
            p.sent_at::text AS sent_at, p.created_at::text AS created_at,
            b.brand_name, b.id AS brand_id,
            d.status AS draft_status, d.sent_at::text AS draft_sent_at,
            mp.id AS project_id, mp.proposal_status AS project_status
       FROM proposals p
       JOIN brands b ON b.id = p.brand_id
       LEFT JOIN LATERAL (
         SELECT status, sent_at FROM email_drafts
          WHERE proposal_id = p.id ORDER BY created_at DESC LIMIT 1
       ) d ON true
       LEFT JOIN LATERAL (
         SELECT id, proposal_status FROM mkt_projects
          WHERE proposal_id = p.id ORDER BY created_at LIMIT 1
       ) mp ON true
      WHERE p.kind = 'marketing'
      ORDER BY p.created_at DESC LIMIT 200`,
  ).catch(() => [])) as Record<string, unknown>[];

  // 신규 필드(제안 예정일·최종일정·RFP·AI방향) — 마이그레이션 0064 미적용 시 빈 맵(안전).
  const metaRaw = (await query(
    `SELECT id, propose_date::text AS propose_date, final_due_date::text AS final_due_date,
            rfp_text, rfp_file_url, ai_direction
       FROM proposals WHERE kind='marketing'`,
  ).catch(() => [])) as Record<string, unknown>[];
  const metaById = new Map(metaRaw.map((m) => [String(m.id), m]));

  const proposals: MktProposalRow[] = proposalsRaw.map((p) => {
    const meta = metaById.get(String(p.id)) ?? {};
    return {
      id: String(p.id),
      title: p.title == null ? "" : String(p.title),
      amount: p.amount == null ? null : Number(p.amount),
      status: String(p.status ?? "draft"),
      note: p.note == null ? null : String(p.note),
      url: p.url == null ? null : String(p.url),
      period_start: p.period_start == null ? null : String(p.period_start),
      period_end: p.period_end == null ? null : String(p.period_end),
      sent_at: p.sent_at == null ? null : String(p.sent_at),
      created_at: String(p.created_at ?? ""),
      brand_name: String(p.brand_name ?? ""),
      brand_id: String(p.brand_id ?? ""),
      draft_status: p.draft_status == null ? null : String(p.draft_status),
      draft_sent_at: p.draft_sent_at == null ? null : String(p.draft_sent_at),
      project_id: p.project_id == null ? null : String(p.project_id),
      project_status: p.project_status == null ? null : String(p.project_status),
      propose_date: meta.propose_date == null ? null : String(meta.propose_date),
      final_due_date: meta.final_due_date == null ? null : String(meta.final_due_date),
      rfp_text: meta.rfp_text == null ? null : String(meta.rfp_text),
      rfp_file_url: meta.rfp_file_url == null ? null : String(meta.rfp_file_url),
      ai_direction: meta.ai_direction == null ? null : String(meta.ai_direction),
    };
  });

  // 작성 폼 브랜드 선택 — 원장 전체(트랙 표시용 contract_type 포함).
  const brandsRaw = (await query(
    "SELECT id, brand_name, contract_type FROM brands ORDER BY brand_name LIMIT 1000",
  ).catch(() => [])) as { id: string; brand_name: string; contract_type: string | null }[];
  const brands = brandsRaw.map((b) => ({
    id: b.id,
    name: b.brand_name,
    contract_type: b.contract_type,
  }));

  return (
    <div>
      <ScreenHeader
        title="마케팅 파이프라인"
        desc="2가지 트랙 — ① 개별 프로젝트(RFP→제안→수주) 파이프라인 · ② 루틴 운영대행(회차 캠페인 반복·지속관리) + 마케팅 제안서(작성→초안함 승인 발송)"
      />
      <MktScreen rows={rows} proposals={proposals} brands={brands} />
    </div>
  );
}
