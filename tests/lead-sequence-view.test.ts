// 연속 안내 목록보기 — 저장값만으로 상태를 정확히 가르는지.
//   특히 "부분 실패를 완료로 오인하지 않는다"가 핵심.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  toViewStatus, channelResult, CHANNEL_RESULT_LABEL, viewStatusLabel,
  VIEW_STATUS, VIEW_STATUS_KEYS, clampPage, splitLinks, extractLinks, PAGE_SIZE,
} from "../lib/lead-sequence-view";

describe("표시 상태 판정(toViewStatus)", () => {
  it("아직 안 보낸 건은 예정", () => {
    expect(toViewStatus("queued", "")).toBe("queued");
  });
  it("둘 다 나갔으면 발송 완료", () => {
    expect(toViewStatus("sent", "")).toBe("sent");
  });
  it("한쪽만 나가고 다른 쪽이 실패면 '부분 실패' — 완료로 뭉뚱그리지 않는다", () => {
    // 워커는 문자만 성공해도 status='sent' 로 적고 note 에 실패를 남긴다.
    expect(toViewStatus("sent", "메일 실패")).toBe("partial");
    expect(toViewStatus("sent", "문자 실패")).toBe("partial");
    expect(viewStatusLabel("partial")).toBe("부분 실패");
  });
  it("테스트 모드 건은 실제 발송과 구분한다", () => {
    expect(toViewStatus("sent", "테스트 모드 — 실제 발송 없음")).toBe("test");
  });
  it("실패·건너뜀·중단은 그대로", () => {
    expect(toViewStatus("failed", "문자 실패 · 메일 실패")).toBe("failed");
    expect(toViewStatus("skipped", "연락처 없음")).toBe("skipped");
    expect(toViewStatus("canceled", "단계 진전(meeting)")).toBe("canceled");
  });
  it("모르는 값이 와도 화면이 깨지지 않는다", () => {
    expect(VIEW_STATUS_KEYS).toContain(toViewStatus("무언가", ""));
  });
  it("모든 표시 상태에 라벨과 설명이 있다", () => {
    for (const s of VIEW_STATUS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.desc.length).toBeGreaterThan(0);
    }
  });
});

describe("수단별 결과(channelResult)", () => {
  // 핵심: 아직 처리 안 한 건을 "대상 아님"으로 적으면 고객이 제외된 것처럼 읽힌다.
  it("예정(queued) — 양쪽 모두 '발송 대기'", () => {
    const row = { status: "queued", channels: [], note: "" };
    expect(channelResult("sms", row)).toBe("pending");
    expect(channelResult("email", row)).toBe("pending");
    expect(CHANNEL_RESULT_LABEL.pending).toBe("발송 대기");
    expect(CHANNEL_RESULT_LABEL.pending).not.toContain("미발송");
    expect(CHANNEL_RESULT_LABEL.pending).not.toContain("대상 아님");
  });
  it("중단(canceled) — 대기·대상 아님과 구분", () => {
    const row = { status: "canceled", channels: [], note: "단계 진전(meeting)" };
    expect(channelResult("sms", row)).toBe("canceled");
    expect(channelResult("email", row)).toBe("canceled");
    expect(CHANNEL_RESULT_LABEL.canceled).toBe("중단");
  });
  it("발송 완료 — 나간 수단은 '발송(접수)'", () => {
    const row = { status: "sent", channels: ["sms", "email"], note: "" };
    expect(channelResult("sms", row)).toBe("sent");
    expect(channelResult("email", row)).toBe("sent");
    expect(CHANNEL_RESULT_LABEL.sent).toBe("발송(접수)");   // 수신 확인이 아님을 라벨로 명시
  });
  it("부분 실패 — 문자는 발송, 메일은 실패로 각각", () => {
    const row = { status: "sent", channels: ["sms"], note: "메일 실패" };
    expect(channelResult("sms", row)).toBe("sent");
    expect(channelResult("email", row)).toBe("failed");
  });
  it("반대 방향도 같다", () => {
    const row = { status: "sent", channels: ["email"], note: "문자 실패" };
    expect(channelResult("sms", row)).toBe("failed");
    expect(channelResult("email", row)).toBe("sent");
  });
  it("둘 다 실패(failed)", () => {
    const row = { status: "failed", channels: [], note: "문자 실패 · 메일 실패" };
    expect(channelResult("sms", row)).toBe("failed");
    expect(channelResult("email", row)).toBe("failed");
  });
  it("테스트 모드 — 실제로 안 나갔음을 라벨로 드러낸다", () => {
    const row = { status: "sent", channels: ["sms", "email"], note: "테스트 모드 — 실제 발송 없음" };
    expect(channelResult("sms", row)).toBe("test");
    expect(channelResult("email", row)).toBe("test");
    expect(CHANNEL_RESULT_LABEL.test).toContain("미발송");
  });
  it("건너뜀(skipped) — 처리했으나 대상이 아니었던 경우만 '대상 아님'", () => {
    const row = { status: "skipped", channels: [], note: "연락처 없음" };
    expect(channelResult("sms", row)).toBe("none");
    expect(channelResult("email", row)).toBe("none");
    expect(CHANNEL_RESULT_LABEL.none).toBe("대상 아님");
  });
  it("한쪽만 대상이었던 건 — 나간 쪽만 발송, 다른 쪽은 대상 아님", () => {
    const row = { status: "sent", channels: ["email"], note: "" };
    expect(channelResult("sms", row)).toBe("none");
    expect(channelResult("email", row)).toBe("sent");
  });
  it("값이 비어 있어도 안전하다", () => {
    expect(channelResult("sms", { status: "skipped" })).toBe("none");
    expect(channelResult("email", { status: "queued", channels: null, note: null })).toBe("pending");
  });
  it("모든 표시값에 라벨이 있다", () => {
    for (const k of ["pending", "sent", "failed", "test", "canceled", "none"] as const) {
      expect(CHANNEL_RESULT_LABEL[k].length).toBeGreaterThan(0);
    }
  });
});

describe("페이지 번호(clampPage)", () => {
  it("범위를 벗어나면 안쪽으로 당긴다", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(99, 5)).toBe(5);
    expect(clampPage(3, 5)).toBe(3);
  });
  it("잘못된 값·빈 목록에서도 1쪽", () => {
    expect(clampPage("abc", 3)).toBe(1);
    expect(clampPage(undefined, 0)).toBe(1);
    expect(clampPage(2, 0)).toBe(1);
  });
  it("한 쪽에 50건", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("본문 링크 처리", () => {
  const body = `안녕하세요.

📖 가이드북 보기
https://glovek.space/guidebook

📅 상담 예약
https://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2

GloveK 드림`;

  it("링크와 글을 나눠 링크만 클릭 가능하게 만든다", () => {
    const parts = splitLinks(body);
    const links = parts.filter((p) => p.t === "link").map((p) => p.v);
    expect(links).toEqual([
      "https://glovek.space/guidebook",
      "https://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2",
    ]);
  });
  it("원문을 하나도 잃지 않는다(줄바꿈 포함)", () => {
    expect(splitLinks(body).map((p) => p.v).join("")).toBe(body);
    expect(splitLinks(body).map((p) => p.v).join("").split("\n").length).toBe(body.split("\n").length);
  });
  it("쿼리스트링이 붙은 긴 링크도 끝까지 잡는다", () => {
    const u = "https://app.notion.com/p/Glovek-01-3d7193cdf133809c825bd00acfc9f79b?source=copy_link";
    expect(extractLinks(`자료: ${u} 확인`)).toEqual([u]);
  });
  it("같은 링크가 여러 번 나와도 목록에는 한 번만", () => {
    const u = "https://glovek.space/tts/qna";
    expect(extractLinks(`${u} 그리고 ${u}`)).toEqual([u]);
  });
  it("링크가 없거나 빈 본문도 안전하다", () => {
    expect(extractLinks("링크 없는 본문")).toEqual([]);
    expect(splitLinks("")).toEqual([]);
  });
  it("아주 긴 본문도 통째로 보존한다(화면에서 잘라 숨기지 않음)", () => {
    const long = Array.from({ length: 400 }, (_, i) => `${i}번째 줄입니다.`).join("\n");
    expect(splitLinks(long).map((p) => p.v).join("")).toBe(long);
  });
});

// 필터·건수가 화면 표시와 어긋나지 않으려면 SQL 판정과 TS 판정이 같아야 한다.
describe("SQL 판정 ↔ 화면 판정 일치", () => {
  const src = readFileSync(new URL("../lib/lead-sequence-view.ts", import.meta.url), "utf8");
  it("SQL 도 테스트·부분실패를 같은 문구로 가른다", () => {
    const sql = src.slice(src.indexOf("VIEW_STATUS_SQL"), src.indexOf("PAGE_SIZE"));
    expect(sql).toContain("THEN 'test'");
    expect(sql).toContain("THEN 'partial'");
    expect(sql).toContain("${TEST_NOTE}");
    expect(sql).toContain("${SMS_FAIL}");
    expect(sql).toContain("${MAIL_FAIL}");
  });
  it("판정 문구는 워커가 실제로 쓰는 값과 같다", () => {
    const worker = readFileSync(new URL("../lib/lead-sequence.ts", import.meta.url), "utf8");
    expect(worker).toContain('errs.push("문자 실패")');
    expect(worker).toContain('errs.push("메일 실패")');
    expect(worker).toContain('"테스트 모드 — 실제 발송 없음"');
  });
  it("조회 화면은 발송·수정 동작을 부르지 않는다(조회 전용)", () => {
    const page = readFileSync(new URL("../app/(dash)/channels/[id]/sequence/page.tsx", import.meta.url), "utf8");
    for (const banned of ["runDueSequence", "saveSeqStep", "saveSeqConfig", "cancelLead", "sendSms", "sendEmail"]) {
      expect(page, `${banned} 호출됨`).not.toContain(banned);
    }
  });
});

describe("목록 화면 사용성", () => {
  const page = readFileSync(new URL("../app/(dash)/channels/[id]/sequence/page.tsx", import.meta.url), "utf8");
  const view = readFileSync(new URL("../lib/lead-sequence-view.ts", import.meta.url), "utf8");

  it("회차 카드는 기본 접힘 — 요약(회차·시각·제목·문자/메일)은 접힌 상태에서도 보인다", () => {
    expect(page).toContain("<details className=\"card\" open={open}");
    expect(page).toContain('open={sp.open === "1"}');        // 기본값은 접힘
    expect(page).toContain("<summary");
    expect(page).toContain("step.email_subject.trim()");     // 제목이 summary 안
    expect(page).toContain("문자 {smsOn ? \"ON\" : \"—\"}");
    expect(page).toContain("내용보기");
  });
  it("본문은 펼쳤을 때 제한 높이 안에서 스크롤한다", () => {
    expect(page).toContain("overflowY: \"auto\"");
    expect(page).toContain("whiteSpace: \"pre-wrap\"");
  });
  it("대상 목록 바로가기 앵커가 있다", () => {
    expect(page).toContain('data-testid="goto-targets"');
    expect(page).toContain('href="#targets"');
    expect(page).toContain('id="targets"');
  });
  it("모두 펼치기 토글이 있다", () => {
    expect(page).toContain('data-testid="toggle-all-steps"');
  });
  it("예정 필터는 가까운 날짜 우선으로 정렬한다", () => {
    expect(view).toContain('status === "queued" ? "ASC" : "DESC"');
  });
  it("하단 설명이 '발송 대기'와 '대상 아님'을 구분해 설명한다", () => {
    expect(page).toContain("아직 처리 전");
    expect(page).toContain("제외된 것이 아니며");
    expect(page).toContain("처리했으나");
  });
});
