// 틱톡샵 주간 온보딩 신청 — 입력 검증·주차 계산·문구 규칙·배선 감사(DB 없이).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  weekKey, normEmail, normPhone, normSite, EMAIL_RE,
  WEEKLY_STATUSES, WEEKLY_STATUS_LABEL, WEEKLY_SLOTS, WEEKLY_SOURCE,
} from "../lib/weekly-onboarding-model";
import {
  WEEKLY_DAY1_SMS_DRAFT, WEEKLY_FORBIDDEN_CLAIMS, WEEKLY_LINK_PLACEHOLDER,
} from "../lib/weekly-onboarding-copy";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/**
 * 주석을 걷어낸 "실제 코드"만 남긴다.
 *   설명 주석에 '마감'·'processIngest' 같은 말이 있다고 해서 그 동작을 한다는 뜻은 아니다 —
 *   감사는 코드를 봐야 한다(줄 통째 주석과 블록 주석만 지운다. 문자열 안의 // 는 건드리지 않는다).
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

describe("주차 계산(KST 월요일)", () => {
  it("주중 아무 날이나 그 주 월요일로 모인다", () => {
    expect(weekKey(new Date("2026-10-01T00:00:00Z"))).toBe("2026-09-28"); // 목(KST) → 월
    expect(weekKey(new Date("2026-09-28T00:00:00Z"))).toBe("2026-09-28");
    expect(weekKey(new Date("2026-10-04T13:00:00Z"))).toBe("2026-09-28"); // 일 22시 KST
  });
  it("월요일 0시 KST 를 넘기면 다음 주가 된다", () => {
    expect(weekKey(new Date("2026-10-04T14:59:00Z"))).toBe("2026-09-28"); // 일 23:59 KST
    expect(weekKey(new Date("2026-10-04T15:00:00Z"))).toBe("2026-10-05"); // 월 00:00 KST
  });
});

describe("입력 정규화·검증", () => {
  it("이메일은 소문자·공백 제거", () => {
    expect(normEmail("  A@B.CO.KR ")).toBe("a@b.co.kr");
  });
  it("전화는 숫자만 남긴다", () => {
    expect(normPhone("010-1234-5678")).toBe("01012345678");
    expect(normPhone("+82 10 1234 5678")).toBe("821012345678");
  });
  it("이메일 형식을 검사한다", () => {
    expect(EMAIL_RE.test("a@b.co")).toBe(true);
    expect(EMAIL_RE.test("a@b")).toBe(false);
    expect(EMAIL_RE.test("ab.co")).toBe(false);
  });
  it("사이트는 스킴 없이 적어도 받아들인다", () => {
    expect(normSite("brand.co.kr")).toEqual({ ok: true, value: "https://brand.co.kr/" });
    expect(normSite("https://a.com/shop")).toEqual({ ok: true, value: "https://a.com/shop" });
  });
  it("사이트는 선택 입력이라 비어도 통과한다", () => {
    expect(normSite("")).toEqual({ ok: true, value: "" });
  });
  it("형식이 아닌 사이트는 거절한다", () => {
    expect(normSite("그냥글자").ok).toBe(false);
    expect(normSite("http://").ok).toBe(false);
  });
});

describe("상태·출처", () => {
  it("연락 진행 상태는 계약·온보딩 단계와 겹치지 않는 이름이다", () => {
    expect(WEEKLY_STATUSES).toEqual(["new", "contacted", "scheduled", "done", "dropped"]);
    for (const s of WEEKLY_STATUSES) expect(WEEKLY_STATUS_LABEL[s]).toBeTruthy();
  });
  it("유입 출처를 따로 둔다", () => {
    expect(WEEKLY_SOURCE).toBe("weekly_onboarding");
  });
  it("모집 수는 안내값이다", () => {
    expect(WEEKLY_SLOTS).toBe(3);
  });
});

describe("1일차 추가 문구 — 초안으로만 둔다", () => {
  it("요청하신 문구 그대로다", () => {
    expect(WEEKLY_DAY1_SMS_DRAFT).toBe(
      "이번 주 틱톡샵 온보딩은 3개 브랜드 모집 중입니다. 세미나 전 상담·준비를 원하시면 신청해 주세요: [신청 링크]");
    expect(WEEKLY_DAY1_SMS_DRAFT).toContain(WEEKLY_LINK_PLACEHOLDER);
  });
  it("마감·잔여석·확정 같은 허위 표현이 없다", () => {
    for (const w of WEEKLY_FORBIDDEN_CLAIMS) {
      expect(WEEKLY_DAY1_SMS_DRAFT, w).not.toContain(w);
    }
  });
  it("발송 경로 어디에서도 이 초안을 가져다 쓰지 않는다", () => {
    for (const f of ["../lib/lead-sequence.ts", "../lib/lead-sequence-copy.ts", "../lib/sms.ts",
                     "../lib/intake-channels.ts", "../lib/seminar.ts", "../lib/seminar-test.ts",
                     "../lib/mailer.ts", "../lib/welcome.ts", "../lib/intro.ts"]) {
      expect(code(f), f).not.toContain("weekly-onboarding-copy");
    }
  });
  it("운영 문구(승인본)는 건드리지 않았다", () => {
    const copy = read("../lib/lead-sequence-copy.ts");
    expect(copy).not.toContain("주간 온보딩");
    expect(copy).not.toContain("3개 브랜드");
  });
});

describe("배선 감사", () => {
  it("0107 마이그레이션은 추가만 한다", () => {
    const sql = read("../migrations/0107_weekly_onboarding_apply.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS weekly_onb_applications");
    expect(sql).toContain("weekly_onb_dedupe_uniq");
    expect(sql.replace(/ON DELETE CASCADE/g, "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  });
  it("같은 사람·같은 주 중복 접수를 막는다", () => {
    const sql = read("../migrations/0107_weekly_onboarding_apply.sql");
    expect(sql).toMatch(/UNIQUE INDEX[\s\S]*?weekly_onb_applications \(dedupe_key, week_key\)/);
  });
  it("신청이 기존 고객·자동 캠페인으로 흘러가지 않는다", () => {
    for (const f of ["../lib/weekly-onboarding.ts", "../lib/weekly-onboarding-model.ts",
                     "../app/weekly/actions.ts",
                     "../app/(dash)/weekly-onboarding/actions.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/processIngest|enrollLead|maybeAutoWelcome|sendChannelWelcome/);
      expect(src, f).not.toMatch(/INSERT INTO brands|UPDATE brands/);
    }
  });
  it("신청·관리 경로에 고객 발송이 없다", () => {
    for (const f of ["../lib/weekly-onboarding.ts", "../app/weekly/actions.ts",
                     "../app/weekly/WeeklyApplyForm.tsx",
                     "../app/(dash)/weekly-onboarding/actions.ts", "../components/WeeklyOnbPanel.tsx"]) {
      expect(code(f), f).not.toMatch(/sendEmail|sendSms|sendMass|slackPost|notifyNewLead/);
    }
  });
  it("자동 선착순 확정·자동 마감 로직이 없다", () => {
    const lib = code("../lib/weekly-onboarding.ts") + code("../lib/weekly-onboarding-model.ts");
    // 접수 수를 모집 수와 "비교"하는 분기가 없어야 한다(선언의 = 는 비교가 아니다).
    const COMPARE = /WEEKLY_SLOTS\s*(<|>|===|!==|==)|(<|>|===|!==|==)\s*WEEKLY_SLOTS/;
    expect(lib).not.toMatch(COMPARE);
    expect(lib).not.toMatch(/마감|선착순/);
    // 관리 화면도 접수 수로 자동 마감하지 않는다.
    // 화면은 "자동 마감하지 않는다"고 적을 수 있다 — 막아야 하는 건 실제 비교 분기다.
    const panel = code("../components/WeeklyOnbPanel.tsx");
    expect(panel).not.toMatch(/slots\s*(<|>|===|!==|==)|(<|>|===|!==|==)\s*(ov\.)?slots/);
    expect(panel).not.toMatch(/total\s*(>=|>)\s*\d|마감되었습니다|접수 마감/);
  });
  it("공개 폼이 확정·완료를 약속하지 않는다", () => {
    const form = read("../app/weekly/WeeklyApplyForm.tsx");
    expect(form).toContain("계약·입점이 확정되거나");
    expect(form).toContain("보장하지는 않습니다");
    // 화면에 실제로 그려지는 문구에 잔여석·선착순 표현이 없어야 한다(주석은 제외).
    expect(code("../app/weekly/WeeklyApplyForm.tsx")).not.toMatch(/잔여|선착순|마감 임박|남은 자리/);
  });
  it("공개 폼은 is_test 를 받지 않는다", () => {
    const action = read("../app/weekly/actions.ts");
    expect(action).toContain("is_test 를 받지 않는다");
    expect(code("../app/weekly/actions.ts")).not.toMatch(/isTest:\s*input\./);
  });
  it("개인정보 안내는 기존 문구를 그대로 쓰고 보관기간을 새로 만들지 않는다", () => {
    const form = read("../app/weekly/WeeklyApplyForm.tsx");
    expect(form).toContain("관련 법령에 따라 처리됩니다");
    expect(form).not.toMatch(/\d+\s*(년|개월|일)\s*(간)?\s*보관/);
  });
  it("관리자 화면은 로그인을 요구하고 TEST 삭제는 대표·파트장만 가능하다", () => {
    const page = read("../app/(dash)/weekly-onboarding/page.tsx");
    expect(page).toContain("currentUser()");
    expect(page).toContain("robots");
    const actions = read("../app/(dash)/weekly-onboarding/actions.ts");
    const clear = actions.slice(actions.indexOf("export async function weeklyClearTestAction"));
    expect(clear.slice(0, 300)).toContain("ADMIN_ROLES");
  });
  it("클라이언트 화면은 pg 를 끌고 오는 모듈에서 값을 가져오지 않는다", () => {
    // "use client" 가 DB 모듈의 런타임 값을 import 하면 번들에 pg 가 섞여 빌드가 깨진다.
    const panel = code("../components/WeeklyOnbPanel.tsx");
    expect(panel).toContain('from "@/lib/weekly-onboarding-model"');
    expect(panel).not.toMatch(/from\s+"@\/lib\/weekly-onboarding"/);
    expect(code("../app/weekly/WeeklyApplyForm.tsx")).not.toMatch(/from\s+"@\/lib\/weekly-onboarding"/);
  });

  it("공개 경로가 로그인 리다이렉트에 걸리지 않는다", () => {
    const mw = read("../middleware.ts");
    expect(mw.match(/pathname\.startsWith\("\/weekly"\)/g)?.length).toBe(2);
  });
});
