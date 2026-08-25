import { redirect } from "next/navigation";
import {
  currentOnbCustomer, getOrCreateApplication, getCountries, getProducts, getProductCountries,
} from "@/lib/onboarding";
import ProductsPortal from "./ProductsPortal";

export const dynamic = "force-dynamic";

// 브랜드사 제품 관리 포털 — 온보딩 신청서 저장 완료 후에는 여기서 제품만 계속 등록·관리한다.
//   로그인은 온보딩 신청서와 동일(이메일+발급코드). 제품은 어드민 승인 대상.
export default async function ApplyProductsPage() {
  const customer = await currentOnbCustomer();
  if (!customer) redirect("/apply/login?next=/apply/products");

  const { id: appId } = await getOrCreateApplication(customer.id, customer.brand_id);
  const [countries, products] = await Promise.all([getCountries(appId), getProducts(appId)]);
  const productCountries: Record<string, Awaited<ReturnType<typeof getProductCountries>>> = {};
  for (const p of products) productCountries[p.id] = await getProductCountries(p.id);

  return (
    <ProductsPortal
      email={customer.email}
      countries={countries}
      products={products}
      productCountries={productCountries}
    />
  );
}
