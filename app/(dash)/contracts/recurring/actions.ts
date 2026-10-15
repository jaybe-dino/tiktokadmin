"use server";
import { currentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { registerRecurringContract, issueContractLink, revokeContractLink } from "@/lib/recurring-contracts";
export async function recurringAction(form: FormData): Promise<{ok:boolean;error?:string;path?:string}> {
  const u = await currentUser();
  if (!u) return {ok:false,error:"로그인이 필요합니다."};
  if (!["exec","lead","settle","sales"].includes(u.role)) return {ok:false,error:"계약 관리 권한이 필요합니다."};
  try {
    const op = String(form.get("op") || "create");
    if (op === "create") await registerRecurringContract(form,u.id);
    else {
      const id = String(form.get("id") || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("계약 ID가 올바르지 않습니다.");
      if (op === "issue") return {ok:true,path:await issueContractLink(id)};
      if (op !== "revoke") throw new Error("지원하지 않는 작업입니다.");
      await revokeContractLink(id);
    }
    revalidatePath("/contracts"); revalidatePath("/contracts/recurring");
    return {ok:true};
  } catch(e) {
    const { ZodError } = await import("zod");
    return {ok:false,error:e instanceof ZodError ? e.issues[0]?.message : e instanceof Error && !/sql|relation|connection|column/i.test(e.message) ? e.message : "저장 실패: 관리자에게 문의해 주세요."};
  }
}
