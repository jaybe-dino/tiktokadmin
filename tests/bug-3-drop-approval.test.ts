// BUG-3 — "드랍이 눌리기는 하는데 리스트에서 없어지지 않고 상태도 안 바뀐다".
//   원인: 결재권한이 없는 담당이 드랍하면 opsDrop 이 approval_requests 에 요청만 만들고
//   { ok: true, pending: true } 를 돌려주는데, 호출부가 pending 을 버리고 ok 만 보고
//   "처리됨" 으로 닫아 버렸다. 그래서 아무 일도 안 일어난 것처럼 보였다.
//   이 테스트는 pending 이 끝까지 전달되고, 화면이 그걸 구분해 알리는지를 고정한다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DROP_PENDING_NOTICE } from "../lib/approval-notice";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const actions = read("app/actions.ts");
const board = read("components/BoardCardLayer.tsx");
const header = read("components/Brand360Header.tsx");
const dropRoute = read("app/api/ops/drop/route.ts");
const ops = read("lib/ops.ts");

describe("BUG-3 — 드랍 결재 요청을 '처리됨' 으로 말하지 않는다", () => {
  it("결재권한이 없으면 opsDrop 은 요청만 만들고 pending 을 돌려준다(전제)", () => {
    expect(ops).toMatch(/INSERT INTO approval_requests[\s\S]{0,200}'drop'/);
    expect(ops).toContain("return { ok: true, pending: true };");
  });

  it("서버액션이 pending 을 버리지 않는다", () => {
    expect(actions).toMatch(/return \{ ok: res\.ok, error: res\.error, pending: res\.pending \};/);
    expect(actions).toMatch(/pending\?: boolean;/);
  });

  it("안내 문구가 '아직 드랍되지 않았다' 는 사실을 말한다", () => {
    expect(DROP_PENDING_NOTICE).toContain("결재");
    expect(DROP_PENDING_NOTICE).toContain("승인");
    // "드랍됐다" 고 단정하지 않는다.
    expect(DROP_PENDING_NOTICE).not.toContain("처리됨");
  });

  it("보드 카드는 승인 대기면 닫지 않고 알린다", () => {
    expect(board).toContain("if (r.pending) { setNotice(DROP_PENDING_NOTICE); router.refresh(); return; }");
    // 안내는 오류색과 구분해 보여준다.
    expect(board).toContain("DROP_PENDING_NOTICE");
    expect(board).toContain("결재함 열기");
    // pending 처리는 toDrop 안에서 ok 분기보다 앞에 있어야 한다 — 뒤면 그냥 닫힌다.
    const toDrop = board.slice(board.indexOf("function toDrop()"));
    expect(toDrop.indexOf("if (r.pending)"))
      .toBeLessThan(toDrop.indexOf("if (r.ok) { onClose(); router.refresh(); }"));
  });

  it("브랜드 상세는 승인 대기면 '처리됨' 이라 하지 않고 목록으로 보내지도 않는다", () => {
    expect(header).toContain("if (r.pending) { flash(DROP_PENDING_NOTICE, true); return; }");
    expect(header.indexOf("if (r.pending)"))
      .toBeLessThan(header.indexOf('flash(r.ok ? "제외(드랍) 처리됨"'));
  });

  it("HTTP 라우트(Slack·MCP)도 드랍된 것처럼 응답하지 않는다", () => {
    expect(dropRoute).toContain('pending: true, status: "awaiting_approval"');
  });
});
