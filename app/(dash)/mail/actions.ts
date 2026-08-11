"use server";

// 메일함 화면 전용 서버액션.
//   · 상태전이/발송/배정 게이트는 @/app/actions(assignAction·composeEmailAction 등)를 재사용.
//   · 이 파일은 게이트가 없는 "읽기 보조"(담당 이관용 담당자 목록)만 담당한다.
//   · 직접 owner UPDATE 금지 — 배정은 반드시 assignAction(opsAssign) 경유.

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { normalizeEmail } from "@/lib/dedup";

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

export type BrandOption = { id: string; name: string };

/** 미매칭 스레드 브랜드 연결용 — 브랜드 목록. 로그인 필요. */
export async function listBrandOptionsAction(): Promise<{ ok: boolean; brands: BrandOption[]; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, brands: [], error: "세션 만료" };
  const rows = await query<{ id: string; brand_name: string }>(
    "SELECT id, brand_name FROM brands ORDER BY brand_name ASC LIMIT 1000",
  ).catch(() => [] as { id: string; brand_name: string }[]);
  return { ok: true, brands: rows.map((b) => ({ id: b.id, name: b.brand_name || "(이름 없음)" })) };
}

/**
 * 미매칭(brand_id NULL) 스레드를 브랜드에 수동 연결.
 *   · 스레드의 모든 메시지 brand_id 설정
 *   · 상대(외부) 참여 주소를 brand_email_aliases 에 등록 → 향후 자동 매칭
 *   · 브랜드 접촉 부수효과(contact_logged·last_contact_at·무응답 해제) 반영
 */
export async function connectThreadToBrandAction(
  threadId: string, brandId: string,
): Promise<{ ok: boolean; moved?: number; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!threadId || !brandId) return { ok: false, error: "스레드/브랜드 정보가 없습니다." };

  const exists = await queryOne<{ id: string }>("SELECT id FROM brands WHERE id=$1", [brandId]).catch(() => null);
  if (!exists) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 연결 대상 미매칭 메시지 조회(외부 주소·최신 시각 파악).
  const msgs = await query<{ direction: string; owner_email: string; from_addr: string; to_addrs: string[] | null; sent_at: string }>(
    `SELECT direction, owner_email, from_addr, to_addrs, sent_at
       FROM email_messages WHERE thread_id=$1 AND brand_id IS NULL`,
    [threadId],
  ).catch(() => [] as { direction: string; owner_email: string; from_addr: string; to_addrs: string[] | null; sent_at: string }[]);
  if (msgs.length === 0) return { ok: false, error: "연결할 미매칭 메시지가 없습니다(이미 연결됨)." };

  // 외부(상대) 주소 = 전체 참여 주소 − 공용 메일함(owner) 주소.
  const owners = new Set(msgs.map((m) => normalizeEmail(m.owner_email)).filter(Boolean) as string[]);
  const externals = new Set<string>();
  let latest = "";
  for (const m of msgs) {
    for (const a of [m.from_addr, ...(m.to_addrs ?? [])]) {
      const e = normalizeEmail(a);
      if (e && !owners.has(e)) externals.add(e);
    }
    if (!latest || m.sent_at > latest) latest = m.sent_at;
  }

  await query("UPDATE email_messages SET brand_id=$1 WHERE thread_id=$2 AND brand_id IS NULL", [brandId, threadId]);

  // 외부 주소를 별칭으로 등록(향후 자동 매칭). 중복 무시.
  for (const e of externals) {
    await query(
      "INSERT INTO brand_email_aliases (brand_id, email, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [brandId, e, u.id ?? "mail"],
    ).catch(() => {});
  }

  // 접촉 부수효과 — 브랜드 카드 타임라인·last_contact·무응답 해제.
  if (latest) {
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'gmail','contact_logged',$2,$3)`,
      [brandId, JSON.stringify({ channel: "email", via: "mail_connect" }), latest],
    ).catch(() => {});
    await query(
      "UPDATE brands SET last_contact_at=GREATEST(COALESCE(last_contact_at,'epoch'),$2::timestamptz) WHERE id=$1",
      [brandId, latest],
    ).catch(() => {});
  }
  const hasIn = msgs.some((m) => m.direction === "in");
  if (hasIn) {
    await query(
      "UPDATE alerts SET resolved_at=now() WHERE brand_id=$1 AND kind='no_reply' AND resolved_at IS NULL",
      [brandId],
    ).catch(() => {});
  }

  revalidatePath("/mail");
  revalidatePath(`/brand/${brandId}`);
  return { ok: true, moved: msgs.length };
}
