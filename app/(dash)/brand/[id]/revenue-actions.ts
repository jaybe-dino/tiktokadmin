"use server";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requestBrandRevenue } from "@/lib/brand-revenue-jobs";
export async function requestRevenueAction(brandId: string): Promise<{ok:boolean;error?:string}> {
  if (!await currentUser()) return {ok:false,error:"로그인이 필요합니다."};
  if (!/^[a-f0-9-]{36}$/i.test(brandId)) return {ok:false,error:"브랜드 ID 오류"};
  if (!await queryOne("SELECT id FROM brands WHERE id=$1",[brandId])) return {ok:false,error:"브랜드를 찾을 수 없습니다."};
  try { await requestBrandRevenue(brandId); revalidatePath(`/brand/${brandId}`); return {ok:true}; }
  catch { return {ok:false,error:"추정 예약 실패 — 매출 추정 마이그레이션/연결 상태 확인 필요"}; }
}

export async function checkRevenueAiAction(): Promise<{ok:boolean;error?:string;model?:string}> {
  if (!await currentUser()) return {ok:false,error:"로그인이 필요합니다."};
  const {aiClient,aiEnabled,AI_MODEL}=await import("@/lib/ai");
  const {revenueErrorCode}=await import("@/lib/brand-revenue-ai");
  if(!aiEnabled())return {ok:false,error:"AI_NOT_CONFIGURED"};
  try {await aiClient().messages.create({model:AI_MODEL,max_tokens:16,messages:[{role:"user",content:"Reply OK."}]},{timeout:12000,maxRetries:0});return {ok:true,model:AI_MODEL};}
  catch(e){return {ok:false,error:revenueErrorCode(e)};}
}
