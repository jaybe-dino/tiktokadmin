import { query, queryOne } from "../db";
import type { AlertKind } from "../types";

export interface Alert {
  id: string;
  brand_id: string;
  kind: AlertKind;
  tier: number;
  message: string;
  slack_ts: string | null;
  channel: string | null;
  snoozed_until: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

/**
 * 알림 upsert. 브랜드당 (kind) 1행.
 *  · 활성 행 존재 → tier/message 갱신 (tier 는 하락시키지 않음).
 *  · resolved 상태 → 새 사이클로 재생성(resolved 초기화, tier 재설정).
 * 스누즈 중이면 tier 유지하되 message 는 갱신.
 */
export async function upsertAlert(
  brandId: string,
  kind: AlertKind,
  tier: number,
  message: string,
): Promise<Alert> {
  const existing = await queryOne<Alert>(
    "SELECT * FROM alerts WHERE brand_id=$1 AND kind=$2",
    [brandId, kind],
  );

  if (!existing) {
    const row = await queryOne<Alert>(
      `INSERT INTO alerts (brand_id, kind, tier, message)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [brandId, kind, tier, message],
    );
    return row!;
  }

  if (existing.resolved_at) {
    // 재발 → 새 사이클
    const row = await queryOne<Alert>(
      `UPDATE alerts SET tier=$3, message=$4, resolved_at=NULL, resolved_by=NULL,
         slack_ts=NULL, snoozed_until=NULL, created_at=now()
       WHERE id=$1 AND brand_id IS NOT NULL AND kind=$2 RETURNING *`,
      // second/third params kept for clarity; use id
      [existing.id, kind, tier, message],
    );
    return row!;
  }

  // 활성 → tier 상승만, message 갱신
  const newTier = Math.max(existing.tier, tier);
  const row = await queryOne<Alert>(
    `UPDATE alerts SET tier=$2, message=$3 WHERE id=$1 RETURNING *`,
    [existing.id, newTier, message],
  );
  return row!;
}

/** 조건 해소 → resolved 처리 (있으면). */
export async function resolveAlert(
  brandId: string,
  kind: AlertKind,
  by = "system",
): Promise<void> {
  await query(
    `UPDATE alerts SET resolved_at=now(), resolved_by=$3
       WHERE brand_id=$1 AND kind=$2 AND resolved_at IS NULL`,
    [brandId, kind, by],
  );
}

/** 브랜드의 특정 kind 활성 알림 해제(전이 성공 시 관련 alert 해제). */
export async function resolveAlertsForBrand(brandId: string, kinds: AlertKind[]): Promise<void> {
  if (kinds.length === 0) return;
  await query(
    `UPDATE alerts SET resolved_at=now(), resolved_by='system'
       WHERE brand_id=$1 AND kind = ANY($2) AND resolved_at IS NULL`,
    [brandId, kinds],
  );
}

export async function activeAlerts(brandId: string): Promise<Alert[]> {
  return query<Alert>(
    "SELECT * FROM alerts WHERE brand_id=$1 AND resolved_at IS NULL ORDER BY tier DESC, created_at ASC",
    [brandId],
  );
}

export async function snoozeAlert(alertId: string, until: string): Promise<void> {
  await query("UPDATE alerts SET snoozed_until=$2 WHERE id=$1", [alertId, until]);
}

export async function setAlertSlack(alertId: string, ts: string, channel: string): Promise<void> {
  await query("UPDATE alerts SET slack_ts=$2, channel=$3 WHERE id=$1", [alertId, ts, channel]);
}
