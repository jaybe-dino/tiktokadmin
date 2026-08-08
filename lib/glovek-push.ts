// glovek.space 양방향 동기화 — admin → glovek 방향(변경 push) + 공용 유틸.
//   · brands 아웃박스(migration 0050)를 읽어 glovek brand-upsert API 로 변경분만 전송.
//   · glovek 이 GLOVEK_PUSH_URL/TOKEN 을 주기 전까지는 dormant(설정 없으면 아무것도 안 함).
//   · echo/무한루프 방지는 0050 주석 + 웹훅 수신부(no_change 스킵) 참고.
import { query } from "./db";
import { env } from "./env";
import type { Brand } from "./types";

/** glovek 과 항상 동일하게 유지하는 공유(양방향) 필드. */
export const SHARED_FIELDS = [
  "brand_name", "contact_name", "email", "phone", "biz_no", "category", "brand_url",
] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];

export function glovekPushConfigured(): boolean {
  return !!(env.glovekSync.pushUrl && env.glovekSync.pushToken);
}

function sharedFieldsOf(b: Brand): Record<SharedField, string> {
  const out = {} as Record<SharedField, string>;
  for (const k of SHARED_FIELDS) out[k] = ((b as unknown as Record<string, unknown>)[k] ?? "") as string;
  return out;
}

interface UpsertPayload {
  match: { email?: string; biz_no?: string; glovek_user_id?: string };
  updated_at: string;
  fields: Record<string, string>;
}

async function postUpsert(payload: UpsertPayload, timeoutMs = 10000): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = env.glovekSync.pushUrl;
  const token = env.glovekSync.pushToken;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export interface FlushResult {
  ok: boolean;
  configured: boolean;
  pushed: number;
  failed: number;
  pending: number;
}

/**
 * 아웃박스를 플러시하여 변경된 브랜드를 glovek 으로 push.
 *   성공(HTTP 2xx) → 아웃박스 행 삭제. 실패 → attempts++/last_error 기록(다음 주기 재시도).
 *   미설정이면 push 하지 않고 대기 건수만 반환(dormant).
 */
export async function flushBrandSyncOutbox(limit = 100): Promise<FlushResult> {
  const pendingRow = await query<{ n: string }>("SELECT count(*)::text AS n FROM brand_sync_outbox");
  const pending = Number(pendingRow[0]?.n ?? 0);

  if (!glovekPushConfigured()) {
    return { ok: true, configured: false, pushed: 0, failed: 0, pending };
  }

  const rows = await query<Brand & { o_attempts: number }>(
    `SELECT b.*, o.attempts AS o_attempts
       FROM brand_sync_outbox o JOIN brands b ON b.id = o.brand_id
      ORDER BY o.queued_at ASC
      LIMIT $1`,
    [limit],
  );

  let pushed = 0, failed = 0;
  for (const b of rows) {
    // 매칭 키가 하나도 없으면 glovek 에서 찾을 수 없음 → 큐에서 제거(무한 재시도 방지).
    if (!b.email && !b.biz_no && !b.glovek_user_id) {
      await query("DELETE FROM brand_sync_outbox WHERE brand_id=$1", [b.id]);
      continue;
    }
    const payload: UpsertPayload = {
      match: {
        ...(b.email ? { email: b.email } : {}),
        ...(b.biz_no ? { biz_no: b.biz_no } : {}),
        ...(b.glovek_user_id ? { glovek_user_id: b.glovek_user_id } : {}),
      },
      updated_at: new Date(b.updated_at as unknown as string).toISOString(),
      fields: sharedFieldsOf(b),
    };
    const r = await postUpsert(payload);
    if (r.ok) {
      await query("DELETE FROM brand_sync_outbox WHERE brand_id=$1", [b.id]);
      pushed++;
    } else {
      await query(
        "UPDATE brand_sync_outbox SET attempts=attempts+1, last_error=$2 WHERE brand_id=$1",
        [b.id, (r.error ?? "unknown").slice(0, 500)],
      );
      failed++;
    }
  }
  return { ok: true, configured: true, pushed, failed, pending };
}
