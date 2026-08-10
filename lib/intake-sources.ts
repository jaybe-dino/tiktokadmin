// 유입 소스 라벨(CRUD) — 자동발송 허용 유입소스 목록 단일 소스 오브 트루스.
//   intake_channels.source / welcome_config.sources[] 가 참조하는 key.
//   UI(채널 관리·전역 자동안내)와 ingest 소스 검증이 모두 이 목록을 읽는다.
import { query, queryOne } from "./db";
import { SOURCES, SOURCE_LABELS } from "./types";

export interface IntakeSource {
  key: string; label: string; enabled: boolean; sort: number; builtin: boolean; created_at: string;
}

// 코드 기본값(마이그 0052 미적용/DB 오류 시 폴백) — 항상 최소 이 목록은 보이게.
const FALLBACK: IntakeSource[] = SOURCES.map((k, i) => ({
  key: k, label: SOURCE_LABELS[k] ?? k, enabled: true, sort: (i + 1) * 10, builtin: true, created_at: "",
}));

/** 전체 소스 목록(정렬). DB 우선, 없으면 코드 폴백. */
export async function listIntakeSources(): Promise<IntakeSource[]> {
  const rows = await query<IntakeSource>(
    "SELECT key, label, enabled, sort, builtin, created_at FROM intake_sources ORDER BY sort, key",
  ).catch(() => [] as IntakeSource[]);
  return rows.length ? rows : FALLBACK;
}

/** 활성 소스 key 집합 — ingest 화이트리스트 확장용. */
export async function activeSourceKeys(): Promise<Set<string>> {
  const list = await listIntakeSources();
  return new Set(list.filter((s) => s.enabled).map((s) => s.key));
}

/** key→label 매핑(폴백 포함). UI 라벨 표시용. */
export async function sourceLabelMap(): Promise<Record<string, string>> {
  const list = await listIntakeSources();
  const map: Record<string, string> = { ...SOURCE_LABELS };
  for (const s of list) map[s.key] = s.label;
  return map;
}

const KEY_RE = /^[a-z0-9_]{2,40}$/;

export async function createIntakeSource(input: { key: string; label: string; sort?: number }): Promise<IntakeSource | null> {
  const key = (input.key || "").trim().toLowerCase();
  if (!KEY_RE.test(key)) return null;
  return queryOne<IntakeSource>(
    `INSERT INTO intake_sources (key, label, sort, builtin)
     VALUES ($1,$2,$3,false)
     ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, enabled=true
     RETURNING key, label, enabled, sort, builtin, created_at`,
    [key, (input.label || key).trim(), input.sort ?? 500],
  ).catch(() => null);
}

export async function updateIntakeSource(key: string, patch: { label?: string; enabled?: boolean; sort?: number }): Promise<void> {
  await query(
    `UPDATE intake_sources SET
       label=COALESCE($2,label), enabled=COALESCE($3,enabled), sort=COALESCE($4,sort)
     WHERE key=$1`,
    [key, patch.label ?? null, patch.enabled ?? null, patch.sort ?? null],
  ).catch(() => {});
}

export async function deleteIntakeSource(key: string): Promise<void> {
  // etc 는 ingest 폴백값이라 삭제 금지(비활성만 허용).
  if (key === "etc") { await updateIntakeSource(key, { enabled: false }); return; }
  await query("DELETE FROM intake_sources WHERE key=$1", [key]).catch(() => {});
}
