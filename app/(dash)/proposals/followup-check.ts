// 제안서 팔로업 간이 크론 — proposals 페이지 로드 시 호출된다(.catch 무시).
//   sent 상태 & followup_due 경과 & 계약 미체결(서명 계약 없음 + 제안 미수락) 브랜드에
//   alerts(kind='proposal_stale', tier 1) 를 브랜드당 1건 upsert 한다(0001 UNIQUE(brand_id,kind)).
//   lib/agents.ts · app/api/cron/sla-check 는 건드리지 않는다.

import { query } from "@/lib/db";

export async function checkProposalFollowups(): Promise<number> {
  // 대상: 발송 후 followup_due(발송+3일) 가 지났고, 아직 수락되지 않았으며
  //       브랜드에 서명(signed) 계약이 없는 제안서.
  const rows = await query<{
    brand_id: string;
    brand_name: string;
    sent_at: string | null;
    followup_due: string;
  }>(
    `SELECT DISTINCT ON (p.brand_id)
            p.brand_id, b.brand_name, p.sent_at, p.followup_due
       FROM proposals p
       JOIN brands b ON b.id = p.brand_id
      WHERE p.status = 'sent'
        AND p.followup_due IS NOT NULL
        AND p.followup_due <= CURRENT_DATE
        AND NOT EXISTS (
              SELECT 1 FROM contracts c
               WHERE c.brand_id = p.brand_id
                 AND (c.status = 'signed' OR c.signed_at IS NOT NULL))
      ORDER BY p.brand_id, p.followup_due ASC
      LIMIT 100`,
  ).catch(() => []);

  let made = 0;
  for (const r of rows) {
    const sentLabel = r.sent_at
      ? new Date(r.sent_at).toLocaleDateString("ko-KR")
      : "발송일 미상";
    // 브랜드당 같은 kind 1건 — 재발생 시 message 갱신 + 미해결로 되살림(기존 upsert 패턴).
    await query(
      `INSERT INTO alerts (brand_id, kind, tier, message)
       VALUES ($1, 'proposal_stale', 1, $2)
       ON CONFLICT (brand_id, kind)
       DO UPDATE SET message = EXCLUDED.message, tier = 1,
                     resolved_at = NULL, created_at = now()`,
      [
        r.brand_id,
        `${r.brand_name} · 제안서 발송(${sentLabel}) 후 3일 경과 — 미계약, 팔로업 필요`,
      ],
    ).catch(() => {});
    made++;
  }
  return made;
}
