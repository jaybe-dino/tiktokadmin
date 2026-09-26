// 회의 호스트 ↔ 담당자(admin_users) 연결.
//   Zoom 은 회의 호스트를 이메일로 알려주고, 우리 계정은 admin_users.zoom_email 로 그 이메일을 갖는다.
//   자동 지정은 "틀리면 남의 회의가 남에게 붙는" 일이라 조건을 좁게 잡는다:
//     · 활성 계정만
//     · 정규화(공백 제거·소문자) 후 정확히 일치
//     · 그런 계정이 딱 하나일 때만
//     · 이미 지정된 담당자는 절대 덮어쓰지 않는다
//   하나라도 어긋나면 비워 둔다(사람이 지정).
import { query, queryOne } from "./db";

/** 이메일 정규화 — 앞뒤 공백 제거 + 소문자. 비면 빈 문자열. */
export function normalizeZoomEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** SQL 쪽 정규화 표현 — 저장 표기가 제각각이어도 같은 규칙으로 비교한다. */
const NORM_ZOOM_EMAIL = "lower(trim(coalesce(zoom_email,'')))";
const NORM_HOST_EMAIL = "lower(trim(coalesce(host_email,'')))";

/**
 * host_email → admin_users.id.
 *   활성 계정 중 zoom_email 이 정확히 일치하는 계정이 "딱 하나"일 때만 돌려준다.
 *   없거나 둘 이상이면 null — 자동 지정하지 않는다.
 */
export async function resolveHostAdmin(hostEmail: string | null | undefined): Promise<string | null> {
  const e = normalizeZoomEmail(hostEmail);
  if (!e) return null;
  const rows = await query<{ id: string }>(
    `SELECT id FROM admin_users WHERE active = true AND ${NORM_ZOOM_EMAIL} = $1 LIMIT 2`, [e]);
  return rows.length === 1 ? rows[0].id : null;
}

export interface HostBackfill {
  updated: number;
  /** 보충하지 않은 이유(했으면 비어 있다) — 화면에 그대로 보여준다. */
  skipped?: string;
}

/**
 * 이 계정의 zoom_email 로 진행된 과거 회의 중 "담당자가 비어 있는" 것만 보충한다.
 *   · host_admin_id IS NULL 인 회의만 — 이미 지정된 담당자는 건드리지 않는다.
 *   · 같은 zoom_email 을 쓰는 활성 계정이 둘 이상이면 아무 것도 하지 않는다.
 *   · 브랜드 지정·전사·예약 등 다른 값은 건드리지 않는다.
 */
export async function backfillHostAdminForAccount(adminId: string): Promise<HostBackfill> {
  const id = (adminId ?? "").trim().toLowerCase();
  if (!id) return { updated: 0, skipped: "계정 ID 없음" };

  const me = await queryOne<{ id: string; active: boolean; zoom_email: string | null }>(
    "SELECT id, active, zoom_email FROM admin_users WHERE id=$1", [id]);
  if (!me) return { updated: 0, skipped: "계정을 찾을 수 없음" };
  if (!me.active) return { updated: 0, skipped: "비활성 계정 — 과거 회의를 보충하지 않았습니다" };

  const email = normalizeZoomEmail(me.zoom_email);
  if (!email) return { updated: 0, skipped: "Zoom 이메일이 비어 있어 보충할 대상이 없습니다" };

  // 같은 이메일을 쓰는 활성 계정이 여럿이면 누구의 회의인지 알 수 없다.
  const dup = await query<{ id: string }>(
    `SELECT id FROM admin_users WHERE active = true AND ${NORM_ZOOM_EMAIL} = $1 LIMIT 2`, [email]);
  if (dup.length !== 1 || dup[0].id !== me.id) {
    return { updated: 0, skipped: "같은 Zoom 이메일을 쓰는 활성 계정이 여럿이라 자동 지정하지 않았습니다" };
  }

  const rows = await query<{ id: string }>(
    `UPDATE meetings SET host_admin_id = $1
      WHERE host_admin_id IS NULL AND ${NORM_HOST_EMAIL} = $2
      RETURNING id`, [me.id, email]);
  return { updated: rows.length };
}
