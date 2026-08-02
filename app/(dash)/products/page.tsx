import { allProducts, certRisks } from "@/lib/repo/global";
import ProductsView from "./ProductsView";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, risks] = await Promise.all([
    allProducts().catch(() => []) as Promise<Record<string, unknown>[]>,
    certRisks().catch(() => []) as Promise<Record<string, unknown>[]>,
  ]);

  return <ProductsView products={products} risks={risks} />;
}
