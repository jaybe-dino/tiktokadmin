// 1일차 "주간 슬롯" 안내 — 문구 조립·되돌리기·배선 감사(DB 없이).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  WEEKLY_SLOT_COUNT, WEEKLY_APPLY_URL, DAY1_SMS_BLOCK, DAY1_EMAIL_BLOCK,
  FORBIDDEN_CLAIMS, hasDay1Notice, withDay1Notice, withoutDay1Notice,
  byteLen, smsTooLong, LMS_MAX_BYTES, OPTOUT_RESERVE_BYTES, noticeBlock,
} from "../lib/weekly-day1-notice";
import { APPROVED_COPY } from "../lib/lead-sequence-copy";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** 설명 주석을 걷어낸 실제 코드만 본다. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

describe("문구", () => {
  it("주간 슬롯이 3개라는 점을 문자·메일 양쪽에서 말한다", () => {
    expect(WEEKLY_SLOT_COUNT).toBe(3);
    expect(DAY1_SMS_BLOCK).toContain("주간 슬롯 3개");
    expect(DAY1_EMAIL_BLOCK).toContain("주간 슬롯 3개");
  });
  it("신청 주소가 들어 있다", () => {
    expect(WEEKLY_APPLY_URL).toBe("https://admin.glovek.space/weekly");
    expect(DAY1_SMS_BLOCK).toContain(WEEKLY_APPLY_URL);
    expect(DAY1_EMAIL_BLOCK).toContain(WEEKLY_APPLY_URL);
  });
  it("시스템이 보장하지 못하는 표현을 쓰지 않는다", () => {
    for (const w of FORBIDDEN_CLAIMS) {
      expect(DAY1_SMS_BLOCK, w).not.toContain(w);
      expect(DAY1_EMAIL_BLOCK, w).not.toContain(w);
    }
  });
  it("치환변수를 쓰지 않는다(브랜드명 없는 리드도 있다)", () => {
    expect(DAY1_SMS_BLOCK).not.toMatch(/\{[^}]+\}/);
    expect(DAY1_EMAIL_BLOCK).not.toMatch(/\{[^}]+\}/);
  });
  it("종류에 맞는 블록을 돌려준다", () => {
    expect(noticeBlock("sms")).toBe(DAY1_SMS_BLOCK);
    expect(noticeBlock("email")).toBe(DAY1_EMAIL_BLOCK);
  });
});

describe("넣기", () => {
  const sms = "[GloveK]\n안내드립니다.\n▶ 상담\nhttps://example.invalid/consult";
  const mail = "안녕하세요.\n\n본문입니다.\n\n디노스튜디오 GloveK 드림";

  it("문자는 본문 끝에 붙는다", () => {
    const out = withDay1Notice(sms, "sms");
    expect(out.startsWith(sms)).toBe(true);
    expect(out.endsWith(DAY1_SMS_BLOCK)).toBe(true);
  });
  it("메일은 서명 앞에 들어간다", () => {
    const out = withDay1Notice(mail, "email");
    expect(out.endsWith("디노스튜디오 GloveK 드림")).toBe(true);
    expect(out.indexOf(DAY1_EMAIL_BLOCK)).toBeGreaterThan(out.indexOf("본문입니다."));
    expect(out.indexOf(DAY1_EMAIL_BLOCK)).toBeLessThan(out.indexOf("GloveK 드림"));
  });
  it("서명이 없으면 메일도 끝에 붙는다", () => {
    const out = withDay1Notice("안녕하세요.\n본문뿐입니다.", "email");
    expect(out.endsWith(DAY1_EMAIL_BLOCK)).toBe(true);
  });
  it("여러 번 넣어도 한 번만 들어간다", () => {
    const once = withDay1Notice(sms, "sms");
    expect(withDay1Notice(once, "sms")).toBe(once);
    expect(withDay1Notice(withDay1Notice(once, "sms"), "sms")).toBe(once);
    expect(once.split(WEEKLY_APPLY_URL)).toHaveLength(2);
  });
  it("빈 본문에는 문구만 남기지 않는다", () => {
    expect(withDay1Notice("", "sms")).toBe("");
    expect(withDay1Notice("   \n ", "email")).toBe("   \n ");
  });
  it("들어 있는지 알아본다", () => {
    expect(hasDay1Notice(sms)).toBe(false);
    expect(hasDay1Notice(withDay1Notice(sms, "sms"))).toBe(true);
  });
  it("원문의 다른 링크·줄바꿈을 건드리지 않는다", () => {
    const out = withDay1Notice(sms, "sms");
    expect(out).toContain("https://example.invalid/consult");
    expect(out.split("\n").slice(0, 4).join("\n")).toBe(sms);
  });
});

describe("되돌리기", () => {
  const sms = "[GloveK]\n안내드립니다.\n▶ 상담\nhttps://example.invalid/consult";
  const mail = "안녕하세요.\n\n본문입니다.\n\n디노스튜디오 GloveK 드림";

  it("넣기 → 빼기를 하면 원문으로 돌아온다", () => {
    for (const [body, kind] of [[sms, "sms"], [mail, "email"]] as const) {
      const added = withDay1Notice(body, kind);
      const back = withoutDay1Notice(added, kind);
      expect(back.found, kind).toBe(true);
      expect(back.body, kind).toBe(body);
    }
  });
  it("들어 있지 않으면 아무것도 하지 않는다", () => {
    const r = withoutDay1Notice(sms, "sms");
    expect(r.found).toBe(false);
    expect(r.body).toBe(sms);
  });
  it("사람이 손으로 고친 문구는 추측해서 지우지 않는다", () => {
    const edited = `${sms}\n\n틱톡샵 온보딩 신청은 여기로: ${WEEKLY_APPLY_URL}`;
    const r = withoutDay1Notice(edited, "sms");
    expect(r.found).toBe(false);          // 못 찾았다고 알린다
    expect(r.body).toBe(edited);          // 본문은 그대로 둔다
  });
});

describe("길이", () => {
  it("한글 2바이트로 센다", () => {
    expect(byteLen("abc")).toBe(3);
    expect(byteLen("가나")).toBe(4);
    expect(byteLen("")).toBe(0);
  });
  it("수신거부 안내가 더 붙는 몫을 남겨 둔다", () => {
    expect(OPTOUT_RESERVE_BYTES).toBeGreaterThan(0);
    expect(smsTooLong("가".repeat(100))).toBe(false);
    expect(smsTooLong("가".repeat(LMS_MAX_BYTES))).toBe(true);
  });
});

describe("승인 문안(1~4일차)", () => {
  const day = (n: number) => APPROVED_COPY.find((c) => c.day_no === n)!;
  it("1일차 문자·메일에 안내가 들어 있다", () => {
    expect(day(1).sms_body).toContain(DAY1_SMS_BLOCK);
    expect(day(1).email_body).toContain(DAY1_EMAIL_BLOCK);
  });
  it("1일차 원래 내용(가이드북·상담 예약)이 그대로 남아 있다", () => {
    expect(day(1).sms_body).toContain("https://glovek.space/guidebook");
    expect(day(1).sms_body).toContain("https://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2");
    expect(day(1).email_body).toContain("https://glovek.space/guidebook");
    expect(day(1).email_body.trim().endsWith("디노스튜디오 GloveK 드림")).toBe(true);
  });
  it("2~4일차는 건드리지 않았다", () => {
    for (const n of [2, 3, 4]) {
      expect(day(n).sms_body, String(n)).not.toContain(WEEKLY_APPLY_URL);
      expect(day(n).email_body, String(n)).not.toContain(WEEKLY_APPLY_URL);
    }
  });
  it("1일차 문자가 장문 한도 안에 있다", () => {
    expect(smsTooLong(day(1).sms_body)).toBe(false);
  });
});

describe("배선 감사", () => {
  const lib = code("../lib/lead-sequence-day1.ts");

  it("1일차만, 문자·메일 본문 두 칸만 바꾼다", () => {
    const updates = [...lib.matchAll(/UPDATE\s+(\w+)[\s\S]*?WHERE[^`]*/g)].map((m) => m[0]);
    expect(updates).toHaveLength(1);
    const u = updates[0];
    expect(u).toContain("lead_sequence_steps");
    expect(u).toContain("day_no = 1");
    expect(u).toContain("sms_body = $2");
    expect(u).toContain("email_body = $3");
    // 발송 토글·시각·켜짐 여부는 UPDATE 문에 아예 없다.
    for (const col of ["enabled", "send_sms", "send_email", "send_hour", "email_subject"]) {
      expect(u, col).not.toMatch(new RegExp(`\\b${col}\\s*=`));
    }
  });
  it("읽기도 1일차만 본다", () => {
    expect(lib).toContain("WHERE s.day_no = 1");
  });
  it("발송·수신거부 모듈을 가져다 쓰지 않는다", () => {
    for (const m of ['"./sms"', '"./mailer"', '"./ad-optout"', '"./ingest"', '"./bulk-send"', '"./templates"']) {
      expect(lib, m).not.toContain(m);
    }
    expect(lib).not.toMatch(/sendSms|sendMail|sendBulk/);
  });
  it("다른 표를 쓰지 않는다(연속 안내 회차 + 유입 루트 이름뿐)", () => {
    const names = [...lib.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1].toLowerCase());
    for (const n of new Set(names)) {
      expect(["lead_sequence_steps", "intake_channels"], n).toContain(n);
    }
  });
  it("저장 후 다시 읽어 대조한다", () => {
    expect(lib).toContain("mismatch");
    expect(lib).toMatch(/loadDay1\(\)[\s\S]{0,400}mismatch\.push/);
  });
  it("미리보기(dryRun)에서는 저장하지 않는다", () => {
    expect(lib).toMatch(/if \(opts\.dryRun\) return report;/);
    const save = lib.indexOf("UPDATE lead_sequence_steps");
    const guard = lib.indexOf("if (opts.dryRun) return report;");
    expect(guard).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(guard);     // 저장은 반드시 가드 뒤에 있다
  });

  it("관리자 화면은 순수 모듈만 가져온다(pg 를 끌고 오지 않게)", () => {
    const panel = code("../components/WeeklyDay1NoticePanel.tsx");
    expect(panel).toContain('from "@/lib/weekly-day1-notice"');
    expect(panel).toMatch(/import type \{ Day1Report \} from "@\/lib\/lead-sequence-day1"/);
    expect(panel).not.toMatch(/import \{[^}]*\} from "@\/lib\/lead-sequence-day1"/);
    expect(panel).not.toContain('from "@/lib/db"');
  });
  it("관리자 화면이 미리보기 → 적용 순서를 강제한다", () => {
    const panel = code("../components/WeeklyDay1NoticePanel.tsx");
    expect(panel).toMatch(/disabled=\{pending \|\| !rep \|\| rep\.mode !== "apply" \|\| !rep\.dryRun\}/);
  });
  it("액션은 파트장·대표만 쓸 수 있다", () => {
    const act = code("../app/(dash)/channels/sequence-actions.ts");
    const i = act.indexOf("export async function day1NoticeAction");
    expect(i).toBeGreaterThan(0);
    expect(act.slice(i, i + 400)).toContain("canEdit(u.role)");
  });
  it("문구 원본이 한 곳에만 있다", () => {
    // 승인 문안도 같은 모듈에서 가져다 쓴다 — 두 곳에 따로 적어 두지 않는다.
    expect(code("../lib/lead-sequence-copy.ts")).toContain('from "./weekly-day1-notice"');
    const copy = read("../lib/lead-sequence-copy.ts");
    expect(copy).not.toContain("주간 슬롯 3개로 진행됩니다");
  });
});
