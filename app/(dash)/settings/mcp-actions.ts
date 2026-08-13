"use server";

import { currentUser } from "@/lib/auth";
import { generateMcpToken, revokeMcpToken, mcpRoleAllowed } from "@/lib/mcp-auth";

export interface McpTokenResult {
  ok: boolean;
  token?: string; // 평문 — 발급 직후 1회만 반환
  error?: string;
}

/** 현재 사용자용 MCP 토큰 발급(재발급 시 기존 토큰 무효). 대표·파트장만. */
export async function issueMcpTokenAction(): Promise<McpTokenResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!mcpRoleAllowed(u.role)) return { ok: false, error: "권한 없음 — 대표·파트장만 발급할 수 있습니다." };
  const token = await generateMcpToken(u.id).catch(() => null);
  if (!token) return { ok: false, error: "발급 실패 — 마이그레이션(0066) 적용 여부를 확인하세요." };
  return { ok: true, token };
}

/** 현재 사용자 토큰 폐기. */
export async function revokeMcpTokenAction(): Promise<McpTokenResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!mcpRoleAllowed(u.role)) return { ok: false, error: "권한 없음" };
  await revokeMcpToken(u.id).catch(() => {});
  return { ok: true };
}
