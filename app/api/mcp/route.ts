import { NextRequest, NextResponse } from "next/server";
import { TOOLS } from "@/lib/mcp-tools";
import { verifyMcpToken, type McpPrincipal } from "@/lib/mcp-auth";
import { verifyAccess, externalOrigin } from "@/lib/mcp-oauth";

// MCP 오퍼레이터 서버(Streamable HTTP · JSON-RPC 2.0).
//   claude.ai 커넥터 / Claude 데스크톱 / Claude Code 에서 이 URL 을 붙여 자연어로 운영 조작.
//   추론은 사용자 Claude 구독에서 수행 → 앱은 API 토큰 과금 없음(툴만 노출).
//   인증: Authorization: Bearer <token> 또는 ?token=<token>. 대표(exec)·파트장(lead)만.
//   쓰기 툴은 mcp-tools.ts 내부에서 게이트(인증·필수조건)를 강제하므로 단계 건너뛰기 불가.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // enrich/diagnose 등 AI 툴 여유.

const PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
const SERVER_INFO = { name: "glovek-admin", version: "1.0.0" };

type Json = Record<string, unknown>;
const rpcResult = (id: unknown, result: unknown): Json => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string): Json => ({ jsonrpc: "2.0", id, error: { code, message } });

function tokenFrom(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const q = req.nextUrl.searchParams.get("token");
  return q ? q.trim() : null;
}

// 두 가지 자격 수용: ① OAuth 액세스 토큰(claude.ai/데스크톱) ② 수동 mcp_ 토큰(Claude Code).
async function resolvePrincipal(req: NextRequest): Promise<McpPrincipal | null> {
  const token = tokenFrom(req);
  if (!token) return null;
  const oauth = verifyAccess(token);
  if (oauth) return oauth;
  return verifyMcpToken(token);
}

function toolList() {
  return Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
}

async function handleRpc(msg: Json, actorName: string): Promise<Json | null> {
  const { id, method, params } = msg as { id?: unknown; method?: string; params?: Json };

  // 알림(id 없음) — 응답 없이 수신 확인만.
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize": {
      const reqV = (params?.protocolVersion as string) ?? "";
      const protocolVersion = PROTOCOL_VERSIONS.has(reqV) ? reqV : "2025-06-18";
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: toolList() });
    case "tools/call": {
      const name = params?.name as string;
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      const def = TOOLS[name];
      if (!def) return rpcError(id, -32602, `알 수 없는 툴: ${name}`);
      try {
        const out = await def.handler(args, actorName);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(out ?? null).slice(0, 100_000) }],
        });
      } catch (e) {
        // 툴 오류는 isError 결과로 반환(프로토콜 오류 아님) — 모델이 읽고 대처.
        return rpcResult(id, {
          content: [{ type: "text", text: `툴 실행 오류: ${(e as Error).message}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `지원하지 않는 메서드: ${method}`);
  }
}

export async function POST(req: NextRequest) {
  const principal = await resolvePrincipal(req);
  if (!principal) {
    // RFC 9728: 401 + WWW-Authenticate 로 리소스 메타데이터 위치 안내 → 클라이언트가 OAuth 시작.
    const rm = `${externalOrigin(req)}/.well-known/oauth-protected-resource`;
    return NextResponse.json(
      rpcError(null, -32001, "인증 필요 — 대표·파트장 계정으로 연결하세요."),
      { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${rm}"` } },
    );
  }
  const actorName = `mcp:${principal.email}`;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "JSON 파싱 오류"), { status: 400 });
  }

  // 배치(배열) 또는 단일 메시지 모두 지원.
  if (Array.isArray(body)) {
    const out: Json[] = [];
    for (const m of body) {
      const r = await handleRpc(m as Json, actorName);
      if (r) out.push(r);
    }
    return NextResponse.json(out);
  }
  const r = await handleRpc(body as Json, actorName);
  if (!r) return new NextResponse(null, { status: 202 }); // 알림 → 본문 없음
  return NextResponse.json(r);
}

// 서버→클라이언트 SSE 스트림 미제공(stateless) — GET 은 405.
export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
