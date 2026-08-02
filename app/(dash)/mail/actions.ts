"use server";

// 메일함 화면 전용 서버액션.
//   · 상태전이/발송/배정 게이트는 @/app/actions(assignAction·composeEmailAction 등)를 재사용.
//   · 이 파일은 게이트가 없는 "읽기 보조"(담당 이관용 담당자 목록)만 담당한다.
//   · 직접 owner UPDATE 금지 — 배정은 반드시 assignAction(opsAssign) 경유.

import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export type Assignee = { id: string; name: string };

/** 담당 이관 셀렉트용 — 활성 어드민 목록(id=이메일, name=표시명). 로그인 필요. */
export async function listAssigneesAction(): Promise<{ ok: boolean; assignees: Assignee[]; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, assignees: [], error: "세션 만료" };
  const rows = await query<Assignee>(
    "SELECT id, name FROM admin_users WHERE active ORDER BY name",
  ).catch(() => [] as Assignee[]);
  return { ok: true, assignees: rows };
}
