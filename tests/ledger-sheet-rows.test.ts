// 원장 → 시트 행 변환. 순수 로직이라 DB·네트워크 없이 본다.
import { describe, it, expect } from "vitest";
import {
  safeText, phoneText, kstText, kstSerial, dateCell, UNKNOWN, DATE_AS_SERIAL,
  revenueCells, commsCells, buildRow, ledgerLink, ledgerFlags,
  isUnknownCell, keepExisting, normHeader,
  MANAGED_HEADERS, PROTECTED_HEADERS, REQUIRED_HEADERS, ID_HEADER, LOG_HEADERS,
  type LedgerBrand,
} from "../lib/ledger-sheet-rows";

const OPTS = {
  adminUrl: "https://admin.example.invalid",
  collectedAt: "2026-10-29T00:00:00.000Z",
  stateLabel: (s: string | null) => (s === "lead_new" ? "신규 리드" : s ?? ""),
  sourceLabel: (s: string | null) => (s === "apply_seminar" ? "apply 세미나" : s ?? ""),
  planLabel: (p: string | null, pay: string | null) => [p, pay].filter(Boolean).join(" · "),
};

const BRAND: LedgerBrand = {
  id: "11111111-1111-1111-1111-111111111111",
  brand_name: "TEST 합성브랜드", contact_name: "TEST 담당자",
  phone: "010-1234-5678", email: "lead@example.invalid",
  category: "뷰티", brand_url: "https://brand.example.invalid",
  state: "lead_new", source: "apply_seminar", plan: null, pay_status: "none",
  owner_label: "TEST 담당", created_at: "2026-10-01T01:00:00Z", updated_at: "2026-10-20T05:00:00Z",
  comms: {},
};

describe("값 보존 — 쓰기는 RAW 라 수식이 되지 않는다", () => {
  it("= + - @ 로 시작하는 값을 고치지 않고 그대로 둔다", () => {
    // RAW 쓰기는 보낸 값을 해석하지 않는다. 여기서 작은따옴표를 붙이면
    // 그 따옴표가 값의 일부로 저장되어 실제 데이터가 망가진다.
    for (const raw of ["=1+1", "+82 10-1234-5678", "-1", "@SUM(A1)"]) {
      expect(safeText(raw), raw).toBe(raw);
      expect(safeText(raw).startsWith("'"), raw).toBe(false);
    }
  });

  it("평범한 값은 그대로 둔다", () => {
    expect(safeText("TEST 브랜드")).toBe("TEST 브랜드");
    expect(safeText("https://a.example.invalid")).toBe("https://a.example.invalid");
    expect(safeText("")).toBe("");
  });

  it("셀을 깨뜨리는 제어문자를 지운다(줄바꿈은 남긴다)", () => {
    expect(safeText("a\u0000b")).toBe("a b");
    expect(safeText("a\nb")).toBe("a\nb");
  });

  it("브랜드명에 수식 글자가 와도 값이 변형되지 않는다", () => {
    const row = buildRow({ ...BRAND, brand_name: "=cmd|'/c calc'!A1" }, OPTS);
    expect(row["업체명"]).toBe("=cmd|'/c calc'!A1");
  });
});

describe("전화번호 — 원문 보존", () => {
  it("국가번호를 지킨다(+82 를 지우지 않는다)", () => {
    expect(phoneText("+82 10-1234-5678")).toBe("+82 10-1234-5678");
  });

  it("내선·구분자를 지킨다", () => {
    expect(phoneText("02-123-4567 ext.2")).toBe("02-123-4567 ext.2");
    expect(phoneText("010-1234-5678")).toBe("010-1234-5678");
  });

  it("문자열이라 앞의 0 이 살아 있다", () => {
    const v = phoneText("01012345678");
    expect(typeof v).toBe("string");
    expect(v).toBe("01012345678");
  });

  it("없으면 미기록으로 적는다(빈칸으로 두지 않는다)", () => {
    expect(buildRow({ ...BRAND, phone: null }, OPTS)["전화번호"]).toBe(UNKNOWN);
  });
});

describe("날짜 — 시트가 쓰는 숫자 시리얼", () => {
  it("시리얼로 쓴다(시트 A/J 열이 이미 숫자다)", () => {
    expect(DATE_AS_SERIAL).toBe(true);
    const v = dateCell("2026-10-01T01:00:00Z");
    expect(typeof v).toBe("number");
  });

  it("시리얼 값이 KST 벽시계와 맞는다", () => {
    // 1899-12-30 기준. 2026-10-01T01:00Z = 2026-10-01 10:00 KST.
    const s = kstSerial("2026-10-01T01:00:00Z")!;
    expect(s).toBeCloseTo((Date.UTC(2026, 9, 1, 10) - Date.UTC(1899, 11, 30)) / 86_400_000, 9);
  });

  it("사람이 읽는 글자도 KST 다", () => {
    expect(kstText("2026-10-01T01:00:00Z")).toBe("2026-10-01 10:00");
  });

  it("값이 없으면 빈칸이다", () => {
    expect(kstText(null)).toBe("");
    expect(dateCell(null)).toBe("");
    expect(kstSerial(null)).toBe(null);
  });

  it("분 단위로 끊어 같은 시각이 같은 값이 된다(readback 비교용)", () => {
    expect(kstSerial("2026-10-01T01:00:10Z")).toBe(kstSerial("2026-10-01T01:00:50Z"));
  });
});

describe("매출 — 섞지 않는다", () => {
  it("고객 신고 구간을 확정 회계연도 매출로 적지 않는다", () => {
    const r = revenueCells({
      reportedBand: "b1_10", reportedBandLabel: "1억원 이상 ~ 10억원 미만",
      reportedSource: "weekly 신청서", reportedAt: "2026-09-10T00:00:00Z",
    });
    expect(r.amount).toBe("1억원 이상 ~ 10억원 미만");
    expect(r.basis).toContain("고객 신고 구간");
    expect(r.basis).toContain("최근 12개월");
    expect(r.basis).toContain("확정 회계연도 아님");
    // 연도 칸에 연도 숫자만 있으면 결산 매출로 읽힌다 — 그렇게 적지 않는다.
    expect(typeof r.year).toBe("string");
    expect(r.year).not.toBe(2026);
    expect(String(r.year)).toContain("최근 12개월");
    expect(r.currency).toBe("KRW");
  });

  it("AI 추정은 확정 실적으로 쓰지 않고, 무엇에 대한 추정인지 밝힌다", () => {
    const r = revenueCells({
      estimateRaw: {
        status: "estimated", lower: 1_000_000_000, upper: 2_000_000_000,
        currency: "KRW", year: 2025, scope: "company_consolidated", entity: "TEST 법인",
        confidence: "medium", estimated_at: "2026-10-01T00:00:00+09:00",
        rationale: "공개 자료", sources: [{ title: "공시", url: "https://x.example.invalid" }],
      },
    });
    expect(r.basis).toContain("AI 추정");
    expect(r.basis).toContain("미확정");
    // 범위(브랜드 단위인지 법인 연결인지)와 대상이 없으면 숫자의 뜻이 달라진다.
    expect(r.basis).toContain("법인 연결");
    expect(r.basis).toContain("TEST 법인");
    // 출처는 다시 확인할 수 있어야 한다 — URL 을 남긴다.
    expect(r.source).toContain("https://x.example.invalid");
    expect(r.amount).toBe("1,000,000,000~2,000,000,000");
    expect(r.year).toBe(2025);
  });

  it("브랜드 단위 추정도 범위를 적는다", () => {
    const r = revenueCells({
      estimateRaw: {
        status: "estimated", lower: 1, upper: 1, currency: "USD", year: 2024,
        scope: "brand", entity: "TEST 브랜드", confidence: "low",
        estimated_at: "2026-01-01T00:00:00+09:00", rationale: "r",
        sources: [{ title: "s", url: "https://y.example.invalid" }],
      },
    });
    expect(r.basis).toContain("브랜드 단위");
    expect(r.amount).toBe("1");
  });

  it("신고 구간이 있으면 AI 추정보다 앞선다", () => {
    const r = revenueCells({
      reportedBandLabel: "10억원 이상 ~ 50억원 미만",
      reportedAt: "2026-09-10T00:00:00Z",
      estimateRaw: {
        status: "estimated", lower: 1, upper: 2, currency: "USD", year: 2024,
        scope: "brand", entity: "T", confidence: "low",
        estimated_at: "2026-01-01T00:00:00+09:00", rationale: "r",
        sources: [{ title: "s", url: "https://x.example.invalid" }],
      },
    });
    expect(r.basis).toContain("고객 신고 구간");
    expect(r.amount).toBe("10억원 이상 ~ 50억원 미만");
  });

  it("근거가 없으면 빈칸이 아니라 미기록이다", () => {
    const r = revenueCells({});
    expect(r.amount).toBe(UNKNOWN);
    expect(r.source).toBe(UNKNOWN);
    expect(r.year).toBe(UNKNOWN);
    expect(r.currency).toBe(UNKNOWN);
    expect(r.basis).not.toBe("");
  });

  it("추정 대기·실패 상태를 그대로 드러낸다", () => {
    expect(revenueCells({ estimateRaw: { status: "pending" } }).basis).toBe("추정 대기");
    expect(revenueCells({ estimateRaw: { status: "insufficient" } }).basis).toBe("추정 불가");
    // 형식이 깨진 estimated 는 확정으로 쓰지 않는다.
    expect(revenueCells({ estimateRaw: { status: "estimated", lower: 1 } }).basis).toBe("확인 필요");
  });

  it("0 과 미기록을 구분한다", () => {
    const zero = revenueCells({ reportedBandLabel: "매출 발생 전", reportedAt: "2026-09-10T00:00:00Z" });
    expect(zero.amount).toBe("매출 발생 전");
    expect(zero.amount).not.toBe(UNKNOWN);
  });
});

describe("커뮤니케이션 — 단정하지 않는다", () => {
  it("수신 기록을 '고객 회신'으로 단정하지 않는다", () => {
    // TikTok 자동 안내처럼 사람이 쓰지 않은 메일도 수신으로 쌓인다.
    const c = commsCells({
      lastInAt: "2026-10-20T01:00:00Z",
      lastAnyAt: "2026-10-20T01:00:00Z", lastAnyDirection: "in",
      lastAnySubject: "[TikTok] 안내", lastAnySource: "gmail",
    });
    expect(c.status).toBe("수신 기록 확인");
    expect(c.status).not.toContain("회신");
    expect(c.lastMailSubject).toBe("[TikTok] 안내");
  });

  it("발신만 있으면 회신으로 치지 않는다", () => {
    const c = commsCells({
      lastOutAt: "2026-10-20T01:00:00Z",
      lastAnyAt: "2026-10-20T01:00:00Z", lastAnyDirection: "out",
      lastAnySubject: "안내", lastAnySource: "gmail", totalMessages: 3,
    });
    expect(c.status).toBe("발신만 · 수신 없음");
    expect(c.lastMailSubject).toBe("안내");
  });

  it("예전 수신이 있고 지금은 발신이 최근이면 대기로 적는다", () => {
    const c = commsCells({
      lastInAt: "2026-10-10T01:00:00Z", lastOutAt: "2026-10-20T01:00:00Z",
      lastAnyAt: "2026-10-20T01:00:00Z", lastAnyDirection: "out",
      lastAnySubject: "재안내", lastAnySource: "gmail",
    });
    expect(c.status).toBe("발신 후 대기(수신 기록 있음)");
  });

  it("최근 기록의 시각과 제목이 같은 한 건에서 나온다(출처를 섞지 않는다)", () => {
    // 수기 기록이 가장 최근이면, 제목도 그 수기 기록의 것이다.
    const c = commsCells({
      lastOutAt: "2026-10-01T01:00:00Z",
      lastAnyAt: "2026-10-25T01:00:00Z", lastAnyDirection: "out",
      lastAnySubject: "전화 후 메일", lastAnySource: "manual", totalMessages: 4,
    });
    expect(c.lastMailAt).toBe(dateCell("2026-10-25T01:00:00Z"));
    expect(c.lastMailSubject).toBe("전화 후 메일");
    expect(c.lastTouch).toContain("기록");
  });

  it("방향이 불명확하면 불명확하다고 적는다", () => {
    const c = commsCells({
      lastAnyAt: "2026-10-20T01:00:00Z", lastAnyDirection: "unknown",
      lastAnySource: "manual",
    });
    expect(c.status).toBe("기록 있음 · 방향 미확인");
  });

  it("기록이 없으면 '기록 없음' 이고 빈 추측을 하지 않는다", () => {
    const c = commsCells({});
    expect(c.status).toBe("기록 없음");
    expect(c.lastMailAt).toBe("");
    expect(c.lastTouch).toBe(UNKNOWN);
  });

  it("근거 건수를 함께 적는다", () => {
    const c = commsCells({
      lastOutAt: "2026-10-20T01:00:00Z",
      lastAnyAt: "2026-10-20T01:00:00Z", lastAnyDirection: "out",
      lastAnySource: "gmail", totalMessages: 7,
    });
    expect(c.lastTouch).toContain("기록 7건");
    expect(c.lastTouch).toContain("발신");
  });
});

describe("미기록 표기와 기존 값 보호", () => {
  it("운영 시트와 같은 말을 쓴다", () => {
    expect(UNKNOWN).toBe("미기록");
  });

  it("빈칸과 미기록 표기를 '값 없음'으로 본다", () => {
    expect(isUnknownCell("")).toBe(true);
    expect(isUnknownCell(null)).toBe(true);
    expect(isUnknownCell("  ")).toBe(true);
    expect(isUnknownCell("미기록")).toBe(true);
    expect(isUnknownCell("미확인")).toBe(true);
  });

  it("0 은 값이다 — 미기록과 섞지 않는다", () => {
    expect(isUnknownCell(0)).toBe(false);
    expect(isUnknownCell("0")).toBe(false);
  });

  it("사람이 채워 둔 칸을 미기록으로 덮어쓰지 않는다", () => {
    expect(keepExisting(UNKNOWN, "뷰티")).toBe(true);
    expect(keepExisting("", "뷰티")).toBe(true);
  });

  it("실제 값을 계산했으면 갱신한다", () => {
    expect(keepExisting("패션", "뷰티")).toBe(false);
    expect(keepExisting(0, "뷰티")).toBe(false);
  });

  it("계산하지 않은 열은 건드리지 않는다", () => {
    expect(keepExisting(undefined, "뷰티")).toBe(true);
    expect(keepExisting(undefined, "")).toBe(true);
  });

  it("양쪽이 모두 비어 있으면 미기록을 적어 둔다(0 과 구분하기 위해)", () => {
    expect(keepExisting(UNKNOWN, "")).toBe(false);
  });
});

describe("행 전체", () => {
  it("필수로 요청된 항목이 모두 들어간다", () => {
    const row = buildRow(BRAND, OPTS);
    for (const h of ["유입일시(KST)", "업체명", "전화번호", "이메일", "카테고리",
      "브랜드링크", "매출액·구간", "매출기준·확인상태", "진행단계", "담당자", "커뮤확인"]) {
      expect(row[h], h).toBeDefined();
    }
  });

  it("필수 열 목록이 행 값과 어긋나지 않는다", () => {
    const row = buildRow(BRAND, OPTS);
    for (const h of REQUIRED_HEADERS) expect(row[h], h).toBeDefined();
  });

  it("원장링크와 브랜드 외부링크를 서로 다른 칸에 넣는다", () => {
    const row = buildRow(BRAND, OPTS);
    expect(row["원장링크"]).toBe("https://admin.example.invalid/brand/" + BRAND.id);
    expect(row["브랜드링크"]).toBe("https://brand.example.invalid");
    expect(row["원장링크"]).not.toBe(row["브랜드링크"]);
  });

  it("사람이 쓰는 메모 칸을 만들지 않는다", () => {
    const row = buildRow(BRAND, OPTS);
    expect(row["메모(직접입력)"]).toBeUndefined();
    expect(PROTECTED_HEADERS.has("메모(직접입력)")).toBe(true);
    expect([...MANAGED_HEADERS]).not.toContain("메모(직접입력)");
  });

  it("수신거부·보류도 원장에 남기되 상태로 표시한다", () => {
    const row = buildRow({ ...BRAND, msg_opt_out: true, hold_kind: "장기보류" }, OPTS);
    expect(row["상태표시"]).toContain("수신거부");
    expect(row["상태표시"]).toContain("보류");
    // 그래도 행 자체는 만들어진다 — 원장 전체가 대상이다.
    expect(row["업체명"]).toBe("TEST 합성브랜드");
  });

  it("브랜드 ID 열 이름이 고정돼 있다(정렬이 바뀌어도 이걸로 찾는다)", () => {
    expect(ID_HEADER).toBe("브랜드ID");
    expect(buildRow(BRAND, OPTS)[ID_HEADER]).toBe(BRAND.id);
  });

  it("빈 값은 미기록으로 적어 0 과 섞이지 않는다", () => {
    const row = buildRow({ ...BRAND, category: "", email: null, brand_url: "" }, OPTS);
    expect(row["카테고리"]).toBe(UNKNOWN);
    expect(row["이메일"]).toBe(UNKNOWN);
    expect(row["브랜드링크"]).toBe(UNKNOWN);
  });
});

describe("헤더 정규화", () => {
  it("띄어쓰기 차이를 흡수한다", () => {
    expect(normHeader("브랜드 ID")).toBe(normHeader("브랜드ID"));
    expect(normHeader("플랜 / 결제")).toBe(normHeader("플랜/결제"));
    expect(normHeader("메모 (직접입력)")).toBe(normHeader("메모(직접입력)"));
    expect(normHeader("최근메일 제목")).toBe(normHeader("최근메일제목"));
  });

  it("다른 이름을 같게 만들지는 않는다", () => {
    expect(normHeader("담당자")).not.toBe(normHeader("담당자 (원장)"));
    expect(normHeader("원장링크")).not.toBe(normHeader("브랜드링크"));
  });
});

describe("갱신기록 탭 헤더", () => {
  it("시트에 있는 순서를 그대로 따른다", () => {
    expect([...LOG_HEADERS]).toEqual([
      "기록시각(KST)", "원장건수", "추가건수", "변경건수",
      "메일확인 업체", "실행상태", "기록 기준", "원본",
    ]);
  });
});

describe("보조", () => {
  it("adminUrl 이 없어도 상대 경로를 만든다", () => {
    expect(ledgerLink("", "abc")).toBe("/brand/abc");
    expect(ledgerLink("https://a.invalid/", "abc")).toBe("https://a.invalid/brand/abc");
  });

  it("상태 표시가 없으면 빈 문자열이다", () => {
    expect(ledgerFlags(BRAND)).toBe("");
  });
});
