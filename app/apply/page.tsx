import { redirect } from "next/navigation";
import {
  currentOnbCustomer, getOrCreateApplication, getApplicationById, getSteps,
  getDirectors, getWarehouses, getProducts, getProductCountries,
} from "@/lib/onboarding";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const customer = await currentOnbCustomer();
  if (!customer) redirect("/apply/login");

  const { id: appId } = await getOrCreateApplication(customer.id, customer.brand_id);
  const [app, steps, directors, warehouses, products] = await Promise.all([
    getApplicationById(appId),
    getSteps(appId),
    getDirectors(appId),
    getWarehouses(appId),
    getProducts(appId),
  ]);
  // 제품별 국가 정보
  const productCountries: Record<string, Awaited<ReturnType<typeof getProductCountries>>> = {};
  for (const p of products) productCountries[p.id] = await getProductCountries(p.id);

  return (
    <ApplyForm
      email={customer.email}
      app={app ?? {}}
      steps={steps}
      directors={directors}
      warehouses={warehouses}
      products={products}
      productCountries={productCountries}
    />
  );
}
