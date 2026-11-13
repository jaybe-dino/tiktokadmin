// BUG-51·52·53·54·55·56·57 — 제보대로 고쳐졌는지 고정한다.
//   화면 코드는 소스에서 의도를 확인하고, 규칙은 실제 함수로 확인한다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  detailPageLabel, COUNTRY_LANG, fbaAllowed, FBA_BLOCKED_COUNTRIES,
  FBA_BLOCKED_NOTE, ADDRESS_PROOF_NOTICE, PASSPORT_GUIDE,
} from "../lib/onb-constants";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const applyForm = read("app/apply/ApplyForm.tsx");
const review = read("app/(dash)/onboarding/[customerId]/ReviewClient.tsx");
const queries = read("lib/repo/queries.ts");
const onboarding = read("lib/onboarding.ts");

describe("BUG-51 — 국가별 상세페이지는 그 나라 언어로 적는다", () => {
  it("베트남이면 상세페이지(베트남어)", () => {
    expect(detailPageLabel("VN")).toBe("상세페이지(베트남어)");
  });

  it("국가마다 다른 언어가 나온다", () => {
    expect(detailPageLabel("JP")).toBe("상세페이지(일본어)");
    expect(detailPageLabel("TH")).toBe("상세페이지(태국어)");
    expect(detailPageLabel("MY")).toBe("상세페이지(말레이어)");
    expect(detailPageLabel("US")).toBe("상세페이지(영어)");
  });

  it("소문자 코드도 받는다", () => {
    expect(detailPageLabel("vn")).toBe("상세페이지(베트남어)");
  });

  it("모르는 국가는 '현지어' 로 둔다 — 영문이라고 단정하지 않는다", () => {
    expect(detailPageLabel("XX")).toBe("상세페이지(현지어)");
    expect(detailPageLabel("")).toBe("상세페이지(현지어)");
  });

  it("입점 가능 국가 전부에 언어가 정해져 있다", () => {
    ["US", "JP", "TH", "VN", "MY", "SG", "PH"].forEach((c) => {
      expect(COUNTRY_LANG[c], c).toBeTruthy();
    });
  });

  it("신청서 표에서 국가별 라벨을 쓴다(영문 고정 표기를 지웠다)", () => {
    expect(applyForm).toContain("detailPageLabel(country)");
    expect(applyForm).toContain("상세페이지(현지어)");
    // 머리글에 "상세페이지(영문)" 를 다시 박아 넣으면 국가별 안내가 사라진다.
    expect(applyForm).not.toContain("상세페이지(영문)");
  });

  it("한글본과 현지어본이 서로 덮어쓰지 않는다(업로드 키가 다르다)", () => {
    expect(applyForm).toContain("`detail_en_${country}`");
    expect(applyForm).toContain("`detail_${country}`");
  });
});

describe("BUG-52 — 담당자 전화번호로도 검색된다", () => {
  it("브랜드 전화·담당자 전화를 함께 본다", () => {
    expect(queries).toContain("b.phone ILIKE");
    expect(queries).toMatch(/brand_contacts bc\b[\s\S]{0,200}bc\.phone ILIKE/);
  });

  it("하이픈이 달라도 찾도록 숫자만 남겨 비교한다", () => {
    expect(queries).toMatch(/regexp_replace\(coalesce\(b\.phone[\s\S]{0,40}LIKE/);
    expect(queries).toMatch(/regexp_replace\(coalesce\(bc2\.phone[\s\S]{0,40}LIKE/);
  });

  it("담당자 이름·이메일도 같은 검색어로 찾는다", () => {
    expect(queries).toContain("b.contact_name ILIKE");
    expect(queries).toContain("bc.name ILIKE");
    expect(queries).toContain("bc.email ILIKE");
  });

  it("검색창 안내에 전화번호를 적었다", () => {
    expect(read("app/(dash)/customers/page.tsx")).toContain("전화번호 검색");
  });
});

describe("BUG-53 — 거주지 증명서류는 전체 주소가 보여야 한다", () => {
  it("안내 문구가 제보 내용 그대로다", () => {
    expect(ADDRESS_PROOF_NOTICE).toContain("마스킹되지 않도록");
    expect(ADDRESS_PROOF_NOTICE).toContain("동·호수까지 전체 주소");
  });

  it("업로드 칸에 그 문구를 띄운다", () => {
    expect(applyForm).toContain("ADDRESS_PROOF_NOTICE");
    // 업로드 필드보다 앞에 있어야 발급 전에 읽는다.
    expect(applyForm.indexOf("ADDRESS_PROOF_NOTICE"))
      .toBeLessThan(applyForm.indexOf('k="rep_address_proof_url"'));
  });
});

describe("BUG-54 — 어드민 제품등록 옆에 총 개수", () => {
  it("4번 단계에만 개수를 붙인다", () => {
    expect(review).toMatch(/s\.step_no === 4 && \([\s\S]{0,300}총 \{props\.products\.length\}개/);
  });

  it("제보한 모양(> 총 N개)을 쓴다", () => {
    expect(review).toContain("&gt; 총 {props.products.length}개");
  });
});

describe("BUG-55 — 일본은 FBA 를 쓸 수 없다", () => {
  it("일본만 막는다", () => {
    expect(fbaAllowed("JP")).toBe(false);
    expect(fbaAllowed("jp")).toBe(false);
    ["US", "TH", "VN", "MY", "SG", "PH"].forEach((c) => {
      expect(fbaAllowed(c), c).toBe(true);
    });
    expect([...FBA_BLOCKED_COUNTRIES]).toEqual(["JP"]);
  });

  it("사유를 사람이 읽을 수 있게 적는다", () => {
    expect(FBA_BLOCKED_NOTE).toContain("일본");
    expect(FBA_BLOCKED_NOTE).toContain("FBA");
  });

  it("고를 수 있는 목록에서 뺀다", () => {
    expect(applyForm).toMatch(/filter\(\(\[val\]\) => val !== "fba" \|\| fbaAllowed\(c\.country_code\)/);
  });

  it("이미 FBA 로 저장된 과거 값은 감추지 않는다", () => {
    // 조용히 "선택 안 함" 으로 보이면 저장된 값과 화면이 어긋난다.
    expect(applyForm).toContain('|| opt === "fba"');
  });

  it("서버에서도 막는다 — 화면을 우회해도 저장되지 않는다", () => {
    expect(onboarding).toMatch(/option === "fba" && !fbaAllowed\(cc\)/);
    expect(onboarding).toContain("FBA_BLOCKED_NOTE");
  });

  it("거절 사유를 화면에 띄운다(조용히 넘어가지 않는다)", () => {
    expect(applyForm).toMatch(/setCountryLogisticsOptionAction\([\s\S]{0,120}if \(!r\.ok\)/);
  });
});

describe("BUG-56 — Step 1 만 쓰고 멈추지 않게 다음 단계로 보낸다", () => {
  it("다음 단계 이동 버튼이 있다", () => {
    expect(applyForm).toContain("작성하기 →");
    expect(applyForm).toContain("function goNext()");
  });

  it("잠긴 단계로는 보내지 않는다", () => {
    expect(applyForm).toMatch(/if \(!nextStep \|\| nextStep\.status === "locked"\) return;/);
    expect(applyForm).toContain("이 단계가 승인되면 열립니다");
  });

  it("마지막 단계에서는 버튼을 만들지 않는다", () => {
    expect(applyForm).toContain("active + 1 < steps.length ? steps[active + 1] : null");
  });

  it("남은 단계 수를 알려 준다", () => {
    expect(applyForm).toContain("remainingOpen");
    expect(applyForm).toContain("남아 있습니다");
  });
});

describe("BUG-57 — 여권 촬영 예시", () => {
  it("촬영 기준을 한곳에 둔다", () => {
    expect(PASSPORT_GUIDE.length).toBeGreaterThanOrEqual(3);
    expect(PASSPORT_GUIDE.join(" ")).toContain("사진·인적사항");
  });

  it("여권 카드에서 예시를 보여준다", () => {
    expect(applyForm).toContain("PassportExample");
    expect(applyForm).toContain("여권 촬영 예시");
    // 예시는 업로드 칸보다 앞에 있어야 찍기 전에 읽는다.
    expect(applyForm.indexOf("PassportExample"))
      .toBeLessThan(applyForm.indexOf('k="rep_passport_front_url"'));
  });

  it("예시는 외부 이미지를 받아오지 않는다(가상 재현 목업)", () => {
    const ex = read("components/PassportExample.tsx");
    expect(ex).not.toMatch(/<img|src=|https?:\/\//);
    expect(ex).toContain("예시값");
    // 실제 사람 이름·번호를 쓰지 않는다.
    expect(ex).toContain("GILDONG");
  });
});

describe("BUG-47~50 — 이전 수정이 그대로 남아 있다", () => {
  it("사업자등록증(한글)은 받지 않는다(BUG-47)", () => {
    expect(onboarding).toContain("사업자등록증(한글)은 받지 않는다");
  });

  it("첨부는 다운로드로 열린다(BUG-48)", () => {
    expect(read("lib/onb-file-link.ts")).toContain("download");
  });

  it("입점 희망 국가에 일본이 있다(BUG-49)", () => {
    expect(applyForm).toContain('["JP", "일본"]');
  });

  it("일본어 라벨 사진 규격이 그대로다(BUG-50)", () => {
    const c = read("lib/onb-constants.ts");
    expect(c).toContain("JP_LABEL_MAX_COUNT = 10");
    expect(c).toContain("JP_LABEL_MIN_PX = 600");
    expect(c).toMatch(/JP_LABEL_MAX_BYTES = 5 \* 1024 \* 1024/);
  });
});
