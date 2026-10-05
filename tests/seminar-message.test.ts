// 세미나 문구 조립 — 제목 기준 통일·최종 본문 동일성(DB 없이).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  seminarVars, composeSeminarMessage, maskTo, DEFAULT_SESSION_TITLE,
} from "../lib/seminar-message";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

const AT = new Date("2026-10-05T01:30:00Z");   // 2026-10-05 10:30 KST
const TPL = {
  emailSubject: "[GloveK] {{세미나명}} 참가 안내 ({{일시}})",
  emailBody: "{{담당자명}}님\n{{세미나명}}\n{{일시}}\n{{줌링크}}",
  smsBody: "[GloveK] {{세미나명}}\n{{일시}}\n{{줌링크}}",
};

describe("치환 변수 — 제목 기준", () => {
  it("세미나명은 지금 설정값이 기준이다(회차 스냅샷보다 먼저)", () => {
    const v = seminarVars({
      at: AT, configTitle: "틱톡샵 온라인 세미나 | glovek",
      sessionTitle: "GloveK 온라인 세미나 | 녹화 강의",
    });
    expect(v.세미나명).toBe("틱톡샵 온라인 세미나 | glovek");
  });
  it("설정값이 비어 있을 때만 회차 스냅샷을 쓴다", () => {
    expect(seminarVars({ at: AT, configTitle: "", sessionTitle: "옛 제목" }).세미나명).toBe("옛 제목");
    expect(seminarVars({ at: AT, configTitle: "   ", sessionTitle: "옛 제목" }).세미나명).toBe("옛 제목");
  });
  it("둘 다 없으면 기본값", () => {
    expect(seminarVars({ at: AT }).세미나명).toBe(DEFAULT_SESSION_TITLE);
  });
  it("참가 링크는 반대로 회차 고정값이 먼저다(이미 안내한 링크 유지)", () => {
    const v = seminarVars({ at: AT, configZoomUrl: "https://zoom.example/new", sessionZoomUrl: "https://zoom.example/pinned" });
    expect(v.줌링크).toBe("https://zoom.example/pinned");
    expect(seminarVars({ at: AT, configZoomUrl: "https://zoom.example/new" }).줌링크).toBe("https://zoom.example/new");
  });
  it("일시는 KST 표기를 쓴다", () => {
    expect(seminarVars({ at: AT }).일시).toBe("2026년 10월 5일(월) 오전 10:30");
  });
  it("이름이 없으면 고객으로 대신한다", () => {
    expect(seminarVars({ at: AT }).브랜드명).toBe("고객");
    expect(seminarVars({ at: AT, brandName: "디노" }).담당자명).toBe("디노");
    expect(seminarVars({ at: AT, brandName: "디노", contactName: "홍길동" }).담당자명).toBe("홍길동");
  });
});

describe("최종 본문 조립", () => {
  const vars = seminarVars({ at: AT, configTitle: "틱톡샵 온라인 세미나 | glovek", configZoomUrl: "https://zoom.example/j/1" });

  it("메일 제목·본문이 치환된다", () => {
    const m = composeSeminarMessage({ channel: "email", purpose: "service", template: TPL, vars });
    expect(m.subject).toBe("[GloveK] 틱톡샵 온라인 세미나 | glovek 참가 안내 (2026년 10월 5일(월) 오전 10:30)");
    expect(m.body).toContain("틱톡샵 온라인 세미나 | glovek");
    expect(m.body).toContain("https://zoom.example/j/1");
    expect(m.body).not.toMatch(/\{\{/);
  });
  it("문자는 제목이 없고 본문만 쓴다", () => {
    const m = composeSeminarMessage({ channel: "sms", purpose: "service", template: TPL, vars });
    expect(m.subject).toBe("");
    expect(m.body).toContain("틱톡샵 온라인 세미나 | glovek");
  });
  it("service 단계에는 수신거부 꼬리말을 붙이지 않는다", () => {
    const m = composeSeminarMessage({
      channel: "sms", purpose: "service", template: TPL, vars, optoutUrl: "https://admin.example/u/t",
    });
    expect(m.body).not.toContain("https://admin.example/u/t");
  });
  it("ad 단계에는 수신거부 꼬리말이 최종 본문에 포함된다", () => {
    for (const ch of ["sms", "email"] as const) {
      const m = composeSeminarMessage({
        channel: ch, purpose: "ad", template: TPL, vars, optoutUrl: "https://admin.example/u/tok",
      });
      expect(m.body, ch).toContain("https://admin.example/u/tok");
    }
  });
  it("테스트 표시와 안내문은 테스트 경로에서만 붙는다", () => {
    const plain = composeSeminarMessage({ channel: "email", purpose: "service", template: TPL, vars });
    const test = composeSeminarMessage({
      channel: "email", purpose: "service", template: TPL, vars, mark: "[테스트]", footNote: "※ 점검용",
    });
    expect(plain.subject.startsWith("[테스트]")).toBe(false);
    expect(test.subject.startsWith("[테스트] ")).toBe(true);
    expect(test.body.endsWith("※ 점검용")).toBe(true);
    // 표시를 떼면 실제 발송 본문과 같다.
    expect(test.subject.replace("[테스트] ", "")).toBe(plain.subject);
  });
});

describe("수신자 마스킹", () => {
  it("전화·이메일 원문이 남지 않는다", () => {
    const p = maskTo("sms", "010-1234-5678");
    expect(p).toBe("010****5678");
    expect(p).not.toContain("1234");
    const e = maskTo("email", "jaybe@dinostudio.kr");
    expect(e.endsWith("@dinostudio.kr")).toBe(true);
    expect(e).not.toContain("jaybe");
  });
  it("빈 값·형식 밖은 안전하게 처리한다", () => {
    expect(maskTo("sms", "")).toBe("");
    expect(maskTo("email", "골뱅이없음")).toBe("***");
  });
});

describe("배선 감사", () => {
  const lib = code("../lib/seminar.ts");
  const test = code("../lib/seminar-test.ts");

  it("실제 발송과 미리보기가 같은 조립 함수를 쓴다", () => {
    expect(lib).toContain("composeSeminarMessage(");
    expect(lib).toContain("seminarVars(");
    expect(test).toContain("composeSeminarMessage(");
    expect(test).toContain("seminarVars(");
  });
  it("실제 발송 경로에 옛 제목 우선순위가 남아 있지 않다", () => {
    // r.session_title 을 먼저 쓰던 분기가 사라졌는지.
    expect(lib).not.toMatch(/r\.session_title\s*\|\|\s*cfg\.sessionTitle/);
  });
  it("회차 스냅샷을 덮어쓰지 않는다", () => {
    const updates = [...lib.matchAll(/UPDATE seminar_sessions SET ([^\n]*)/g)].map((m) => m[1]);
    for (const u of updates) {
      expect(u).not.toMatch(/session_title/);
      expect(u).not.toMatch(/zoom_url/);
    }
  });
  it("기록에 넘기는 본문과 전송에 넘기는 본문이 같은 값이다", () => {
    // 같은 msg 객체를 beginAttempt 와 transmit 에 넘긴다.
    expect(lib).toMatch(/body: msg\.body/);
    expect(lib).toMatch(/subject: msg\.subject/);
    expect(lib).toMatch(/transmit\(r\.channel, to, msg\)/);
  });
  it("기록 → 전송 순서이고, 기록 실패면 보내지 않는다", () => {
    const i = lib.indexOf("const logId = await beginAttempt(");
    const j = lib.indexOf("const outcome = await transmit(");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);                       // 기록이 먼저
    expect(lib).toMatch(/if \(!logId\) \{ await noSend\(/);
  });
  it("본문·제목을 콘솔로 내보내지 않는다", () => {
    for (const f of ["../lib/seminar.ts", "../lib/seminar-message.ts", "../lib/seminar-attempts.ts"]) {
      expect(code(f), f).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
  it("기록 표는 결과 칸만 나중에 고친다", () => {
    const att = code("../lib/seminar-attempts.ts");
    const u = att.slice(att.indexOf("UPDATE seminar_send_attempts"));
    for (const col of ["subject", "body", "to_masked", "channel", "stage", "attempt_no", "started_at"]) {
      expect(u.slice(0, 400), col).not.toMatch(new RegExp(`\\b${col}\\s*=`));
    }
    expect(u).toMatch(/result=\$2/);
  });
});
