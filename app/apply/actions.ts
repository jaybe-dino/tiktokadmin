"use server";
// 고객 온보딩 신청서 서버액션(tpartners 5스텝) — 세션에서 신청서를 재도출(클라이언트 입력 불신).
import { revalidatePath } from "next/cache";
import {
  currentOnbCustomer, getOrCreateApplication,
  saveStepFields, submitStep,
  setCountries, setCountryLogistics, setCountryLogisticsOption,
  addProduct, updateProduct, deleteProduct, upsertProductCountry, deleteProductCountry,
  type OnbProduct, type OnbProductCountry, type OnbCountry,
} from "@/lib/onboarding";

async function currentApp(): Promise<{ id: string; brandId: string | null } | null> {
  const c = await currentOnbCustomer();
  if (!c) return null;
  const app = await getOrCreateApplication(c.id, c.brand_id);
  return { id: app.id, brandId: c.brand_id };
}

export async function saveStepAction(stepNo: number, values: Record<string, string>) {
  const app = await currentApp();
  if (!app) return { ok: false, error: "세션이 만료되었습니다. 다시 로그인하세요." };
  const r = await saveStepFields(app.id, stepNo, values);
  if (r.ok) revalidatePath("/apply");
  return r;
}

export async function submitStepAction(stepNo: number) {
  const app = await currentApp();
  if (!app) return { ok: false, error: "세션이 만료되었습니다." };
  const r = await submitStep(app.id, stepNo);
  if (r.ok) revalidatePath("/apply");
  return r;
}

// Step1 — 입점 희망 국가 매트릭스
export async function saveCountriesAction(rows: Partial<OnbCountry>[]) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await setCountries(app.id, rows); revalidatePath("/apply"); return r;
}
// Step5 — 국가별 물류계약서 URL
export async function setCountryLogisticsAction(code: string, url: string) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await setCountryLogistics(app.id, code, url); revalidatePath("/apply"); return r;
}
// Step5 — 국가별 물류 방식 선택
export async function setCountryLogisticsOptionAction(code: string, option: string) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await setCountryLogisticsOption(app.id, code, option); revalidatePath("/apply"); return r;
}

// Step4 — 제품
export async function addProductAction(p: Partial<OnbProduct>) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await addProduct(app.id, p); revalidatePath("/apply"); return r;
}
export async function updateProductAction(id: string, p: Partial<OnbProduct>) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await updateProduct(app.id, id, p); revalidatePath("/apply"); return r;
}
export async function deleteProductAction(id: string) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await deleteProduct(app.id, id); revalidatePath("/apply"); return r;
}
export async function upsertProductCountryAction(productId: string, pc: Partial<OnbProductCountry>) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await upsertProductCountry(productId, pc); revalidatePath("/apply"); return r;
}
export async function deleteProductCountryAction(id: string) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await deleteProductCountry(id); revalidatePath("/apply"); return r;
}
