"use server";
// 광고 수신거부 확정 — POST(폼 제출)로만 실행된다.
//   메일 미리보기·보안 스캐너가 링크를 GET 으로 여는 것만으로는 아무 것도 바뀌지 않는다.
import { confirmOptOut } from "@/lib/ad-optout";

export async function confirmOptOutAction(token: string): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const r = await confirmOptOut(token, { source: "link" });
  // 토큰·주소는 반환값에 담지 않는다.
  return { ok: r.ok, already: r.already, error: r.error };
}
