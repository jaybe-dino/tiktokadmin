// 원장 → 시트 행 변환. 순수 로직이라 DB·네트워크 없이 본다.
import { describe, it, expect } from "vitest";
import {
  safeText, phoneText, kstText, kstSerial, dateCell, UNKNOWN,
  revenueCells, commsCells, buildRow, ledgerLink, ledgerFlags,
  MANAGED_HEADERS, PROTECTED_HEADERS, ID_HEADER, type LedgerBrand,
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

describe("수식 주입 방지", () => {
  it("= + - @ 로 시작하는 글자를 수식으로 두지 않는다", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "=HYPERLINK(\"x\")"]) {
      expect(safeText(bad).startsWith("'"), bad).toBe(true);
    }
  });

  it("탭·캐리지리턴으로 시작하는 값도 막는다(CSV 에서 수식이 된다)", () => {
    expect(safeText("\t=1+1").startsWith("'")).toBe(true);
    expect(safeText("\r=1+1").startsWith("'")).toBe(true);
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

  it("브랜드명에 수식이 들어와도 행 전체가 안전하다", () => {
    const row = buildRow({ ...BRAND, brand_name: "=cmd|'/c calc'!A1" }, OPTS);
    expect(String(row["업체명"]).startsWith("'")).toBe(true);
  });
});

describe("전화번호", () => {
  it("문자열로 쓰고 앞의 0 을 지킨다", () => {
    const v = phoneText("010-1234-5678");
    expect(typeof v).toBe("string");
    expect(v).toBe("01012345678");
  });

  it("없으면 미확인으로 적는다(빈칸으로 두지 않는다)", () => {
    expect(buildRow({ ...BRAND, phone: null }, OPTS)["전화번호"]).toBe(UNKNOWN);
  });
});

describe("날짜", () => {
  it("KST 로 적는다", () => {
    // 2026-10-01T01:00Z = KST 10:00
    expect(kstText("2026-10-01T01:00:00Z")).toBe("2026-10-01 10:00");
  });

  it("값이 없으면 빈칸이다", () => {
    expect(kstText(null)).toBe("");
    expect(dateCell(null)).toBe("");
  });

  it("시리얼 변환이 맞다(서식을 바꿀 때 쓴다)", () => {
    // 1899-12-30 기준. 2026-10-01 10:00 KST.
    const s = kstSerial("2026-10-01T01:00:00Z")!;
    expect(Number.isFinite(s)).toBe(true);
    expect(Math.floor(s)).toBe(Math.floor((Date.UTC(2026, 9, 1, 10) - Date.UTC(1899, 11, 30)) / 86400000));
  });
});

describe("매출 — 섞지 않는다", () => {
  it("고객이 신고한 구간이 있으면 그것이 기준이다", () => {
    const r = revenueCells({
      reportedBand: "b1_10", reportedBandLabel: "1억원 이상 ~ 10억원 미만",
      reportedSource: "weekly 신청서", reportedAt: "2026-09-10T00:00:00Z",
    });
    expect(r.amount).toBe("1억원 이상 ~ 10억원 미만");
    expect(r.basis).toBe("고객 신고 구간");
    expect(r.source).toBe("weekly 신청서");
    expect(r.year).toBe(2026);
    expect(r.currency).toBe("KRW");
  });

  it("AI 추정은 확정 실적으로 쓰지 않는다 — 칸 안에서 못을 박는다", () => {
    const r = revenueCells({
      estimateRaw: {
        status: "estimated", lower: 1_000_000_000, upper: 2_000_000_000,
        currency: "KRW", year: 2025, scope: "brand", entity: "TEST",
        confidence: "medium", estimated_at: "2026-10-01T00:00:00+09:00",
        rationale: "공개 자료", sources: [{ title: "공시", url: "https://x.example.invalid" }],
      },
    });
    expect(r.basis).toContain("AI 추정");
    expect(r.basis).toContain("미확정");
    expect(r.amount).toBe("1,000,000,000~2,000,000,000");
    expect(r.year).toBe(2025);
    expect(r.currency).toBe("KRW");
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
    expect(r.basis).toBe("고객 신고 구간");
    expect(r.amount).toBe("10억원 이상 ~ 50억원 미만");
  });

  it("근거가 없으면 빈칸이 아니라 미확인이다", () => {
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

  it("0 과 미확인을 구분한다", () => {
    const zero = revenueCells({ reportedBandLabel: "매출 발생 전", reportedAt: "2026-09-10T00:00:00Z" });
    expect(zero.amount).toBe("매출 발생 전");
    expect(zero.amount).not.toBe(UNKNOWN);
  });
});

describe("커뮤니케이션 — 단정하지 않는다", () => {
  it("발신만 있으면 회신으로 치지 않는다", () => {
    const c = commsCells({ lastOutAt: "2026-10-20T01:00:00Z", lastOutSubject: "안내", totalMessages: 3 });
    expect(c.status).toBe("발신만 · 회신 없음");
    expect(c.lastMailSubject).toBe("안내");
  });

  it("수신이 가장 최근이면 회신 있음이다", () => {
    const c = commsCells({
      lastOutAt: "2026-10-19T01:00:00Z", lastOutSubject: "안내",
      lastInAt: "2026-10-20T01:00:00Z", lastInSubject: "답변드립니다",
    });
    expect(c.status).toBe("고객 회신 있음");
    expect(c.lastMailSubject).toBe("답변드립니다");
  });

  it("예전에 회신이 있었고 지금은 발신이 최근이면 대기로 적는다", () => {
    const c = commsCells({
      lastInAt: "2026-10-10T01:00:00Z", lastOutAt: "2026-10-20T01:00:00Z", lastOutSubject: "재안내",
    });
    expect(c.status).toBe("발신 후 대기(이전 회신 있음)");
  });

  it("기록이 없으면 '기록 없음' 이고 빈 추측을 하지 않는다", () => {
    const c = commsCells({});
    expect(c.status).toBe("기록 없음");
    expect(c.lastMailAt).toBe("");
    expect(c.lastTouch).toBe(UNKNOWN);
  });

  it("근거 건수를 함께 적는다", () => {
    const c = commsCells({ lastOutAt: "2026-10-20T01:00:00Z", totalMessages: 7 });
    expect(c.lastTouch).toContain("메일 7건");
    expect(c.lastTouch).toContain("발신");
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

  it("빈 값은 미확인으로 적어 0 과 섞이지 않는다", () => {
    const row = buildRow({ ...BRAND, category: "", email: null, brand_url: "" }, OPTS);
    expect(row["카테고리"]).toBe(UNKNOWN);
    expect(row["이메일"]).toBe(UNKNOWN);
    expect(row["브랜드링크"]).toBe(UNKNOWN);
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
