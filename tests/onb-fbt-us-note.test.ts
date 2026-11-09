// 미국 FBT 안내 — 보내준 문구가 온보딩 신청서 미국 블록에 그대로 떠야 한다.
//   "FBT 로 하면 창고 계약이 필요 없다" 는 오해를 막는 것이 목적이므로,
//   순서(창고 계약 먼저 → 샵 개설 → FBT 신청)가 담긴 두 문장을 모두 확인한다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  fbtNoteFor, FBT_NOTE_COUNTRIES, FBT_US_NOTE,
  fbtAvailable, FBT_BLOCKED_COUNTRIES, FBT_BLOCKED_NOTE,
} from "../lib/onb-constants";

const applyForm = readFileSync(new URL("../app/apply/ApplyForm.tsx", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../lib/onboarding.ts", import.meta.url), "utf8");

describe("미국 FBT 안내 문구", () => {
  it("미국에서만 띄운다", () => {
    expect(fbtNoteFor("US")).toBe(true);
    expect(fbtNoteFor("us")).toBe(true);
    ["JP", "TH", "VN", "MY", "SG", "PH", "", "XX"].forEach((c) => {
      expect(fbtNoteFor(c), c).toBe(false);
    });
    expect([...FBT_NOTE_COUNTRIES]).toEqual(["US"]);
  });

  it("문구가 받은 그대로다 — 요약하거나 고치지 않는다", () => {
    expect(FBT_US_NOTE).toEqual([
      "FBT는 미국 내 지정 창고에 재고를 미리 입고하면, 틱톡이 상품 보관부터 피킹·포장·고객 배송까지 처리하는 서비스입니다.",
      "다만, 미국 틱톡샵 입점 시에는 미국 물류창고 계약서가 필수로 요구되므로, 먼저 현지 물류창고와 계약을 진행해야 합니다. 이후 샵 개설이 완료되면 FBT를 신청하여 이용하실 수 있습니다.",
    ]);
  });

  it("오해의 핵심(창고 계약이 먼저, 신청은 샵 개설 뒤)이 들어 있다", () => {
    const all = FBT_US_NOTE.join(" ");
    expect(all).toContain("미국 물류창고 계약서가 필수");
    expect(all).toContain("먼저 현지 물류창고와 계약");
    expect(all).toContain("샵 개설이 완료되면 FBT를 신청");
  });

  it("신청서에서 국가별로 걸러 보여준다", () => {
    expect(applyForm).toContain("fbtNoteFor(c.country_code)");
    expect(applyForm).toContain("FBT_US_NOTE.map");
    expect(applyForm).toContain("미국 FBT(Fulfilled by TikTok) 안내");
  });

  it("희망 체크보다 위에 있어야 체크 전에 읽는다", () => {
    expect(applyForm.indexOf("FBT_US_NOTE.map"))
      .toBeLessThan(applyForm.indexOf("<FbtInterest code={c.country_code}"));
  });

  it("문구를 신청서에 다시 하드코딩하지 않는다(한곳에서 고치게)", () => {
    expect(applyForm).not.toContain("지정 창고에 재고를 미리 입고");
  });
});

describe("일본은 FBT 희망 체크를 보여주지 않는다", () => {
  it("일본만 막는다", () => {
    expect(fbtAvailable("JP")).toBe(false);
    expect(fbtAvailable("jp")).toBe(false);
    ["US", "TH", "VN", "MY", "SG", "PH"].forEach((c) => {
      expect(fbtAvailable(c), c).toBe(true);
    });
    expect([...FBT_BLOCKED_COUNTRIES]).toEqual(["JP"]);
  });

  it("사유를 사람이 읽을 수 있게 적는다", () => {
    expect(FBT_BLOCKED_NOTE).toContain("일본");
    expect(FBT_BLOCKED_NOTE).toContain("FBT");
  });

  it("신청서에서 체크 자체를 렌더하지 않는다", () => {
    expect(applyForm).toMatch(/fbtAvailable\(c\.country_code\) && \(\s*<FbtInterest/);
  });

  it("서버에서도 막는다 — 화면을 우회해도 켜지지 않는다", () => {
    expect(onboarding).toMatch(/want && !fbtAvailable\(cc\)/);
    expect(onboarding).toContain("FBT_BLOCKED_NOTE");
  });

  it("해제는 막지 않는다 — 과거에 켜 둔 값을 되돌릴 수 있어야 한다", () => {
    // 가드가 want=true 일 때만 걸리는지 소스로 확인한다.
    expect(onboarding).not.toMatch(/if \(!fbtAvailable\(cc\)\) \{/);
  });
});
