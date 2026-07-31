import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allAssets } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  proposal: "제안서", contract: "계약서", cert: "인증서", doc: "서류", report: "리포트",
  meeting_rec: "회의녹음", brand_intro: "브랜드소개", etc: "기타",
};

export default async function AssetsPage() {
  const rows = (await allAssets().catch(() => [])) as Record<string, unknown>[];
  return (
    <div>
      <ScreenHeader title="자산 저장소" desc={`총 ${rows.length}건 · 어드민 생성물만 저장, 원본은 링크 참조`} />
      <div className="card overflow-x-auto">
        <table className="t">
          <thead><tr><th>종류</th><th>파일명</th><th>브랜드</th><th>출처</th><th>등록</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} style={{ color: "var(--ink3)" }}>자산이 없습니다.</td></tr>}
            {rows.map((a) => {
              const url = (a.external_url as string) || (a.storage_url as string);
              return (
                <tr key={a.id as string}>
                  <td><span className="pill chip">{KIND[a.kind as string] ?? (a.kind as string)}</span></td>
                  <td className="font-semibold">{a.filename as string}</td>
                  <td>{a.brand_id ? <Link href={`/brand/${a.brand_id}`} className="hover:underline">{a.brand_name as string}</Link> : "—"}</td>
                  <td style={{ color: "var(--ink3)" }}>{a.source as string}</td>
                  <td style={{ color: "var(--ink3)" }}>{new Date(a.created_at as string).toLocaleDateString("ko-KR")}</td>
                  <td>{url ? <a href={url} target="_blank" className="text-[12px]" style={{ color: "var(--acc)" }}>열기</a> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
