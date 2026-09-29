"use server";
// Gemini 연동 점검 — 파트장·대표만. 외부 호출은 이 버튼을 눌렀을 때만 일어난다.
import { currentUser } from "@/lib/auth";
import { checkGemini, type GeminiCheck } from "@/lib/image-translate";

export async function geminiCheckAction(): Promise<{ ok: boolean; error?: string; data?: GeminiCheck }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (u.role !== "lead" && u.role !== "exec") return { ok: false, error: "권한 없음(파트장·대표만)" };
  try {
    const data = await checkGemini();
    return { ok: data.ok, data };
  } catch (e) {
    return { ok: false, error: `점검 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}
