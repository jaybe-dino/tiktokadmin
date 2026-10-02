// 1일차 안내에 덧붙이는 "틱톡샵 온보딩 주간 슬롯" 문구 — 순수 로직(DB 접근 없음).
//   대표 승인에 따라 모든 유입 루트의 1일차 문자·메일에 같은 문구를 넣는다.
//
//   일부러 하지 않는 것
//     · 마감·선착순·잔여석·확정·보장을 말하지 않는다 — 세어서 막는 로직이 없기 때문이다.
//       "주간 슬롯 3개"는 운영 방식을 밝히는 문장이고, 시스템이 3건에서 접수를 끊지 않는다.
//     · 2~4일차 문구를 건드리지 않는다.
//     · 발송 자체(일정·토글·수신거부)에는 관여하지 않는다 — 문구만 만든다.

/** 주간에 진행하는 온보딩 슬롯 수. 문구에만 쓰고 접수 제한에는 쓰지 않는다. */
export const WEEKLY_SLOT_COUNT = 3;
/** 공개 신청서 주소(기존 경로 유지). */
export const WEEKLY_APPLY_URL = "https://admin.glovek.space/weekly";

/** 문자 본문 끝에 붙이는 블록. */
export const DAY1_SMS_BLOCK = [
  `틱톡샵 온보딩은 주간 슬롯 ${WEEKLY_SLOT_COUNT}개로 진행됩니다.`,
  "▶ 온보딩 사전 신청",
  WEEKLY_APPLY_URL,
].join("\n");

/** 메일 본문에 넣는 블록(서명 앞). */
export const DAY1_EMAIL_BLOCK = [
  `🗓️ 틱톡샵 온보딩은 주간 슬롯 ${WEEKLY_SLOT_COUNT}개로 진행됩니다.`,
  "진행을 검토 중인 팀은 아래에서 사전 신청해 주세요. 담당자가 확인 후 가능 일정과 준비 사항을 안내드립니다.",
  "",
  "📝 틱톡샵 온보딩 사전 신청",
  WEEKLY_APPLY_URL,
].join("\n");

export type NoticeKind = "sms" | "email";
export const noticeBlock = (kind: NoticeKind): string =>
  kind === "sms" ? DAY1_SMS_BLOCK : DAY1_EMAIL_BLOCK;

/** 쓰면 안 되는 표현 — 시스템이 보장하지 못하는 말이다(검수·테스트에서 함께 본다). */
export const FORBIDDEN_CLAIMS = ["마감", "잔여", "선착순", "확정", "보장", "남은 자리", "임박"];

/** 이미 들어가 있는지 — 신청 주소가 본문에 있으면 넣은 것으로 본다. */
export function hasDay1Notice(body: string): boolean {
  return String(body ?? "").includes(WEEKLY_APPLY_URL);
}

const TRAILING_WS = /\s+$/;
/** 마지막 비어 있지 않은 줄이 서명("… 드림")인지 — 메일에서 서명 앞에 넣기 위해 본다. */
function signatureIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    return /드림$|올림$|배상$/.test(l) ? i : -1;
  }
  return -1;
}

/**
 * 문구를 넣은 본문을 돌려준다. 이미 있으면 그대로 돌려준다(여러 번 눌러도 중복되지 않는다).
 *   · 문자는 본문 끝에 붙인다(발송 시 수신거부 안내가 그 뒤에 더 붙는다).
 *   · 메일은 서명이 있으면 그 앞에, 없으면 끝에 넣는다.
 */
export function withDay1Notice(body: string, kind: NoticeKind): string {
  const src = String(body ?? "");
  if (!src.trim()) return src;            // 빈 본문에 문구만 남기지 않는다
  if (hasDay1Notice(src)) return src;
  const block = noticeBlock(kind);
  if (kind === "sms") return `${src.replace(TRAILING_WS, "")}\n\n${block}`;

  const lines = src.replace(TRAILING_WS, "").split("\n");
  const sig = signatureIndex(lines);
  if (sig < 0) return `${lines.join("\n")}\n\n${block}`;
  // 서명 바로 앞에 끼워 넣는다(서명과 블록 사이 빈 줄 유지).
  const head = lines.slice(0, sig).join("\n").replace(TRAILING_WS, "");
  const tail = lines.slice(sig).join("\n");
  return `${head}\n\n${block}\n\n${tail}`;
}

/**
 * 넣었던 문구를 뺀 본문. 넣을 때와 같은 모양일 때만 빼낸다 —
 *   사람이 손으로 고친 문구를 추측해서 지우지 않는다(그 경우 found=false 로 알린다).
 */
export function withoutDay1Notice(body: string, kind: NoticeKind): { body: string; found: boolean } {
  const src = String(body ?? "");
  if (!hasDay1Notice(src)) return { body: src, found: false };
  const block = noticeBlock(kind);
  for (const pat of [`\n\n${block}\n\n`, `\n\n${block}`, block]) {
    const at = src.indexOf(pat);
    if (at >= 0) {
      const next = src.slice(0, at) + (pat.endsWith("\n\n") ? "\n\n" : "") + src.slice(at + pat.length);
      return { body: next.replace(TRAILING_WS, ""), found: true };
    }
  }
  // 주소는 있는데 블록 모양이 아니다 → 손으로 고친 것이므로 건드리지 않는다.
  return { body: src, found: false };
}

// ── 길이 점검 ────────────────────────────────────────────────
/** EUC-KR 기준 바이트 수(한글 2, ASCII 1) — 장문(LMS) 한도 판정용. */
export function byteLen(s: string): number {
  let n = 0;
  for (const ch of String(s ?? "")) n += ch.charCodeAt(0) > 127 ? 2 : 1;
  return n;
}
/** 장문(LMS) 한도. 발송 시 수신거부 안내가 더 붙으므로 여유를 둔다. */
export const LMS_MAX_BYTES = 2000;
export const OPTOUT_RESERVE_BYTES = 120;
/** 문구를 넣었을 때 문자 길이가 한도를 넘는지 — 넘으면 그 루트는 건너뛴다. */
export function smsTooLong(bodyWithNotice: string): boolean {
  return byteLen(bodyWithNotice) > LMS_MAX_BYTES - OPTOUT_RESERVE_BYTES;
}
