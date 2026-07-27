import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack";
import { brand360Card } from "@/lib/blocks";
import { queryOne } from "@/lib/db";
import { docProgress } from "@/lib/docs";
import { resolveSlackActor } from "@/lib/slack-actor";
import { ownerFieldForRole } from "@/lib/states";
import { queueBrands } from "@/lib/repo/queries";
import { runAsk, postToResponseUrl } from "@/lib/ask";
import { STATE_LABELS, type Brand } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!verifySlackSignature(raw, ts, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const p = new URLSearchParams(raw);
  const command = p.get("command") ?? "";
  const text = (p.get("text") ?? "").trim();
  const userId = p.get("user_id") ?? "";
  const responseUrl = p.get("response_url") ?? "";

  switch (command) {
    case "/brand":
      return handleBrand(text);
    case "/today":
      return handleToday(userId);
    case "/sla":
      return handleSla(text);
    case "/ask":
      // 3초 내 ack 후 비동기 처리
      if (responseUrl && text) {
        runAsk(text, `slack:${userId}`)
          .then((answer) => postToResponseUrl(responseUrl, answer, false))
          .catch((e) => console.error("[ask]", e));
      }
      return NextResponse.json({ response_type: "ephemeral", text: "🤖 확인 중…" });
    default:
      return NextResponse.json({ response_type: "ephemeral", text: "알 수 없는 명령" });
  }
}

async function handleBrand(q: string) {
  if (!q) return NextResponse.json({ response_type: "ephemeral", text: "사용법: /brand <이름|이메일>" });
  const brand = await queryOne<Brand>(
    "SELECT * FROM brands WHERE brand_name ILIKE $1 OR email ILIKE $1 ORDER BY updated_at DESC LIMIT 1",
    [`%${q}%`],
  );
  if (!brand) return NextResponse.json({ response_type: "ephemeral", text: `'${q}' 브랜드를 찾을 수 없음` });
  const prog = await docProgress(brand.id);
  return NextResponse.json({
    response_type: "ephemeral",
    blocks: brand360Card(brand, { docDone: prog.done, docTotal: prog.total, churn: brand.churn_risk }),
  });
}

async function handleToday(userId: string) {
  const actor = await resolveSlackActor(userId);
  if (!actor) return NextResponse.json({ response_type: "ephemeral", text: "권한 없음 (admin_users 매핑 필요)" });
  const u = await queryOne<{ id: string; role: string }>("SELECT id, role FROM admin_users WHERE slack_user_id=$1", [userId]);
  const field = ownerFieldForRole((u!.role as never));
  const cards = await queueBrands(field, u!.id);
  const top = cards.slice(0, 10);
  const lines = top.map((c) => `• *${c.brand_name}* · ${STATE_LABELS[c.state]}${c.has_breach ? " ⚠️" : ""}${c.next_action ? ` · ${c.next_action}` : ""}`).join("\n");
  return NextResponse.json({
    response_type: "ephemeral",
    text: top.length ? `*오늘 워크큐 상위 ${top.length}*\n${lines}` : "담당 브랜드 없음",
  });
}

async function handleSla(filter: string) {
  const { query } = await import("@/lib/db");
  const rows = await query<{ brand_name: string; kind: string; tier: number; message: string }>(
    `SELECT b.brand_name, a.kind, a.tier, a.message
       FROM alerts a JOIN brands b ON b.id=a.brand_id
      WHERE a.resolved_at IS NULL AND a.kind IN ('sla_breach','stale')
      ORDER BY a.tier DESC LIMIT 30`,
  );
  const filtered = filter
    ? rows.filter((r) => r.message.includes(filter) || r.kind.includes(filter))
    : rows;
  const lines = filtered.map((r) => `• [T${r.tier}] ${r.brand_name} · ${r.message}`).join("\n");
  return NextResponse.json({
    response_type: "ephemeral",
    text: filtered.length ? `*활성 SLA/방치 ${filtered.length}건*\n${lines}` : "활성 SLA 알림 없음 🎉",
  });
}
