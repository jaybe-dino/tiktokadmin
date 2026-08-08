import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { query, queryOne } from "@/lib/db";
import { setFields } from "@/lib/repo/brands";
import { SHARED_FIELDS } from "@/lib/glovek-push";
import type { Brand } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// glovek → admin (변경 수신). glovek.space 가 공유 브랜드 프로필을 수정하면 이 엔드포인트로 POST.
//   요청서(docs/연동-glovek-양방향동기화-요청서) 4번 옵션 A.
//   · 인증: X-GloveK-Signature = HMAC-SHA256(rawBody, GLOVEK_WEBHOOK_SECRET) hex
//   · 매칭: email → biz_no → phone → glovek_user_id
//   · 충돌: brands.updated_at 이 payload.updated_at 보다 최신이면 skip(last-write-wins)
//   · echo 방지: 실제로 달라진 공유 필드가 없으면 no_change 로 즉시 반환(쓰기·재적재 안 함)
//   GLOVEK_WEBHOOK_SECRET 미설정 시 503(비활성).

interface Payload {
  id?: string;            // glovek 고유 ID(users.id 등)
  email?: string;
  biz_no?: string;
  phone?: string;
  updated_at?: string;
  fields?: Record<string, unknown>;
}

const digits = (s?: string) => (s ?? "").replace(/\D/g, "");

export async function POST(req: NextRequest) {
  const secret = env.glovekSync.webhookSecret;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "not_configured (GLOVEK_WEBHOOK_SECRET 필요)" }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("x-glovek-signature") ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 403 });
  }

  let p: Payload;
  try { p = JSON.parse(raw) as Payload; } catch { return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const email = p.email?.trim().toLowerCase() || null;
  const biz = digits(p.biz_no) || null;
  const phone = digits(p.phone) || null;
  const gid = p.id?.trim() || null;

  // 매칭: email → biz_no → phone → glovek_user_id
  let brand: Brand | null = null;
  if (email) brand = await queryOne<Brand>("SELECT * FROM brands WHERE email=$1", [email]);
  if (!brand && biz) brand = await queryOne<Brand>("SELECT * FROM brands WHERE biz_no=$1", [biz]);
  if (!brand && phone) brand = await queryOne<Brand>("SELECT * FROM brands WHERE phone=$1", [phone]);
  if (!brand && gid) brand = await queryOne<Brand>("SELECT * FROM brands WHERE glovek_user_id=$1", [gid]);
  if (!brand) return NextResponse.json({ ok: true, result: "not_found" });

  // 공유 필드 중 실제로 달라진 것만 추출
  const incoming = p.fields ?? {};
  const changes: Record<string, string> = {};
  for (const k of SHARED_FIELDS) {
    if (!(k in incoming)) continue;
    let v = incoming[k];
    if (v === undefined || v === null) continue;
    v = String(v).trim();
    if (k === "email") v = (v as string).toLowerCase();
    if (k === "phone" || k === "biz_no") v = digits(v as string);
    const curVal = ((brand as unknown as Record<string, unknown>)[k] ?? "") as string;
    if ((v as string) !== String(curVal ?? "")) changes[k] = v as string;
  }
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ ok: true, result: "no_change" });
  }

  // last-write-wins: 원장 프로필이 더 최신이면 무시. 기준시각은 프로필 전용 profile_updated_at
  //   (메모·단계 등 무관한 편집이 프로필 LWW 를 밀어내지 않도록 — glovek 과 대칭).
  if (p.updated_at) {
    const cur = (brand as unknown as Record<string, unknown>).profile_updated_at ?? brand.updated_at;
    const incomingTs = Date.parse(p.updated_at);
    const currentTs = Date.parse(cur as string);
    if (!Number.isNaN(incomingTs) && !Number.isNaN(currentTs) && currentTs > incomingTs) {
      return NextResponse.json({ ok: true, result: "skipped_older" });
    }
  }

  // glovek 이 보낸 레코드이므로 glovek 출처로 연결(안정 PK 저장). 이후 admin 이 이 브랜드의
  //   공유 필드를 수정하면 origin 체크를 통과해 정상적으로 glovek 에 되돌려 push 된다.
  const linkFields: Record<string, unknown> = { ...changes };
  if (gid && !(brand as unknown as Record<string, unknown>).glovek_user_id) linkFields.glovek_user_id = gid;

  await setFields(brand.id, linkFields);
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
     VALUES ($1,'glovek','sync_in',$2,$3, now())
     ON CONFLICT (site, event, source_ref) DO NOTHING`,
    [brand.id, `glovek-webhook:${brand.id}:${Date.now()}`, JSON.stringify({ fields: Object.keys(changes) })],
  );

  return NextResponse.json({ ok: true, result: "applied", id: brand.id, fields: Object.keys(changes) });
}
