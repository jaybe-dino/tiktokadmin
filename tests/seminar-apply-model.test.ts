// 「브랜드 해외매출 실행전략 세미나」 신청 — 순수 로직.
//   DB 없이 검증·정규화·보유기간·마스킹을 확인한다.
import { describe, it, expect } from "vitest";
import {
  SESSION_SPECS, CAP_STATUSES, STATUSES, SELECT_CAP_DEFAULT,
  formBlockers, toRow, normalizeEmail, normalizePhone, normalizeUrl,
  fmtSessionWhen, fmtSessionShort, maskEmail, maskPhone,
  requiredExpiryIso, adsExpiryIso, retentionSentence, ymdKst, retainedUntilKst, RETENTION_DEFAULT,
  ORG_DEFAULT, isSapStatus, type SapFormInput,
} from "../lib/seminar-apply-model";

const OK: SapFormInput = {
  sessionNo: 1,
  companyName: "TEST 합성회사",
  brandName: "TEST 합성브랜드",
  contactName: "TEST 담당자",
  jobRole: "해외영업",
  email: "Apply.Test@Example.invalid",
  productCategory: "뷰티·화장품",
  overseasStage: "준비 중(상품·인증 점검)",
  targetCountries: ["일본"],
  question: "일본 TikTok Shop 가격 구조가 궁금합니다.",
  consentRequired: true,
};

describe("회차", () => {
  it("확정된 4회차가 10/13·16·20·23 이다", () => {
    expect(SESSION_SPECS.map((s) => s.date)).toEqual(
      ["2026-10-13", "2026-10-16", "2026-10-20", "2026-10-23"]);
    expect(SESSION_SPECS.map((s) => s.no)).toEqual([1, 2, 3, 4]);
  });

  it("저장된 UTC 시각을 KST 11:00~12:00 으로 보여준다", () => {
    expect(fmtSessionWhen("2026-10-13T02:00:00Z", "2026-10-13T03:00:00Z"))
      .toBe("2026년 10월 13일(화) 11:00~12:00");
    expect(fmtSessionShort("2026-10-16T02:00:00Z")).toBe("10/16 (금)");
    expect(fmtSessionShort("2026-10-23T02:00:00Z")).toBe("10/23 (금)");
  });
});

describe("상태", () => {
  it("상태는 5가지다", () => {
    expect([...STATUSES]).toEqual(["submitted", "selected", "waitlisted", "not_selected", "cancelled"]);
  });

  it("선정 상한을 차지하는 상태는 선정뿐이다 — 접수는 좌석을 점유하지 않는다", () => {
    expect(CAP_STATUSES).toEqual(["selected"]);
    expect(CAP_STATUSES).not.toContain("submitted");
    expect(CAP_STATUSES).not.toContain("waitlisted");
  });

  it("기존 세미나 모집 허브의 좌석 정책과 섞이지 않는다", async () => {
    // 기존 REG_OCCUPYING 은 applied 를 포함한다 — 그쪽 동작은 그대로 둬야 한다.
    const { REG_OCCUPYING } = await import("../lib/seminar-events-model");
    expect([...REG_OCCUPYING]).toContain("applied");
    expect(CAP_STATUSES).not.toEqual([...REG_OCCUPYING]);
  });

  it("기본 선정 상한은 30 이다", () => {
    expect(SELECT_CAP_DEFAULT).toBe(30);
  });

  it("목록에 없는 상태값은 받지 않는다", () => {
    expect(isSapStatus("selected")).toBe(true);
    expect(isSapStatus("applied")).toBe(false);
    expect(isSapStatus("confirmed")).toBe(false);
  });
});

describe("필수 항목 검증", () => {
  it("올바른 입력은 통과한다", () => {
    expect(formBlockers(OK)).toEqual([]);
  });

  it("회차를 고르지 않으면 막는다", () => {
    expect(formBlockers({ ...OK, sessionNo: undefined })[0]).toContain("회차");
  });

  it("필수 동의가 없으면 막는다", () => {
    const b = formBlockers({ ...OK, consentRequired: false });
    expect(b).toHaveLength(1);
    expect(b[0]).toContain("개인정보 수집·이용(필수)");
  });

  it("광고·선택 동의가 없어도 신청은 통과한다", () => {
    expect(formBlockers({ ...OK, consentAds: false, consentOptional: false })).toEqual([]);
    expect(formBlockers({ ...OK, consentAds: true, consentOptional: true })).toEqual([]);
  });

  it("브랜드명은 미보유를 고르면 비워도 된다", () => {
    expect(formBlockers({ ...OK, brandName: "", noBrand: true })).toEqual([]);
    expect(formBlockers({ ...OK, brandName: "", noBrand: false })[0]).toContain("브랜드");
  });

  it("각 필수 항목이 빠지면 각각 막는다", () => {
    const cases: [keyof SapFormInput, string][] = [
      ["companyName", "회사명"],
      ["contactName", "담당자명"],
      ["jobRole", "직무"],
      ["email", "이메일"],
      ["productCategory", "상품 카테고리"],
      ["overseasStage", "해외진출 단계"],
      ["question", "질문"],
    ];
    for (const [k, word] of cases) {
      const b = formBlockers({ ...OK, [k]: "" });
      expect(b.join(" "), k).toContain(word);
    }
    expect(formBlockers({ ...OK, targetCountries: [] })[0]).toContain("희망 국가");
  });

  it("희망 국가는 ‘아직 미정’도 고를 수 있다", () => {
    expect(formBlockers({ ...OK, targetCountries: ["아직 미정"] })).toEqual([]);
  });

  it("목록 밖의 선택값은 거부한다", () => {
    expect(formBlockers({ ...OK, jobRole: "CTO" })[0]).toContain("직무");
    expect(formBlockers({ ...OK, targetCountries: ["화성"] })[0]).toContain("희망 국가");
    expect(formBlockers({ ...OK, revenueBand: "아무값" })[0]).toContain("매출 구간");
  });

  it("이메일 형식을 확인한다", () => {
    expect(formBlockers({ ...OK, email: "notmail" })[0]).toContain("이메일");
    expect(formBlockers({ ...OK, email: "a@b" })[0]).toContain("이메일");
  });

  it("주민번호·주소·파일 항목은 모델에 없다", () => {
    const keys = Object.keys(toRow(OK));
    for (const bad of ["ssn", "rrn", "residentNo", "address", "file", "upload"]) {
      expect(keys.some((k) => k.toLowerCase().includes(bad.toLowerCase())), bad).toBe(false);
    }
  });
});

describe("정규화", () => {
  it("이메일은 소문자로 모은다(중복 판정 기준)", () => {
    expect(normalizeEmail(" Apply.TEST@Example.INVALID ")).toBe("apply.test@example.invalid");
    expect(toRow(OK).emailNorm).toBe("apply.test@example.invalid");
  });

  it("전화는 숫자만 남기고 국제표기도 같은 값으로 만든다", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone("+82 10 1234 5678")).toBe("01012345678");
    expect(normalizePhone("")).toBe("");
  });

  it("URL 은 스킴을 붙이고, http(s) 가 아니면 버린다", () => {
    expect(normalizeUrl("brand.com")).toBe("https://brand.com/");
    expect(normalizeUrl("https://brand.com/a")).toBe("https://brand.com/a");
    expect(normalizeUrl("javascript:alert(1)")).toBe("");
    expect(normalizeUrl("")).toBe("");
  });

  it("브랜드 미보유를 고르면 입력한 브랜드명을 버린다", () => {
    expect(toRow({ ...OK, brandName: "지워질 값", noBrand: true }).brandName).toBe("");
  });

  it("직무가 기타가 아니면 기타 입력값을 버린다", () => {
    expect(toRow({ ...OK, jobRole: "대표", jobRoleEtc: "남으면 안 됨" }).jobRoleEtc).toBe("");
    expect(toRow({ ...OK, jobRole: "기타", jobRoleEtc: "운영총괄" }).jobRoleEtc).toBe("운영총괄");
  });

  it("복수 선택은 목록에 있는 값만 남긴다", () => {
    const r = toRow({ ...OK, targetCountries: ["일본", "화성", "미국"], supportAreas: ["물류·통관", "없는항목"] });
    expect(r.targetCountries).toBe("일본, 미국");
    expect(r.supportAreas).toBe("물류·통관");
  });
});

describe("보유기간", () => {
  it("필수정보는 마지막 회차 종료 후 3개월이다", () => {
    const iso = requiredExpiryIso(RETENTION_DEFAULT);
    expect(iso).toBeTruthy();
    // 저장값은 2027-01-23 이 끝나는 순간이고, 보유 마지막 날은 2027-01-23 이다.
    expect(retainedUntilKst(iso!)).toBe("2027-01-23");
    expect(ymdKst(iso!)).toBe("2027-01-24");
  });

  it("광고 동의는 동의일로부터 1년이다", () => {
    const iso = adsExpiryIso(new Date("2026-10-07T05:00:00Z"), RETENTION_DEFAULT);
    expect(iso.slice(0, 10)).toBe("2027-10-07");
  });

  it("동의문 문장에 구체 기간이 들어간다", () => {
    const s = retentionSentence(RETENTION_DEFAULT);
    expect(s.required).toContain("2026-10-23");
    expect(s.required).toContain("3개월");
    expect(s.required).toContain("2027-01-23");
    expect(s.ads).toContain("1년");
    expect(s.ads).toContain("철회");
  });
});

describe("운영자·문의처 표시", () => {
  it("공개된 실제 값을 쓴다", () => {
    expect(ORG_DEFAULT.legalName).toBe("디노스튜디오");
    expect(ORG_DEFAULT.repName).toContain("허정발");
    expect(ORG_DEFAULT.contactEmail).toBe("chief@dinostudio.kr");
    expect(ORG_DEFAULT.contactPhone).toBe("010-5663-1273");
    expect(ORG_DEFAULT.address).toContain("사임당로26");
  });

  it("확인되지 않은 사업자등록번호는 비워 둔다(지어내지 않는다)", () => {
    expect(ORG_DEFAULT.bizNo).toBe("");
  });
});

describe("마스킹", () => {
  it("관리 목록에는 가린 값을 쓴다", () => {
    expect(maskEmail("applicant@example.invalid")).toBe("ap*******@example.invalid");
    expect(maskPhone("01012345678")).toBe("010****78");
    expect(maskPhone("")).toBe("");
  });
});
