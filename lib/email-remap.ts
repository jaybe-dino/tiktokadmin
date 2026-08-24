// 과거 메일함 데이터 재맵핑 — 수집 당시 매칭 실패(brand_id NULL)로 남은 메일을,
//   현재 등록된 브랜드 이메일·별칭·도메인 기준으로 다시 매칭해 브랜드에 연결한다.
//   수집 시 매칭 로직(matchBrandByAddresses)을 그대로 재사용한다.
import { query } from "./db";
import { matchBrandByAddresses } from "./email-sync";

export interface RemapStats {
  unlinked: number; // 현재 미매칭(brand_id NULL) 메일 수
}

export async function unlinkedEmailStats(): Promise<RemapStats> {
  const r = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM email_messages WHERE brand_id IS NULL",
  ).catch(() => [{ n: "0" }]);
  return { unlinked: Number(r[0]?.n ?? 0) };
}

export interface RemapResult { ok: boolean; scanned: number; linked: number; via: Record<string, number>; remaining: number; error?: string }

/** 미매칭 메일을 최대 limit 건 재매칭. 매칭되면 email_messages.brand_id 갱신. */
export async function remapUnlinkedEmails(limit = 2000): Promise<RemapResult> {
  const via: Record<string, number> = { alias: 0, email: 0, domain: 0 };
  try {
    const rows = await query<{ id: string; from_addr: string | null; to_addrs: string[] | null }>(
      `SELECT id, from_addr, to_addrs FROM email_messages
        WHERE brand_id IS NULL ORDER BY sent_at DESC LIMIT $1`, [limit],
    ).catch(() => []);
    let linked = 0;
    for (const m of rows) {
      const addrs = [m.from_addr ?? "", ...(m.to_addrs ?? [])].filter(Boolean);
      if (addrs.length === 0) continue;
      const match = await matchBrandByAddresses(addrs).catch(() => null);
      if (!match) continue;
      await query("UPDATE email_messages SET brand_id=$1 WHERE id=$2 AND brand_id IS NULL", [match.brandId, m.id]).catch(() => {});
      via[match.via] = (via[match.via] ?? 0) + 1;
      linked++;
    }
    const rest = await unlinkedEmailStats();
    return { ok: true, scanned: rows.length, linked, via, remaining: rest.unlinked };
  } catch (e) {
    return { ok: false, scanned: 0, linked: 0, via, remaining: 0, error: e instanceof Error ? e.message : "재맵핑 실패" };
  }
}
