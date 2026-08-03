import ScreenHeader from "@/components/ScreenHeader";
import AssetsIndexTabs, { type AssetRow } from "@/components/AssetsIndexTabs";
import AssetsHeaderActions from "@/components/AssetsHeaderActions";
import { allAssets } from "@/lib/repo/global";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  proposal: "제안서", contract: "계약서", cert: "인증 서류", doc: "서류", report: "리포트",
  meeting_rec: "회의녹음", brand_intro: "브랜드 자산", etc: "기타",
};

// kind → 연결된 카드(브랜드 360 내 카드 명칭)
const CARD: Record<string, string> = {
  proposal: "제안서", contract: "계약·결제", cert: "제품·인증", doc: "서류·물류",
  report: "정산·리포트", meeting_rec: "미팅", brand_intro: "회사정보",
};

export default async function AssetsPage() {
  const raw = (await allAssets().catch(() => [])) as Record<string, unknown>[];

  // 담당(업로더) 이름 — uploaded_by('admin:<email>') → admin_users.name
  const uploaders = (await query(
    `SELECT a.id, COALESCE(u.name, NULLIF(regexp_replace(a.uploaded_by,'^admin:',''),'')) AS uploader
       FROM assets a
       LEFT JOIN admin_users u ON u.id = regexp_replace(a.uploaded_by,'^admin:','')
      ORDER BY a.created_at DESC LIMIT 200`,
  ).catch(() => [])) as { id: string; uploader: string | null }[];
  const uploaderById = new Map(uploaders.map((r) => [r.id, r.uploader]));

  // 버전 — 같은 브랜드·같은 파일명 재업로드 시 자동 증가(오래된 순으로 v1, v2 …)
  const asc = [...raw].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const seen = new Map<string, number>();
  const verById = new Map<string, number>();
  const totalByKey = new Map<string, number>();
  for (const a of asc) {
    const key = `${a.brand_id ?? ""}|${String(a.filename ?? "").toLowerCase()}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    verById.set(a.id as string, n);
    totalByKey.set(key, n);
  }

  const rows: AssetRow[] = raw.map((a) => {
    const key = `${a.brand_id ?? ""}|${String(a.filename ?? "").toLowerCase()}`;
    const filename = (a.filename as string) ?? "";
    // 재업로드 이력이 있으면 자동 버전, 없으면 파일명에 명시된 vN 표기 사용
    const auto = (totalByKey.get(key) ?? 1) > 1 ? verById.get(a.id as string) ?? null : null;
    const m = /(?:^|[_\-\s.([])v(\d+)/i.exec(filename);
    return {
      id: a.id as string,
      kind: (a.kind as string) ?? "etc",
      filename,
      external_url: (a.external_url as string) ?? null,
      storage_url: (a.storage_url as string) ?? null,
      source: (a.source as string) ?? null,
      created_at: a.created_at ? new Date(a.created_at as string).toISOString() : null,
      brand_name: (a.brand_name as string) ?? null,
      brand_id: (a.brand_id as string) ?? null,
      version: auto != null ? `v${auto}` : m ? `v${m[1]}` : null,
      owner: uploaderById.get(a.id as string) ?? null,
    };
  });

  return (
    <div>
      <ScreenHeader
        title="자산 저장소 — 모든 자료의 단일 색인"
        desc="계약서·제안서·인증·라벨·정산서·RFP가 어느 카드에 있든 여기서 한 번에 검색됩니다"
        right={<AssetsHeaderActions kindLabel={KIND} />}
      />
      <AssetsIndexTabs rows={rows} kindLabel={KIND} cardLabel={CARD} />
    </div>
  );
}
