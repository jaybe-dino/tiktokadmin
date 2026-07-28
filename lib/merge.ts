import { tx } from "./db";
import type { Brand } from "./types";

// 브랜드 병합 — 자동 dedup 이 놓친 중복을 하나의 고객 카드로 합친다.
// drop 브랜드의 모든 연관 데이터를 keep 으로 재배정하고, 빈 필드를 채운 뒤 drop 삭제.

const REASSIGN_SIMPLE = ["stage_history", "brand_signals", "brand_files", "proposals"];

// 유니크 제약이 있어 충돌 가능한 테이블: 충돌 행은 버리고 나머지만 이관
const UNIQUE_MOVES: { table: string; on: string }[] = [
  { table: "brand_sources", on: "k.site=d.site AND k.event=d.event AND k.source_ref IS NOT DISTINCT FROM d.source_ref" },
  { table: "doc_items", on: "k.item_key=d.item_key" },
  { table: "brand_stage_checks", on: "k.req_id=d.req_id" },
  { table: "payments_manual", on: "d.ext_ref IS NOT NULL AND k.ext_ref=d.ext_ref" },
];

const FILL_COLS = [
  "email", "phone", "biz_no", "brand_url", "brand_name_en", "contact_name", "category",
  "grade", "plan", "contract_type", "pay_status", "rec_track", "brief_md",
  "owner_intake", "owner_sales", "owner_onboard", "owner_ads",
  "glovek_user_id", "glovek_onb_id", "apply_customer_id", "apply_app_id",
  "tp_registration_id", "referral_code", "memo", "due_date", "next_action",
] as const;

export async function mergeBrands(
  keepId: string,
  dropId: string,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  if (keepId === dropId) return { ok: false, error: "같은 브랜드" };

  return tx(async (c) => {
    const keep = (await c.query<Brand>("SELECT * FROM brands WHERE id=$1 FOR UPDATE", [keepId])).rows[0];
    const drop = (await c.query<Brand>("SELECT * FROM brands WHERE id=$1 FOR UPDATE", [dropId])).rows[0];
    if (!keep || !drop) return { ok: false, error: "브랜드를 찾을 수 없음" };

    // 1) drop 의 유니크 필드 해제(keep 에 채울 때 충돌 방지)
    await c.query("UPDATE brands SET email=NULL, biz_no=NULL WHERE id=$1", [dropId]);

    // 2) 단순 재배정
    for (const t of REASSIGN_SIMPLE) {
      await c.query(`UPDATE ${t} SET brand_id=$1 WHERE brand_id=$2`, [keepId, dropId]);
    }

    // 3) 유니크 테이블: 충돌 행 제거 후 재배정
    for (const m of UNIQUE_MOVES) {
      await c.query(
        `DELETE FROM ${m.table} d WHERE d.brand_id=$2
           AND EXISTS (SELECT 1 FROM ${m.table} k WHERE k.brand_id=$1 AND ${m.on})`,
        [keepId, dropId],
      );
      await c.query(`UPDATE ${m.table} SET brand_id=$1 WHERE brand_id=$2`, [keepId, dropId]);
    }
    // alerts 는 keep 것을 유지(drop 의 것은 drop 삭제 시 CASCADE 제거)

    // 4) keep 의 빈 필드를 drop 값으로 채움
    const sets: string[] = [];
    const vals: unknown[] = [keepId];
    const keepR = keep as unknown as Record<string, unknown>;
    const dropR = drop as unknown as Record<string, unknown>;
    for (const col of FILL_COLS) {
      const kv = keepR[col];
      const dv = dropR[col];
      const empty = kv === null || kv === undefined || kv === "";
      const hasDv = dv !== null && dv !== undefined && dv !== "";
      if (empty && hasDv) {
        vals.push(dv);
        sets.push(`${col}=$${vals.length}`);
      }
    }
    // 국가/인증국 합집합
    const union = (a: string[] = [], b: string[] = []) => Array.from(new Set([...(a ?? []), ...(b ?? [])]));
    vals.push(union(keep.countries, drop.countries));
    sets.push(`countries=$${vals.length}`);
    vals.push(union(keep.certified_countries, drop.certified_countries));
    sets.push(`certified_countries=$${vals.length}`);
    await c.query(`UPDATE brands SET ${sets.join(", ")} WHERE id=$1`, vals);

    // 5) drop 삭제 + 감사 이력
    await c.query("DELETE FROM brands WHERE id=$1", [dropId]);
    await c.query(
      `INSERT INTO stage_history (brand_id, from_state, to_state, actor, gate_passed, reason)
       SELECT id, state, state, $2, true, $3 FROM brands WHERE id=$1`,
      [keepId, actor, `merge: ${drop.brand_name}(${dropId}) → 병합`],
    );
    return { ok: true };
  });
}
