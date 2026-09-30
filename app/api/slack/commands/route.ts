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
    case "/pm":
      // 브랜드 히스토리 질의 — 권한이 있는 담당자에게만, 본인에게만 보인다(ephemeral).
      //   3초 내 ack 후 비동기 처리. 도구·모델 이름을 답변에 넣지 않는다.
      if (responseUrl && text) {
        handlePmAsk(userId, text)
          .then((answer) => postToResponseUrl(responseUrl, answer, false))
          .catch((e) => console.error("[pm-ask]", e));
      } else {
        return NextResponse.json({ response_type: "ephemeral", text: "사용법: /pm <브랜드명> <질문>" });
      }
      return NextResponse.json({ response_type: "ephemeral", text: "🔎 기록을 확인하는 중…" });
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

/**
 * /pm <브랜드> <질문> — 브랜드 히스토리 질의.
 *   · Slack 계정이 어드민과 연결돼 있어야 하고, 그 브랜드의 담당자여야 한다(어드민과 같은 가드).
 *   · 브랜드 이름이 모호하면 답하지 않고 후보만 돌려준다.
 *   · 답변은 저장된 기록에서만 만들고 근거·기준 시각·확인 필요 사항을 함께 담는다.
 */
async function handlePmAsk(slackUserId: string, text: string): Promise<string> {
  const actor = await resolveSlackActor(slackUserId);
  if (!actor) return "이 Slack 계정이 어드민 계정과 연결되지 않았습니다 — 계정·권한 화면에서 연결해 주세요.";

  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return "사용법: /pm <브랜드명> <질문>";
  const { resolveBrandStrict, answerBrandHistory } = await import("@/lib/pm-history");

  // 앞에서부터 이름 후보를 늘려가며 확정되는 지점을 찾는다(브랜드명에 공백이 있을 수 있다).
  let picked: { brandId: string; brandName: string; rest: string } | null = null;
  let lastNote = "";
  let candidates: { id: string; name: string }[] = [];
  for (let n = Math.min(4, parts.length - 1); n >= 1; n--) {
    const r = await resolveBrandStrict(parts.slice(0, n).join(" "));
    if (r.brandId && r.brandName) { picked = { brandId: r.brandId, brandName: r.brandName, rest: parts.slice(n).join(" ") }; break; }
    if (r.candidates.length) { candidates = r.candidates; lastNote = r.note ?? ""; }
    else if (r.note) lastNote = r.note;
  }
  if (!picked) {
    if (candidates.length) {
      return `${lastNote}\n후보: ${candidates.map((c) => c.name).join(" / ")}`;
    }
    return lastNote || "브랜드를 찾지 못했습니다.";
  }
  if (!picked.rest.trim()) return `질문을 함께 적어주세요 — 예: /pm ${picked.brandName} 인증 서류 어디까지 받았나요?`;

  // 어드민 화면과 동일한 브랜드 접근 가드.
  const { queryOne } = await import("@/lib/db");
  const u = await queryOne<{ id: string; name: string; role: string; slack_user_id: string | null; active: boolean }>(
    "SELECT id, name, role, slack_user_id, active FROM admin_users WHERE slack_user_id=$1 AND active", [slackUserId]);
  if (!u) return "어드민 계정을 확인하지 못했습니다.";
  const { brandAccessFor } = await import("@/lib/pm-access");
  const acc = await brandAccessFor(
    { id: u.id, name: u.name, role: u.role as never, slack_user_id: u.slack_user_id, active: u.active },
    picked.brandId);
  if (!acc.ok) return `이 브랜드를 볼 권한이 없습니다 — ${acc.error}`;

  const r = await answerBrandHistory({ brandId: acc.access.brandId, brandName: acc.access.brandName, question: picked.rest });
  if (!r.ok) return r.error ?? "답변을 만들지 못했습니다.";
  return `*${acc.access.brandName}*\n${r.text}`;
}
