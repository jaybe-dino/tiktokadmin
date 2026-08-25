import { allProducts, certRisks } from "@/lib/repo/global";
import { query } from "@/lib/db";
import ProductsView from "./ProductsView";
import OnbProductAdmin from "@/components/OnbProductAdmin";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, risks, onbBrands] = await Promise.all([
    allProducts().catch(() => []) as Promise<Record<string, unknown>[]>,
    certRisks().catch(() => []) as Promise<Record<string, unknown>[]>,
    // 온보딩 신청서(제품 포털)가 있는 브랜드만 — 브랜드별 신청 제품 열람·승인 대상.
    query<{ id: string; name: string }>(
      `SELECT DISTINCT b.id, b.brand_name AS name
         FROM brands b
         JOIN onb_applications a ON COALESCE(a.brand_id, (SELECT cu.brand_id FROM onb_customers cu WHERE cu.id=a.customer_id)) = b.id
        WHERE b.state NOT IN ('dropped','churned')
        ORDER BY b.brand_name`,
    ).catch(() => []),
  ]);

  return (
    <>
      <ProductsView products={products} risks={risks} />
      <OnbProductAdmin brands={onbBrands} />
    </>
  );
}
