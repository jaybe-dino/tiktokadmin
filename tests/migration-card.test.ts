// DB 마이그레이션 카드 — 브라우저 기본 대화상자(window.confirm) 대신 앱 내 확인 패널을 쓴다.
//   native confirm 은 페이지 밖 요소라 자동화·보조기기가 다룰 수 없고 열린 동안 탭이 멈춘다.
//   회귀 방지를 위해 소스 수준에서 고정한다(이 프로젝트의 기존 규칙 테스트와 같은 방식).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const CARD = "components/MigrationStatusCard.tsx";

describe("마이그레이션 적용 확인 UI", () => {
  const src = read(CARD);

  it("브라우저 기본 대화상자를 쓰지 않는다", () => {
    expect(src).not.toMatch(/\bconfirm\s*\(/);
    expect(src).not.toMatch(/\balert\s*\(/);
    expect(src).not.toMatch(/\bwindow\.(confirm|alert|prompt)\b/);
  });

  it("앱 내 확인 패널과 적용·취소 버튼이 있다", () => {
    expect(src).toContain('data-testid="migrate-confirm-panel"');
    expect(src).toContain('data-testid="migrate-confirm-apply"');
    expect(src).toContain('data-testid="migrate-confirm-cancel"');
  });

  it("확인 패널이 적용 대상 파일명을 그대로 보여준다", () => {
    // 선택분은 pickedList, 전체는 state.pending 을 그대로 나열한다.
    expect(src).toContain("confirming === \"selected\" ? pickedList : state?.pending");
  });

  it("실제 적용은 확인 패널의 버튼에서만 시작된다", () => {
    // 목록 옆 버튼은 확인 단계로만 넘어가고(setConfirming), 바로 적용하지 않는다.
    expect(src).toMatch(/data-testid="migrate-apply-selected"[\s\S]{0,260}setConfirming\("selected"\)/);
    expect(src).toMatch(/data-testid="migrate-apply-all"[\s\S]{0,260}setConfirming\("all"\)/);
    expect(src).toMatch(/data-testid="migrate-confirm-apply"[\s\S]{0,200}runApply\(confirming\)/);
  });

  it("중복 클릭을 막는다 — 진행 중이면 버튼이 잠기고 함수도 되돌아간다", () => {
    expect(src).toContain("const busy = pending || running;");
    expect(src).toContain("if (busy) return;                 // 중복 클릭 방지");
    for (const id of ["migrate-confirm-apply", "migrate-apply-selected", "migrate-apply-all", "migrate-refresh"]) {
      expect(src, `${id} 에 busy 잠금 없음`).toMatch(new RegExp(`data-testid="${id}"[\\s\\S]{0,200}disabled=\\{busy`));
    }
  });

  it("성공·실패 결과가 화면에 남는다(자동 소멸·대화상자 아님)", () => {
    expect(src).toContain('data-testid="migrate-result"');
    expect(src).toContain('role="status"');
    expect(src).not.toContain("setTimeout");   // 결과를 시간이 지나면 지우지 않는다
  });

  it("파일 체크박스를 자동화가 집어낼 수 있다", () => {
    expect(src).toContain("data-testid={`migrate-pick-${p}`}");
  });
});
