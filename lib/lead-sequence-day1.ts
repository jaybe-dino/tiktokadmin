// 모든 유입 루트의 1일차 문구에 "주간 슬롯" 안내를 일괄로 넣거나 뺀다.
//
//   일부러 하지 않는 것
//     · 1일차(day_no=1)의 sms_body · email_body 두 칸만 바꾼다.
//       켜짐/꺼짐·발송 채널·시각은 UPDATE 문에 아예 없고, 2~4일차도 건드리지 않는다.
//     · 발송을 하지 않는다. 일정·크론·수신거부 설정도 건드리지 않는다.
//     · 본문이 비어 있는 루트에는 넣지 않는다(안내 문구만 덩그러니 남지 않게).
//     · 사람이 손으로 고친 문구는 추측해서 지우지 않는다.
import { query } from "./db";
import {
  withDay1Notice, withoutDay1Notice, hasDay1Notice, smsTooLong, byteLen,
  WEEKLY_APPLY_URL, WEEKLY_SLOT_COUNT,
} from "./weekly-day1-notice";

export { WEEKLY_APPLY_URL, WEEKLY_SLOT_COUNT };

export interface Day1Row {
  channel_id: string;
  key: string;
  name: string;
  /** 이 루트의 연속 안내가 켜져 있는지 — 참고용으로만 보여준다(바꾸지 않는다). */
  seq_enabled: boolean;
  send_sms: boolean;
  send_email: boolean;
  sms_before: string;
  sms_after: string;
  email_before: string;
  email_after: string;
  smsChanged: boolean;
  emailChanged: boolean;
  smsBytesBefore: number;
  smsBytesAfter: number;
  /** 건너뛴 이유(비어 있으면 적용 대상). */
  skip: string;
}

export interface Day1Report {
  mode: "apply" | "remove";
  dryRun: boolean;
  rows: Day1Row[];
  changed: number;
  skipped: number;
  /** 저장 후 다시 읽어 대조한 결과가 어긋난 루트(비어 있어야 정상). */
  mismatch: string[];
}

interface StepRow {
  channel_id: string; key: string | null; name: string | null;
  enabled: boolean; send_sms: boolean; send_email: boolean;
  sms_body: string; email_body: string;
}

/** 1일차 행이 저장돼 있는 모든 루트. 행이 없는 루트는 손댈 것이 없으므로 나오지 않는다. */
async function loadDay1(): Promise<StepRow[]> {
  return query<StepRow>(
    `SELECT s.channel_id::text AS channel_id, c.key, c.name,
            s.enabled, s.send_sms, s.send_email,
            COALESCE(s.sms_body,'') AS sms_body, COALESCE(s.email_body,'') AS email_body
       FROM lead_sequence_steps s
       LEFT JOIN intake_channels c ON c.id = s.channel_id
      WHERE s.day_no = 1
      ORDER BY c.name NULLS LAST, s.channel_id`);
}

function plan(r: StepRow, mode: "apply" | "remove"): Day1Row {
  const base: Omit<Day1Row, "sms_after" | "email_after" | "smsChanged" | "emailChanged" | "smsBytesAfter" | "skip"> = {
    channel_id: r.channel_id,
    key: r.key ?? "(삭제된 루트)",
    name: r.name ?? "(이름 없음)",
    seq_enabled: Boolean(r.enabled),
    send_sms: Boolean(r.send_sms),
    send_email: Boolean(r.send_email),
    sms_before: r.sms_body,
    email_before: r.email_body,
    smsBytesBefore: byteLen(r.sms_body),
  };

  if (mode === "remove") {
    const sms = withoutDay1Notice(r.sms_body, "sms");
    const mail = withoutDay1Notice(r.email_body, "email");
    const stuck = (hasDay1Notice(r.sms_body) && !sms.found) || (hasDay1Notice(r.email_body) && !mail.found);
    return {
      ...base,
      sms_after: sms.body, email_after: mail.body,
      smsChanged: sms.body !== r.sms_body, emailChanged: mail.body !== r.email_body,
      smsBytesAfter: byteLen(sms.body),
      skip: stuck ? "본문이 손으로 수정돼 자동으로 뺄 수 없습니다 — 편집 화면에서 직접 지워주세요." : "",
    };
  }

  const smsBody = r.sms_body.trim() ? withDay1Notice(r.sms_body, "sms") : r.sms_body;
  const mailBody = r.email_body.trim() ? withDay1Notice(r.email_body, "email") : r.email_body;
  let skip = "";
  if (!r.sms_body.trim() && !r.email_body.trim()) skip = "1일차 문구가 비어 있어 건너뜁니다.";
  else if (smsTooLong(smsBody)) skip = "문구를 넣으면 장문 한도를 넘어 건너뜁니다.";
  return {
    ...base,
    sms_after: skip ? r.sms_body : smsBody,
    email_after: skip ? r.email_body : mailBody,
    smsChanged: !skip && smsBody !== r.sms_body,
    emailChanged: !skip && mailBody !== r.email_body,
    smsBytesAfter: byteLen(skip ? r.sms_body : smsBody),
    skip,
  };
}

/**
 * 1일차 문구에 안내를 넣거나 뺀다.
 *   dryRun 이면 무엇이 어떻게 바뀌는지만 돌려주고 저장하지 않는다.
 *   저장한 뒤에는 다시 읽어 실제로 들어갔는지 대조한다(저장됐다고만 말하지 않는다).
 */
export async function applyDay1Notice(
  opts: { mode: "apply" | "remove"; dryRun: boolean; actor: string },
): Promise<Day1Report> {
  const rows = (await loadDay1()).map((r) => plan(r, opts.mode));
  const report: Day1Report = {
    mode: opts.mode, dryRun: opts.dryRun, rows,
    changed: rows.filter((r) => !r.skip && (r.smsChanged || r.emailChanged)).length,
    skipped: rows.filter((r) => r.skip).length,
    mismatch: [],
  };
  if (opts.dryRun) return report;

  for (const r of rows) {
    if (r.skip || (!r.smsChanged && !r.emailChanged)) continue;
    // 1일차의 문자·메일 본문 두 칸만 바꾼다. 다른 칸은 UPDATE 문에 없다.
    await query(
      `UPDATE lead_sequence_steps
          SET sms_body = $2, email_body = $3, updated_by = $4, updated_at = now()
        WHERE channel_id = $1::uuid AND day_no = 1`,
      [r.channel_id, r.sms_after, r.email_after, opts.actor.slice(0, 120)]);
  }

  // 저장 후 재조회 — 실제로 들어갔는지 대조한다.
  const after = new Map((await loadDay1()).map((r) => [r.channel_id, r]));
  for (const r of rows) {
    if (r.skip || (!r.smsChanged && !r.emailChanged)) continue;
    const got = after.get(r.channel_id);
    if (!got || got.sms_body !== r.sms_after || got.email_body !== r.email_after) {
      report.mismatch.push(`${r.name}(${r.key})`);
    }
  }
  return report;
}
