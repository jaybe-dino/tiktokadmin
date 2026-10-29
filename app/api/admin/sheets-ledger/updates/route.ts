import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  UpdateLogInput, recordManualUpdate, listManualUpdates,
} from "@/lib/sheet-update-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 수동 시트 갱신 처리 이력 — GET 조회 / POST 기록.
//   이 경로는 시트를 갱신하지 않는다. 사람이 연결 도구로 갱신·readback 을 끝낸 뒤
//   그 사실만 남긴다.
//
//   · 로그인 세션만 받는다. CRON_SECRET·쿼리 토큰 우회 경로를 두지 않았다.
//   · role=exec 만 통과한다(미로그인 401 / 다른 역할 403).
//   · POST 는 JSON + same-origin 만 받는다.
//   · 대상 시트 ID 는 서버가 env 에서 넣는다 — 요청으로 받지 않는다.
//   · 쓰기는 ingest_events INSERT 하나뿐이다.

function noStore(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store, no-cache, must-revalidate", pragma: "no-cache" },
  });
}

async function gate(): Promise<{ ok: true; id: string } | { ok: false; res: NextResponse }> {
  const user = await currentUser().catch(() => null);
  if (!user) return { ok: false, res: noStore({ ok: false, error: "unauthorized" }, 401) };
  if (user.role !== "exec") return { ok: false, res: noStore({ ok: false, error: "forbidden" }, 403) };
  return { ok: true, id: user.id };
}

/** 같은 출처에서 온 요청인가. 헤더가 아예 없으면(스크립트·curl) 통과시키지 않는다. */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  const strip = (v: string) => v.replace(/\/+$/, "");
  if (!origin) return site === "same-origin";
  const self = (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
  const allowed = new Set([strip(self), strip(env.adminUrl ?? "")].filter(Boolean));
  return allowed.has(strip(origin));
}

export async function GET() {
  const g = await gate();
  if (!g.ok) return g.res;
  const r = await listManualUpdates();
  if (!r.ok) return noStore({ ok: false, error: r.error }, 500);
  return noStore({ ok: true, rows: r.rows }, 200);
}

export async function POST(req: NextRequest) {
  const g = await gate();
  if (!g.ok) return g.res;
  if (!sameOrigin(req)) {
    return noStore({ ok: false, error: "이 화면에서만 기록할 수 있습니다(교차 출처 요청 거부)." }, 403);
  }
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return noStore({ ok: false, error: "JSON 으로 보내 주세요." }, 415);
  }

  const raw = await req.json().catch(() => null);
  const parsed = UpdateLogInput.safeParse(raw);
  if (!parsed.success) {
    // 어느 칸이 왜 틀렸는지만 돌려준다 — 받은 값을 되돌려 싣지 않는다.
    const issues = parsed.error.issues.slice(0, 5).map((i) => ({
      field: i.path.join(".") || "(root)", message: i.message,
    }));
    return noStore({ ok: false, error: "입력을 확인해 주세요.", issues }, 400);
  }

  const r = await recordManualUpdate(parsed.data, g.id);
  if (!r.ok) return noStore({ ok: false, error: r.error }, r.status);
  return noStore({ ok: true, id: r.id, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
}
