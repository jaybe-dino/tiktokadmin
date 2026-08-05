import { redirect } from "next/navigation";
import {
  currentOnbCustomer, getOrCreateApplication, getApplicationById, getSteps,
  getCountries, getProducts, getProductCountries,
} from "@/lib/onboarding";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const customer = await currentOnbCustomer();
  if (!customer) redirect("/apply/login");

  const { id: appId } = await getOrCreateApplication(customer.id, customer.brand_id);
  const [app, steps, countries, products] = await Promise.all([
    getApplicationById(appId),
    getSteps(appId),
    getCountries(appId),
    getProducts(appId),
  ]);
  const productCountries: Record<string, Awaited<ReturnType<typeof getProductCountries>>> = {};
  for (const p of products) productCountries[p.id] = await getProductCountries(p.id);

  return (
    <ApplyForm
      email={customer.email}
      app={app ?? {}}
      steps={steps}
      countries={countries}
      products={products}
      productCountries={productCountries}
    />
  );
}
