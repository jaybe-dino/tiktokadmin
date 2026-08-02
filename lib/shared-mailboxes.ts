// 회사 공용 메일함 레지스트리 (14) — 주요 고객과 커뮤하는 회사 공용 이메일(2~3개+) 관리.
//   수집 대상 = enabled 인 공용 메일함 + (레거시) admin_users.gmail_sync_enabled.
import { query, queryOne } from "./db";

export interface SharedMailbox {
  email: string; label: string; enabled: boolean; forward_to_owner: boolean;
  note: string; last_sync_at: string | null; created_at: string;
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
