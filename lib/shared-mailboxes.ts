// 회사 공용 메일함 레지스트리 (14) — 주요 고객과 커뮤하는 회사 공용 이메일(2~3개+) 관리.
//   수집 대상 = enabled 인 공용 메일함 + (레거시) admin_users.gmail_sync_enabled.
import { query, queryOne } from "./db";

export interface SharedMailbox {
  email: string; label: string; enabled: boolean; forward_to_owner: boolean;
  is_default: boolean; note: string; last_sync_at: string | null; created_at: string;
}

/** 아웃바운드(받은 메일 아님) 기본 발신 메일함 주소. is_default 우선, 없으면 첫 활성 메일함. */
export async function defaultSendMailbox(): Promise<string | null> {
  const r = await queryOne<{ email: string }>(
    `SELECT email FROM shared_mailboxes WHERE enabled=true
      ORDER BY is_default DESC, created_at ASC LIMIT 1`).catch(() => null);
  return r?.email ?? null;
}

/** 기본 발신 메일함 지정(하나만) — 나머지는 자동 해제.
 *   부분 유니크 인덱스(is_default) 충돌 방지 위해 트랜잭션에서 해제→지정 2단계. */
export async function setMailboxDefault(email: string): Promise<void> {
  const e = email.toLowerCase();
  const { tx } = await import("./db");
  await tx(async (c) => {
    await c.query("UPDATE shared_mailboxes SET is_default=false WHERE is_default AND email<>$1", [e]);
    await c.query("UPDATE shared_mailboxes SET is_default=true WHERE email=$1", [e]);
  });
}

export function listMailboxes(): Promise<SharedMailbox[]> {
  return query<SharedMailbox>("SELECT * FROM shared_mailboxes ORDER BY created_at").catch(() => []);
}

/** 수집·전달에 쓰는 활성 메일함(소문자 주소 배열). */
export async function enabledMailboxes(): Promise<SharedMailbox[]> {
  return query<SharedMailbox>("SELECT * FROM shared_mailboxes WHERE enabled=true").catch(() => []);
}

export async function upsertMailbox(email: string, label: string, note = ""): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) throw new Error("유효한 이메일이 아닙니다");
  await query(
    `INSERT INTO shared_mailboxes (email, label, note) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET label=EXCLUDED.label, note=EXCLUDED.note`,
    [e, label.trim(), note.trim()]);
}

export async function setMailboxEnabled(email: string, enabled: boolean): Promise<void> {
  await query("UPDATE shared_mailboxes SET enabled=$2 WHERE email=$1", [email.toLowerCase(), enabled]);
}

export async function setMailboxForward(email: string, forward: boolean): Promise<void> {
  await query("UPDATE shared_mailboxes SET forward_to_owner=$2 WHERE email=$1", [email.toLowerCase(), forward]);
}

export async function removeMailbox(email: string): Promise<void> {
  await query("DELETE FROM shared_mailboxes WHERE email=$1", [email.toLowerCase()]);
}

export async function markSynced(email: string): Promise<void> {
  await query("UPDATE shared_mailboxes SET last_sync_at=now() WHERE email=$1", [email.toLowerCase()]).catch(() => {});
}

/** 특정 공용 메일함이 담당자 전달 대상인지. */
export async function mailboxForwards(email: string): Promise<boolean> {
  const r = await queryOne<{ forward_to_owner: boolean }>(
    "SELECT forward_to_owner FROM shared_mailboxes WHERE email=$1", [email.toLowerCase()]).catch(() => null);
  return r?.forward_to_owner ?? false;
}
