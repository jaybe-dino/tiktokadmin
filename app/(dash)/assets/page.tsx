import ScreenHeader from "@/components/ScreenHeader";
import AssetsIndexTabs, { type AssetRow } from "@/components/AssetsIndexTabs";
import { allAssets } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  proposal: "제안서", contract: "계약서", cert: "인증서", doc: "서류", report: "리포트",
  meeting_rec: "회의녹음", brand_intro: "브랜드소개", etc: "기타",
};

export default async function AssetsPage() {
  const raw = (await allAssets().catch(() => [])) as Record<string, unknown>[];
  const rows: AssetRow[] = raw.map((a) => ({
    id: a.id as string,
    kind: (a.kind as string) ?? "etc",
    filename: (a.filename as string) ?? "",
    external_url: (a.external_url as string) ?? null,
    storage_url: (a.storage_url as string) ?? null,
    source: (a.source as string) ?? null,
    created_at: a.created_at ? new Date(a.created_at as string).toISOString() : null,
    brand_name: (a.brand_name as string) ?? null,
    brand_id: (a.brand_id as string) ?? null,
  }));

  return (
    <div>
      <ScreenHeader
        title="자산 저장소 — 파일·레퍼런스 단일 색인"
        desc={`총 ${rows.length}건 · 어드민 생성물만 저장, 원본은 링크 참조`}
        right={
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" type="button">🔄 드라이브 동기화</button>
            <button className="btn pri" type="button">+ 업로드 → 드라이브 저장</button>
          </div>
        }
      />

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="bd" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, padding: "10px 16px" }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: "#fff", border: "1px solid var(--line)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🗂️</span>
          <b>Google Drive 연동</b>
          <span style={{ color: "var(--ink3)" }}>드라이브에 올려도, 어드민에 올려도 같은 색인에 잡힙니다 · 양방향 동기화</span>
        </div>
      </div>

      <AssetsIndexTabs rows={rows} kindLabel={KIND} />
    </div>
  );
}
