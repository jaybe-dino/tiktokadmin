import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// 채널 규칙(운영 요청): #glovek-lead 에는 "신규 리드 알림"만, SLA 지연·알림은 데일리로.
//   코드가 실수로 leads 채널에 다른 알림을 올리지 못하게 소스 수준에서 고정한다.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Slack 채널 라우팅", () => {
  it("leads 채널은 신규 리드 알림에서만 사용한다", () => {
    const files = ["lib/escalation.ts", "lib/submit-notify.ts", "lib/sla.ts"];
    for (const f of files) {
      expect(read(f), `${f} 에서 leads 채널 사용`).not.toContain('channelKey: "leads"');
    }
    // 신규 리드 알림만 leads 를 쓴다.
    expect(read("lib/lead-notify.ts")).toContain('channelKey: "leads"');
  });

  it("SLA 지연·알림은 sla 채널 키로 보낸다(기본값 데일리)", () => {
    const esc = read("lib/escalation.ts");
    expect(esc).toContain('channelKey: "sla"');
    expect(read("lib/lead-notify.ts")).toContain('channelKey: "sla"');
  });

  it("sla·forms 채널 키는 leads 로 폴백하지 않는다", () => {
    const env = read("lib/env.ts");
    const slaLine = env.split("\n").find((l) => l.trim().startsWith("sla:")) ?? "";
    const formsLine = env.split("\n").find((l) => l.trim().startsWith("forms:")) ?? "";
    expect(slaLine).not.toContain("leads");
    expect(formsLine).not.toContain("leads");
    // 미설정이어도 어딘가로는 가야 한다(조용한 유실 방지).
    expect(slaLine).toContain("daily");
    expect(formsLine).toContain("daily");
  });
});
