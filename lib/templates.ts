// 발송 템플릿 (22) — 설정에서 CRUD, {브랜드명}/{담당자명} 치환. 자동안내·리마인더·발송센터 공용.
import { query, queryOne } from "./db";

export interface MsgTemplate {
  id: string; key: string; label: string; channel: "email" | "sms";
  subject: string; body: string; updated_by: string | null; updated_at: string;
}

export function listTemplates(): Promise<MsgTemplate[]> {
  return query<MsgTemplate>("SELECT * FROM msg_templates ORDER BY channel, key").catch(() => []);
}

export async function upsertTemplate(t: { key: string; label: string; channel: "email" | "sms"; subject?: string; body: string }, by: string): Promise<void> {
  if (!t.key.trim() || !t.body.trim()) throw new Error("key·본문 필수");
  await query(
    `INSERT INTO msg_templates (key, label, channel, subject, body, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, channel=EXCLUDED.channel,
       subject=EXCLUDED.subject, body=EXCLUDED.body, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [t.key.trim(), t.label.trim(), t.channel, t.subject ?? "", t.body, by]);
}

export async function deleteTemplate(key: string): Promise<void> {
  await query("DELETE FROM msg_templates WHERE key=$1", [key]);
}

/** key 로 템플릿 조회(없으면 null) — 자동안내 등에서 우선 사용, 없으면 기존 기본문구 폴백. */
export async function getTemplate(key: string): Promise<MsgTemplate | null> {
  return queryOne<MsgTemplate>("SELECT * FROM msg_templates WHERE key=$1", [key]).catch(() => null);
}

/** {브랜드명}/{담당자명} 치환 + \n 처리. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(브랜드명|담당자명)\}/g, (_, k) => vars[k] ?? "").replace(/\\n/g, "\n");
}
