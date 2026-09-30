// PM 에이전트 접근 통제 — 브랜드 배정 기준.
//   이 앱 전체는 역할(role) 기반이지만, PM 신규 기능에서는 브랜드 단위로 좁힌다:
//     · exec / lead            : 모든 브랜드 읽기·쓰기
//     · 그 밖의 역할           : 그 브랜드에 실제로 배정된 경우에만
//                                (brands.owner_intake / owner_sales / owner_onboard /
//                                 owner_ads / owner_contract / owner_backup)
//                                또는 이미 지정된 PM 담당자(pm_brand_config.owner_admin_id)
//     · 배정되지 않은 직원     : 읽기도 거부
//   PM 담당자 "지정" 권한은 더 좁다 — exec/lead 또는 기존 배정 담당자만 바꿀 수 있다.
//   PM 담당자로 지정됐다는 사실만으로 다른 사람에게 권한을 넘길 수는 없다
//   (스스로·서로 접근권한을 확장하지 못하게).
//
//   하위 레코드 id(업무·KPI·수동대화·실행)는 항상 "그 브랜드의 것"인지 확인한다 —
//   다른 브랜드 id 를 끼워 넣어도 조작되지 않는다.
import { queryOne } from "./db";
import { currentUser } from "./auth";
import type { AdminUser } from "./auth";

/** 브랜드 배정 컬럼 — 실제로 존재하는 것만(0001 + 0006 + 0054). */
export const BRAND_OWNER_COLUMNS = [
  "owner_intake", "owner_sales", "owner_onboard", "owner_ads", "owner_contract", "owner_backup",
] as const;

/** 브랜드 상관없이 전체 권한을 갖는 역할. */
const GLOBAL_ROLES = new Set(["exec", "lead"]);

/** 접근이 허용된 근거. */
export type AccessVia = "global" | "brand_owner" | "pm_owner";

export interface BrandAccess {
  user: AdminUser;
  brandId: string;
  brandName: string;
  isTest: boolean;
  via: AccessVia;
  /** 읽기만 가능한지 — PM 은 접근이 허용되면 쓰기도 가능하다(배정 담당자이므로). */
  canEdit: boolean;
  /** PM 담당자를 바꿀 수 있는지 — exec/lead 또는 브랜드 배정 담당자만. */
  canAssignPm: boolean;
}

export type AccessFail = { ok: false; error: string };
export type AccessOk = { ok: true; access: BrandAccess };

export function isUuid(v: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((v ?? "").trim());
}

const eq = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b;

interface BrandRow {
  id: string; brand_name: string; is_test: boolean;
  owner_intake: string | null; owner_sales: string | null; owner_onboard: string | null;
  owner_ads: string | null; owner_contract: string | null; owner_backup: string | null;
  pm_owner: string | null;
}

/**
 * 브랜드 접근 확인. 실패 사유는 사람이 읽을 수 있게 돌려준다(DB 원문 노출 없음).
 *   읽기·쓰기 모두 같은 가드를 쓴다 — 페이지 조회, 서버액션, 원문근거 조회 전부.
 */
export async function brandAccess(brandId: string): Promise<AccessOk | AccessFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "세션 만료" };
  return brandAccessFor(user, brandId);
}

/**
 * 세션이 아닌 다른 경로(예: Slack 액터)에서 같은 규칙으로 접근을 확인한다.
 *   규칙을 복제하지 않기 위해 brandAccess 가 이 함수를 쓴다.
 */
export async function brandAccessFor(user: AdminUser, brandId: string): Promise<AccessOk | AccessFail> {
  if (!user.active) return { ok: false, error: "비활성 계정" };
  if (!isUuid(brandId)) return { ok: false, error: "브랜드를 선택하세요." };

  // pm_brand_config 가 아직 없을 수 있으므로(0099 미적용) LEFT JOIN 실패에 대비한다.
  const b = await brandRow(brandId.trim());
  if (!b) return { ok: false, error: "존재하지 않는 브랜드입니다." };

  const me = (user.id ?? "").trim().toLowerCase();
  const isGlobal = GLOBAL_ROLES.has(user.role);
  const isBrandOwner = BRAND_OWNER_COLUMNS.some((c) => eq(b[c], me));
  const isPmOwner = eq(b.pm_owner, me);

  if (!isGlobal && !isBrandOwner && !isPmOwner) {
    return { ok: false, error: "이 브랜드의 담당자가 아닙니다 — 파트장·대표 또는 배정 담당자만 볼 수 있습니다." };
  }

  const via: AccessVia = isGlobal ? "global" : isBrandOwner ? "brand_owner" : "pm_owner";
  return {
    ok: true,
    access: {
      user, brandId: b.id, brandName: b.brand_name, isTest: b.is_test, via,
      canEdit: true,
      // PM 담당자 지정은 PM 담당자 자격만으로는 못 한다(권한 확장 방지).
      canAssignPm: isGlobal || isBrandOwner,
    },
  };
}

/** 브랜드 + 배정 + PM 담당자 한 번에. pm_brand_config 미적용(0099 전)도 견딘다. */
async function brandRow(id: string): Promise<BrandRow | null> {
  const cols = `b.id, b.brand_name, COALESCE(b.is_test,false) AS is_test,
                ${BRAND_OWNER_COLUMNS.map((c) => `b.${c}`).join(", ")}`;
  try {
    return await queryOne<BrandRow>(
      `SELECT ${cols}, p.owner_admin_id AS pm_owner
         FROM brands b LEFT JOIN pm_brand_config p ON p.brand_id = b.id
        WHERE b.id=$1`, [id]);
  } catch {
    // 0099 미적용 — PM 담당자 경유 접근은 아직 없다(배정/전체 권한만).
    const r = await queryOne<Omit<BrandRow, "pm_owner">>(
      `SELECT ${cols} FROM brands b WHERE b.id=$1`, [id]);
    return r ? { ...r, pm_owner: null } : null;
  }
}

/**
 * 하위 레코드가 그 브랜드의 것인지 확인한다(다른 브랜드 id 혼입 차단).
 *   table 은 코드에 적힌 화이트리스트에서만 온다 — 외부 입력을 SQL 에 넣지 않는다.
 */
const OWNED_TABLES = { pm_tasks: 1, pm_kpis: 1, pm_manual_comms: 1, pm_runs: 1 } as const;
export type OwnedTable = keyof typeof OWNED_TABLES;

export async function ownsRow(table: OwnedTable, id: string, brandId: string): Promise<boolean> {
  if (!Object.prototype.hasOwnProperty.call(OWNED_TABLES, table)) return false;
  if (!isUuid(id) || !isUuid(brandId)) return false;
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE id=$1 AND brand_id=$2`, [id, brandId]);
  return Boolean(row);
}

/** 서버액션 앞단 공통 — 접근 확인 + 하위 id 소유 확인을 한 번에. */
export async function guard(brandId: string, owned?: { table: OwnedTable; id: string }):
  Promise<AccessOk | AccessFail> {
  const a = await brandAccess(brandId);
  if (!a.ok) return a;
  if (owned) {
    if (!await ownsRow(owned.table, owned.id, a.access.brandId)) {
      return { ok: false, error: "이 브랜드의 항목이 아닙니다." };
    }
  }
  return a;
}
