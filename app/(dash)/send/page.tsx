import ScreenHeader from "@/components/ScreenHeader";
import SendCenter from "@/components/SendCenter";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SendPage() {
  const [sends, leadGroups, brandRows] = await Promise.all([
    query(
      `SELECT id, title, target_kind, channel, status, total, sent, body_md, created_at
         FROM bulk_sends
        ORDER BY created_at DESC NULLS LAST
        LIMIT 100`,
    ).catch(() => []) as Promise<Record<string, unknown>[]>,
    query(
      `SELECT lead_group AS name, COUNT(*)::int AS n, MAX(created_at) AS created
         FROM brands
        WHERE lead_group IS NOT NULL AND lead_group <> ''
        GROUP BY lead_group
        ORDER BY MAX(created_at) DESC
        LIMIT 20`,
    ).catch(() => []) as Promise<Record<string, unknown>[]>,
    query(
      `SELECT id, brand_name, contact_name, email
         FROM brands
        WHERE email IS NOT NULL AND email <> ''
        ORDER BY brand_name
        LIMIT 500`,
    ).catch(() => []) as Promise<Record<string, unknown>[]>,
  ]);

  const groups = leadGroups.map((g) => ({
    name: String(g.name ?? ""),
    n: Number(g.n ?? 0),
    created: String(g.created ?? ""),
  }));

  const brands = brandRows.map((b) => ({
    id: String(b.id ?? ""),
    name: String(b.brand_name ?? ""),
    contact: String(b.contact_name ?? ""),
    email: String(b.email ?? ""),
  }));

  return (
    <div>
      <ScreenHeader
        title="발송 센터 — 메일·문자"
        desc="모든 발송은 회사 이메일·지정 번호로만 나가고, 결과는 각 고객카드 히스토리에 자동 연동됩니다"
        right={<span className="chip">발신: @dinostudio.kr · 1533-06xx</span>}
      />
      <SendCenter sends={sends} leadGroups={groups} brands={brands} />
    </div>
  );
}
