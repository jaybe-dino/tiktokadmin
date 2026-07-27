import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "../lib/mcp-tools";
import { env } from "../lib/env";

// 도메인 MCP 서버 (06-MCP-AGENTS §1). HTTP streamable + 토큰 인증.
// 읽기=직접 SELECT, 쓰기=ops 경유. actor 는 항상 mcp:{agent}.
// 실행: MCP_TOKEN=... DATABASE_URL=... tsx mcp/server.ts

function buildServer(): Server {
  const server = new Server(
    { name: "glovek-ops-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, def]) => ({
      name,
      description: def.description,
      inputSchema: def.inputSchema as { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = TOOLS[req.params.name];
    if (!def) {
      return { isError: true, content: [{ type: "text", text: `unknown tool: ${req.params.name}` }] };
    }
    const agent = "mcp:server";
    try {
      const out = await def.handler((req.params.arguments ?? {}) as Record<string, unknown>, agent);
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
    }
  });

  return server;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const PORT = Number(process.env.MCP_PORT ?? 8787);

const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== "POST" || !req.url?.startsWith("/mcp")) {
    res.writeHead(404).end("not found");
    return;
  }
  // 토큰 인증
  const auth = req.headers.authorization ?? "";
  if (env.mcpToken && auth !== `Bearer ${env.mcpToken}`) {
    res.writeHead(401).end("unauthorized");
    return;
  }

  const raw = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsed);
});

http.listen(PORT, () => {
  console.log(`Glovek Ops MCP 서버 · http://localhost:${PORT}/mcp (${Object.keys(TOOLS).length} tools)`);
});
