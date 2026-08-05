"use server";
// 고객 온보딩 신청서 서버액션 — 세션에서 신청서를 재도출(클라이언트 입력 불신).
import { revalidatePath } from "next/cache";
import {
  currentOnbCustomer, getOrCreateApplication,
  saveStepFields, submitStep,
  addDirector, deleteDirector, addWarehouse, deleteWarehouse,
  addProduct, updateProduct, deleteProduct, upsertProductCountry, deleteProductCountry,
  type OnbDirector, type OnbWarehouse, type OnbProduct, type OnbProductCountry,
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
  // 제출 전 마지막 저장은 클라이언트가 saveStepAction 으로 처리.
  const r = await submitStep(app.id, stepNo);
  if (r.ok) revalidatePath("/apply");
  return r;
}

export async function addDirectorAction(d: Partial<OnbDirector>) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await addDirector(app.id, d); revalidatePath("/apply"); return r;
}
export async function deleteDirectorAction(id: string) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await deleteDirector(app.id, id); revalidatePath("/apply"); return r;
}
export async function addWarehouseAction(w: Partial<OnbWarehouse>) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await addWarehouse(app.id, w); revalidatePath("/apply"); return r;
}
export async function deleteWarehouseAction(id: string) {
  const app = await currentApp(); if (!app) return { ok: false, error: "세션 만료" };
  const r = await deleteWarehouse(app.id, id); revalidatePath("/apply"); return r;
}
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
