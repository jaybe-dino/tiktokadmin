// 카카오 수집 — 코드·설정이 지켜야 할 규칙(DB 없이 소스·마이그레이션 감사).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { KAKAO_SECRET_ENV, KAKAO_SCHEMA_MIGRATION } from "../lib/kakao-rooms";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("마이그레이션 0106", () => {
  const sql = read("../migrations/0106_kakao_rooms.sql");
  it("추가만 한다", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS kakao_rooms");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS source_ref");
    expect(sql.replace(/ON DELETE (CASCADE|SET NULL)/g, "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  });
  it("방 기본 상태가 '확인 대기'다(임의 연결 금지)", () => {
    expect(sql).toMatch(/status text NOT NULL DEFAULT 'pending'/);
  });
  it("같은 메시지를 두 번 저장하지 못하게 막는다", () => {
    expect(sql).toContain("pm_manual_comms_source_ref_uniq");
    expect(sql).toMatch(/UNIQUE INDEX[\s\S]*?pm_manual_comms \(brand_id, source_ref\) WHERE source_ref <> ''/);
  });
});

describe("수집 엔드포인트", () => {
  const route = read("../app/api/kakao/ingest/route.ts");
  it("비밀키가 없으면 어떤 요청도 받지 않는다(fail closed)", () => {
    expect(route).toContain(`if (!process.env[KAKAO_SECRET_ENV])`);
    expect(route).toContain("collector_not_configured");
  });
  it("비밀키를 상수 비교가 아닌 timingSafeEqual 로 확인한다", () => {
    expect(route).toContain("timingSafeEqual");
  });
  it("비밀키 값을 코드에 두지 않는다", () => {
    expect(KAKAO_SECRET_ENV).toBe("KAKAO_INGEST_SECRET");
    // 환경변수 "이름"만 있고 값처럼 보이는 문자열은 없다.
    expect(route).not.toMatch(/KAKAO_INGEST_SECRET\s*=\s*["'][^"']+["']/);
  });
  it("받기만 하고 보내지 않는다", () => {
    expect(route).not.toMatch(/sendEmail|sendSms|sendMass|slackPost/);
  });
});

describe("수집 모듈", () => {
  const lib = read("../lib/kakao-rooms.ts");
  it("고객에게 보내는 경로가 없다", () => {
    expect(lib).not.toMatch(/sendEmail|sendSms|sendMass|slackPost/);
  });
  it("브랜드가 연결된 방만 저장한다", () => {
    expect(lib).toContain('if (status !== "linked" || !room.brand_id)');
    expect(lib).toContain("담당자 확인 전에는 저장하지 않습니다");
  });
  it("기존 기록을 지우거나 다시 쓰지 않는다", () => {
    expect(lib).not.toMatch(/DELETE FROM pm_manual_comms|UPDATE pm_manual_comms SET body/i);
  });
  it("마이그레이션 이름이 코드와 맞는다", () => {
    expect(KAKAO_SCHEMA_MIGRATION).toBe("0106_kakao_rooms.sql");
  });
});

describe("관리 화면", () => {
  const actions = read("../app/(dash)/kakao/actions.ts");
  const panel = read("../components/KakaoRoomsPanel.tsx");
  it("연결 변경은 대표·파트장만 가능하다", () => {
    expect(actions).toContain("WRITE_ROLES");
    for (const fn of ["kakaoLinkRoomAction", "kakaoSetStatusAction", "kakaoSetNoteAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 220), fn).toContain("writer()");
    }
  });
  it("비밀키 값을 화면으로 돌려주지 않는다", () => {
    // 설정 여부(boolean)만 돌려주고 값 자체는 어디에도 싣지 않는다.
    expect(actions).toContain("const collectorConfigured = Boolean(process.env[KAKAO_SECRET_ENV]);");
    expect(actions).toMatch(/collectorConfigured,/);
    expect(actions).not.toMatch(/secret(Value)?:\s*process\.env/);
  });
  it("연결 전에는 저장되지 않는다고 화면에 적는다", () => {
    expect(panel).toContain("확인 대기");
    expect(panel).toContain("대화는 저장되지 않습니다");
    expect(panel).toContain("수집기에서 받은 기록 없음");
  });
});

describe("PM 채널 표시", () => {
  const comms = read("../lib/pm-comms.ts");
  it("수집기에서 저장된 적이 있을 때만 '설정됨'으로 본다", () => {
    expect(comms).toContain("k.lastIngestAt");
    expect(comms).toContain('{ state: "configured", note: k.note }');
    expect(comms).toContain('{ state: "off", note: k.note }');
  });
  it("표가 없거나 실패하면 '자동 수집 경로 없음'을 유지한다", () => {
    expect(comms).toContain("기본값(자동 수집 경로 없음)을 그대로 둔다");
  });
});
