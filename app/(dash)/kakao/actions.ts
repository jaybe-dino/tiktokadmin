"use server";
// 카카오 수집 — 방↔브랜드 매핑 관리(어드민).
//   이 파일에는 고객에게 보내는 경로가 없다. 받은 기록을 어느 브랜드로 볼지 정할 뿐이다.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  kakaoSchemaState, listKakaoRooms, listKakaoRuns, linkKakaoRoom,
  setKakaoRoomStatus, setKakaoRoomNote, KAKAO_SCHEMA_MIGRATION, KAKAO_SECRET_ENV,
} from "@/lib/kakao-rooms";
import { query } from "@/lib/db";

const WRITE_ROLES = new Set(["exec", "lead"]);

export interface KakaoOverview {
  schemaReady: boolean;
  schemaError?: string;
  migration: string;
  /** 수집기 비밀키가 서버에 설정돼 있는지 — 값은 돌려주지 않는다. */
  collectorConfigured: boolean;
  secretEnv: string;
  rooms: Awaited<ReturnType<typeof listKakaoRooms>>;
  runs: Awaited<ReturnType<typeof listKakaoRuns>>;
  brands: { id: string; name: string }[];
  canWrite: boolean;
}

export async function kakaoOverviewAction(): Promise<{ ok: boolean; error?: string; data?: KakaoOverview }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const collectorConfigured = Boolean(process.env[KAKAO_SECRET_ENV]);
  const schema = await kakaoSchemaState();
  if (!schema.ready) {
    return {
      ok: true,
      data: {
        schemaReady: false,
        schemaError: `마이그레이션 ${KAKAO_SCHEMA_MIGRATION} 미적용 — 없는 항목: ${schema.missing.join(", ") || schema.error || "확인 실패"}`,
        migration: KAKAO_SCHEMA_MIGRATION, collectorConfigured, secretEnv: KAKAO_SECRET_ENV,
        rooms: [], runs: [], brands: [], canWrite: WRITE_ROLES.has(u.role),
      },
    };
  }
  try {
    const [rooms, runs, brands] = await Promise.all([
      listKakaoRooms(), listKakaoRuns(),
      query<{ id: string; name: string }>(
        `SELECT id, brand_name AS name FROM brands
          WHERE coalesce(is_test,false) = false AND state NOT IN ('dropped','churned')
          ORDER BY brand_name LIMIT 500`),
    ]);
    return {
      ok: true,
      data: {
        schemaReady: true, migration: KAKAO_SCHEMA_MIGRATION, collectorConfigured,
        secretEnv: KAKAO_SECRET_ENV, rooms, runs, brands, canWrite: WRITE_ROLES.has(u.role),
      },
    };
  } catch (e) {
    return { ok: false, error: `수집 정보를 불러오지 못했습니다 — ${(e as Error).message.slice(0, 200)}` };
  }
}

async function writer() {
  const u = await currentUser();
  if (!u) return { ok: false as const, error: "권한이 없습니다." };
  if (!WRITE_ROLES.has(u.role)) return { ok: false as const, error: "방 연결은 대표·파트장만 바꿀 수 있습니다." };
  return { ok: true as const, user: u };
}

export async function kakaoLinkRoomAction(roomId: string, brandId: string | null):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await writer();
  if (!a.ok) return a;
  const r = await linkKakaoRoom(roomId, brandId || null, a.user.id);
  if (r.ok) revalidatePath("/kakao");
  return r.ok
    ? { ok: true, note: brandId ? "브랜드에 연결했습니다 — 이후 들어오는 대화부터 저장됩니다." : "연결을 해제했습니다 — 저장이 멈춥니다." }
    : r;
}

export async function kakaoSetStatusAction(roomId: string, status: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await writer();
  if (!a.ok) return a;
  if (status !== "pending" && status !== "ignored") return { ok: false, error: "알 수 없는 상태입니다." };
  const r = await setKakaoRoomStatus(roomId, status, a.user.id);
  if (r.ok) revalidatePath("/kakao");
  return r.ok ? { ok: true, note: status === "ignored" ? "수집 대상에서 제외했습니다." : "확인 대기로 되돌렸습니다." } : r;
}

export async function kakaoSetNoteAction(roomId: string, note: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await writer();
  if (!a.ok) return a;
  const r = await setKakaoRoomNote(roomId, note);
  if (r.ok) revalidatePath("/kakao");
  return r.ok ? { ok: true, note: "저장했습니다." } : r;
}
