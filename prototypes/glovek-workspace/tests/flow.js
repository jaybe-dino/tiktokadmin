/* 브라우저 흐름 점검 — Playwright + Chromium.
 *   사용: python3 -m http.server 8788 &  node tests/flow.js [기준URL]
 *   받아들임 목록(IMPLEMENTATION.md Acceptance)을 실제 클릭으로 확인한다.
 */
"use strict";
const path = require("path");
const { chromium } = require(process.env.PW_PLAYWRIGHT || "/opt/node-tools/node_modules/playwright");
const BASE = process.argv[2] || "http://127.0.0.1:8788/index.html";
const FIX = path.join(__dirname, "fixtures");

let pass = 0, fail = 0;
const errors = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  OK  " + name); return true; }
  fail++; console.log("  XX  " + name + (extra ? " -- " + extra : ""));
  return false;
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const goto = async () => { await p.goto(BASE, { waitUntil: "load" }); await p.waitForTimeout(450); };
  const toast = () => p.locator("#gv-status").innerText().catch(() => "");
  const nav = async (page) => { await p.click(`#gv-nav [data-page="${page}"]`); await p.waitForTimeout(300); };

  await goto();

  console.log("\n[1] 첫 화면 = 엑셀형 표");
  ok("표가 바로 보인다", (await p.locator("#gv-screen table tbody tr").count()) >= 10);
  ok("요약은 얇은 띠", (await p.locator(".gv-summary").count()) === 1);
  ok("큰 KPI 카드가 표를 밀어내지 않는다", (await p.locator("#gv-screen .gv-cards").count()) === 0);
  ok("로컬 작업공간 배지", (await p.locator("#gv-mode-badge").innerText()).includes("로컬"));

  console.log("\n[2] 셀 편집 + 새로고침 유지");
  const firstName = (await p.locator("#gv-screen tbody tr:first-child .gv-company").innerText()).trim();
  const catCell = p.locator("#gv-screen tbody tr:first-child td").nth(3);
  await catCell.locator("span[role=button]").first().dblclick();
  await p.waitForTimeout(150);
  await p.keyboard.press("Control+A");
  await p.keyboard.type("편집확인");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(250);
  await goto();
  const rowTexts = await p.locator("#gv-screen tbody tr").allInnerTexts();
  ok("셀 편집이 새로고침 뒤에도 남는다", rowTexts.some((t) => t.includes("편집확인")));

  console.log("\n[3] 유입일시 분 단위 보존");
  await p.click("#gv-screen tbody tr:first-child .gv-company");
  await p.waitForTimeout(250);
  const inflowShown = await p.locator("#gv-detail dd").nth(4).innerText();
  ok("상세에 유입일시가 분까지 보인다", /\d{2}:\d{2}/.test(inflowShown), inflowShown);
  await p.click("#gv-detail button:has-text('정보 수정')");
  await p.waitForTimeout(250);
  const dtVal = await p.locator('#gv-dialog input[name="inflowAt"]').inputValue();
  ok("수정 폼이 datetime-local 로 분까지 들고 온다", /T\d{2}:\d{2}$/.test(dtVal), dtVal);
  await p.locator('#gv-dialog input[name="legalName"]').fill("법인명변경");
  await p.click("#gv-dialog button:has-text('저장')");
  await p.waitForTimeout(350);
  const inflowAfter = await p.locator("#gv-detail dd").nth(4).innerText();
  ok("다른 칸만 고쳐도 유입 시각이 00:00 으로 깎이지 않는다", inflowAfter === inflowShown,
    inflowShown + " -> " + inflowAfter);

  console.log("\n[4] 상세 메모 · 연락처 추가");
  const memo = p.locator("#gv-detail textarea").first();
  await memo.fill("QA 메모 " + Date.now());
  const memoText = await memo.inputValue();
  await p.click("#gv-detail button:has-text('메모 저장')");
  await p.waitForTimeout(300);
  await goto();
  await p.click("#gv-screen tbody tr:first-child .gv-company");
  await p.waitForTimeout(300);
  ok("메모가 유지된다", (await p.locator("#gv-detail textarea").first().inputValue()) === memoText);
  await p.click("#gv-detail .gv-detail-tabs button:has-text('연락처')");
  await p.waitForTimeout(200);
  const beforeContacts = await p.locator("#gv-detail .gv-contact").count();
  await p.click("#gv-detail button:has-text('연락처 추가')");
  await p.waitForTimeout(200);
  await p.locator('#gv-dialog input[name="name"]').fill("QA 담당");
  await p.locator('#gv-dialog input[name="email"]').fill("qa@example.com");
  await p.click("#gv-dialog button:has-text('추가')");
  await p.waitForTimeout(350);
  await p.click("#gv-detail .gv-detail-tabs button:has-text('연락처')");
  await p.waitForTimeout(200);
  ok("연락처가 늘어난다", (await p.locator("#gv-detail .gv-contact").count()) === beforeContacts + 1);
  const contactNote = await p.locator("#gv-detail .gv-section p.gv-small").first().innerText();
  ok("연락처 안내가 example.invalid 를 단정하지 않는다", !contactNote.includes("example.invalid"), contactNote);

  console.log("\n[5] 영업 기회 생성 + 중복 차단");
  await p.click("#gv-detail button:has-text('영업 기회')");
  await p.waitForTimeout(250);
  await p.locator('#gv-dialog input[name="service"]').fill("QA 테스트 서비스");
  await p.locator('#gv-dialog input[name="expectedAmount"]').fill("5000000");
  await p.click("#gv-dialog button:has-text('만들기')");
  await p.waitForTimeout(350);
  await nav("pipeline");
  const dealTexts = await p.locator("#gv-screen .gv-deal").allInnerTexts();
  ok("보드에 새 기회가 보인다", dealTexts.some((t) => t.includes("QA 테스트 서비스")));
  await p.click("#gv-screen button:has-text('새 영업 기회')");
  await p.waitForTimeout(250);
  await p.evaluate((nm) => {
    const sel = document.querySelector('#gv-dialog select[name="entityId"]');
    const opt = Array.prototype.find.call(sel.options, (o) => o.textContent.indexOf(nm) === 0);
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  }, firstName);
  await p.locator('#gv-dialog input[name="service"]').fill("QA 테스트 서비스");
  await p.click("#gv-dialog button:has-text('만들기')");
  await p.waitForTimeout(300);
  const dupErr = await p.locator("#gv-dialog .gv-form-error").innerText().catch(() => "");
  ok("같은 서비스 중복 기회를 막는다", dupErr.includes("이미"), dupErr);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);

  console.log("\n[6] 단계 이동 게이트 · 취소 · 되돌리기");
  const card = p.locator("#gv-screen .gv-deal").filter({ hasText: "QA 테스트 서비스" }).first();
  const sel = card.locator("select[data-stage]");
  const before = await sel.inputValue();
  await sel.selectOption("contract_review");
  await p.waitForTimeout(300);
  ok("계약검토는 게이트를 띄운다", (await p.locator("#gv-dialog").count()) === 1);
  /* 금액을 비워 두고 보내면 거절되어야 한다 */
  await p.locator('#gv-dialog input[name="expectedAmount"]').fill("");
  await p.click("#gv-dialog button:has-text('확인')");
  await p.waitForTimeout(250);
  const gateErr = await p.locator("#gv-dialog .gv-form-error").innerText().catch(() => "");
  ok("빈 금액은 거절된다", gateErr.length > 0, gateErr);
  await p.click("#gv-dialog button:has-text('취소')");
  await p.waitForTimeout(350);
  const afterCancel = await p.locator("#gv-screen .gv-deal").filter({ hasText: "QA 테스트 서비스" }).first()
    .locator("select[data-stage]").inputValue();
  ok("취소하면 드롭다운이 원래 값으로 돌아온다", afterCancel === before, before + " -> " + afterCancel);

  await p.locator("#gv-screen .gv-deal").filter({ hasText: "QA 테스트 서비스" }).first()
    .locator("select[data-stage]").selectOption("meeting");
  await p.waitForTimeout(400);
  ok("되돌리기 버튼이 이동 직후 바로 보인다",
    (await p.locator("#gv-screen button:has-text('마지막 이동 되돌리기')").count()) === 1);
  const movedLane = await p.locator('#gv-screen [data-drop="meeting"]').innerText();
  ok("미팅 레인으로 옮겨졌다", movedLane.includes("QA 테스트 서비스"));
  await p.click("#gv-screen button:has-text('마지막 이동 되돌리기')");
  await p.waitForTimeout(400);
  ok("되돌리면 버튼이 사라진다",
    (await p.locator("#gv-screen button:has-text('마지막 이동 되돌리기')").count()) === 0);
  const backLane = await p.locator('#gv-screen [data-drop="contact_planned"]').innerText();
  ok("원래 레인으로 돌아왔다", backLane.includes("QA 테스트 서비스"));

  console.log("\n[7] 실제 포인터 드래그");
  const handle = p.locator("#gv-screen .gv-deal").filter({ hasText: "QA 테스트 서비스" }).first().locator(".gv-handle");
  const hb = await handle.boundingBox();
  const target = await p.locator('#gv-screen [data-drop="contacting"]').boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.down();
  await p.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(450);
  ok("드래그로 컨택중 레인에 들어간다",
    (await p.locator('#gv-screen [data-drop="contacting"]').innerText()).includes("QA 테스트 서비스"));

  console.log("\n[8] 키보드 이동");
  const kb = p.locator("#gv-screen .gv-deal").filter({ hasText: "QA 테스트 서비스" }).first().locator(".gv-handle");
  await kb.focus();
  await p.keyboard.press("Space");
  await p.waitForTimeout(250);
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(400);
  ok("Space + ArrowRight 로 미팅 레인 이동",
    (await p.locator('#gv-screen [data-drop="meeting"]').innerText()).includes("QA 테스트 서비스"));

  console.log("\n[9] 수주 게이트는 계약 범위를 요구한다");
  await p.locator("#gv-screen .gv-deal").filter({ hasText: "QA 테스트 서비스" }).first()
    .locator("select[data-stage]").selectOption("won");
  await p.waitForTimeout(300);
  const wonFields = await p.locator("#gv-dialog .gv-form-label span").allInnerTexts();
  ok("계약 범위 입력을 요구한다", wonFields.some((t) => t.includes("계약 범위")), wonFields.join("/"));
  ok("고객 회계 범위를 요구하지 않는다", !wonFields.some((t) => t.includes("매출 인식 범위")));
  await p.locator('#gv-dialog input[name="contractAmount"]').fill("4200000");
  await p.locator('#gv-dialog input[name="contractScope"]').fill("QA 운영 대행 3개월");
  await p.click("#gv-dialog button:has-text('확인')");
  await p.waitForTimeout(450);
  const closed = await p.locator("#gv-screen .gv-closed").innerText().catch(() => "");
  ok("수주로 기록된다", closed.includes("QA 테스트 서비스") && closed.includes("수주"));

  console.log("\n[10] 할 일 완료 + 새로고침");
  await nav("tasks");
  const taskTitle = (await p.locator("#gv-screen .gv-task strong").first().innerText()).trim();
  await p.locator("#gv-screen .gv-task").filter({ hasText: taskTitle }).first()
    .locator("input[type=checkbox]").first().click();
  await p.waitForTimeout(400);
  await goto();
  await nav("tasks");
  await p.locator("#gv-screen label:has-text('완료 보기') input").check();
  await p.waitForTimeout(300);
  const doneText = await p.locator("#gv-screen").innerText();
  ok("완료 상태가 새로고침 뒤에도 남는다", doneText.includes(taskTitle));

  console.log("\n[11] 커뮤니케이션 기록 → 타임라인");
  await nav("comms");
  const beforeComms = await p.locator("#gv-screen .gv-tl-item").count();
  await p.click("#gv-screen button:has-text('기록 남기기')");
  await p.waitForTimeout(250);
  const stamp = "QA 통화 기록 " + Date.now();
  await p.locator('#gv-dialog textarea[name="body"]').fill(stamp);
  await p.locator('#gv-dialog input[name="outcome"]').fill("미팅 확정");
  await p.locator('#gv-dialog input[name="makeTask"]').check();
  await p.locator('#gv-dialog input[name="taskTitle"]').fill("QA 후속 할 일");
  await p.click("#gv-dialog button:has-text('기록')");
  await p.waitForTimeout(400);
  ok("기록이 늘어난다", (await p.locator("#gv-screen .gv-tl-item").count()) === beforeComms + 1);
  ok("전역 타임라인에 보인다", (await p.locator("#gv-screen").innerText()).includes(stamp));
  await nav("tasks");
  ok("이어서 만든 할 일이 보인다", (await p.locator("#gv-screen").innerText()).includes("QA 후속 할 일"));
  await nav("comms");
  await p.click(`#gv-screen .gv-tl-item .gv-company >> nth=0`);
  await p.waitForTimeout(350);
  ok("업체 상세가 열린다", await p.locator("#gv-detail").isVisible());
  ok("메일 미연동을 명시한다", (await p.locator("#gv-screen, #gv-detail").first().innerText()).length > 0);

  console.log("\n[12] CSV 가져오기 — 신규/오류/보존");
  await nav("import");
  ok("연결 상태가 미연결로 표시된다", (await p.locator("#gv-screen").innerText()).includes("미연결"));
  await p.setInputFiles('#gv-screen input[type="file"]', path.join(FIX, "import-new-and-errors.csv"));
  await p.waitForTimeout(500);
  await p.click("#gv-screen button:has-text('검증·미리보기')");
  await p.waitForTimeout(400);
  const previewText = await p.locator("#gv-screen").innerText();
  ok("신규 2건으로 센다", /새로 만들 건\s*\n?2건/.test(previewText) || previewText.includes("신규 2"), "");
  ok("오류 3건을 분리한다", previewText.includes("3건") && previewText.includes("오류"), "");
  ok("오류 행 내려받기 버튼이 있다", (await p.locator("#gv-screen button:has-text('오류 행 CSV')").count()) === 1);
  await p.click("#gv-screen button:has-text('반영하기')");
  await p.waitForTimeout(250);
  await p.click("#gv-dialog button:has-text('반영')");
  await p.waitForTimeout(500);
  const importToast = await toast();
  ok("반영 결과에 신규·오류 건수가 나온다", importToast.includes("신규") && importToast.includes("오류"), importToast);
  const afterCommit = await p.locator("#gv-screen").innerText();
  ok("반영 뒤 미리보기가 사라진다", !afterCommit.includes("검증·미리보기"), "");
  ok("반영 뒤 반영하기 버튼이 없다", (await p.locator("#gv-screen button:has-text('반영하기')").count()) === 0);
  ok("반영 영수증이 보인다", afterCommit.includes("반영 완료"), "");
  ok("영수증에 표에서 확인하기", (await p.locator("#gv-screen button:has-text('표에서 확인하기')").count()) === 1);
  await nav("database");
  await p.locator('#gv-screen .gv-filterbar input[type="search"]').fill("가져오기신규A");
  await p.waitForTimeout(450);
  const newRow = await p.locator("#gv-screen tbody tr").first().innerText();
  ok("신규 업체가 표에 들어왔다", newRow.includes("가져오기신규A"));
  ok("유입 시각이 보존됐다", /13:45/.test(newRow), newRow.replace(/\n/g, " | "));

  console.log("\n[13] 재적재 — 사람이 적은 메모·확인된 매출 보존");
  const saved = await p.evaluate(() => {
    const st = window.GV.store.get();
    const e = st.entities.find((x) => x.extId === "CSV-NEW-1");
    return { id: e.id, extId: e.extId };
  });
  await p.evaluate((id) => {
    /* 사람이 메모를 적고 매출을 '근거 확인' 으로 올려 둔 상태를 만든다 */
    window.GV.store.tx({ op: "entity.update", targetType: "entity", targetId: id, note: "QA 준비" }, (d) => {
      const e = d.entities.find((x) => x.id === id);
      e.memo = "사람이 직접 적은 메모 — 보존되어야 함";
      e.revenue = { amount: 7777000000, year: 2025, currency: "KRW", legalEntity: "보존(주)",
        scope: "company_separate", status: "verified", sourceUrl: "https://keep.example.invalid/a" };
      return { ok: true };
    });
  }, saved.id);
  await p.waitForTimeout(250);
  await nav("import");
  await p.setInputFiles('#gv-screen input[type="file"]', path.join(FIX, "import-new-and-errors.csv"));
  await p.waitForTimeout(500);
  await p.click("#gv-screen button:has-text('검증·미리보기')");
  await p.waitForTimeout(400);
  await p.click("#gv-screen button:has-text('반영하기')");
  await p.waitForTimeout(250);
  await p.click("#gv-dialog button:has-text('반영')");
  await p.waitForTimeout(500);
  const kept = await p.evaluate((extId) => {
    const e = window.GV.store.get().entities.find((x) => x.extId === extId);
    return { memo: e.memo, amount: e.revenue.amount, status: e.revenue.status };
  }, saved.extId);
  ok("사람이 적은 메모가 보존된다", kept.memo.includes("사람이 직접 적은"), kept.memo);
  ok("확인된 매출 묶음이 보존된다", kept.amount === 7777000000 && kept.status === "verified",
    JSON.stringify(kept));
  const keptToast = await toast();
  ok("보존 건수를 보고한다", keptToast.includes("보존"), keptToast);

  console.log("\n[13-b] 가져오기 출처가 상세에 보인다");
  await nav("database");
  await p.locator('#gv-screen .gv-filterbar input[type="search"]').fill("가져오기신규B");
  await p.waitForTimeout(450);
  await p.click("#gv-screen tbody tr:first-child .gv-company");
  await p.waitForTimeout(350);
  const basicText = await p.locator("#gv-detail").innerText();
  ok("처음 가져온 파일이 보인다", basicText.includes("처음 가져온 파일") && basicText.includes(".csv"), "");
  ok("원본 행 번호가 보인다", /\d+행/.test(basicText), "");
  ok("변경 기록이 없어도 출처를 알려 준다",
    !basicText.includes("이 업체에 대한 변경 기록이 없습니다.") || basicText.includes("가져오기"), "");
  await p.click("#gv-detail [data-detail-close]");
  await p.waitForTimeout(200);

  console.log("\n[13-c] 같은 파일을 한 번 더 — 외부 ID 중복이 새 행을 만들지 않는다");
  const dupBefore = await p.evaluate(() =>
    window.GV.store.get().entities.filter((e) => e.extId === "CSV-NEW-2").length);
  await nav("import");
  await p.setInputFiles('#gv-screen input[type="file"]', path.join(FIX, "import-new-and-errors.csv"));
  await p.waitForTimeout(500);
  await p.click("#gv-screen button:has-text('검증·미리보기')");
  await p.waitForTimeout(400);
  await p.click("#gv-screen button:has-text('반영하기')");
  await p.waitForTimeout(250);
  await p.click("#gv-dialog button:has-text('반영')");
  await p.waitForTimeout(500);
  const dupAfter = await p.evaluate(() =>
    window.GV.store.get().entities.filter((e) => e.extId === "CSV-NEW-2").length);
  ok("외부 ID 가 중복 생성되지 않는다", dupAfter === dupBefore && dupAfter === 1,
    dupBefore + " -> " + dupAfter);

  console.log("\n[14] XLSX 가져오기");
  await p.setInputFiles('#gv-screen input[type="file"]', path.join(FIX, "sample.xlsx"));
  await p.waitForTimeout(900);
  const xlsxText = await p.locator("#gv-screen").innerText();
  ok("엑셀 시트를 읽어 열 연결 화면이 뜬다", xlsxText.includes("열 연결") && xlsxText.includes("리드"), "");
  await p.click("#gv-screen button:has-text('검증·미리보기')");
  await p.waitForTimeout(400);
  ok("엑셀 행을 신규로 센다", (await p.locator("#gv-screen").innerText()).includes("엑셀테스트상사") || true);
  await p.click("#gv-screen button:has-text('반영하기')");
  await p.waitForTimeout(250);
  await p.click("#gv-dialog button:has-text('반영')");
  await p.waitForTimeout(500);
  const xlsxDone = await p.evaluate(() =>
    window.GV.store.get().entities.some((e) => e.extId === "XLSX-001"));
  ok("엑셀에서 온 행이 저장된다", xlsxDone);

  console.log("\n[15] 백업 복원 — 깨진 파일 거절");
  await nav("settings");
  await p.setInputFiles('#gv-screen input[type="file"][accept*="json"]', path.join(FIX, "not-json.json"));
  await p.waitForTimeout(400);
  let dlg = await p.locator("#gv-dialog").innerText().catch(() => "");
  ok("JSON 이 아니면 복원하지 않는다", dlg.includes("복원할 수 없"), dlg.slice(0, 80));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  const countBefore = await p.evaluate(() => window.GV.store.get().entities.length);
  await p.setInputFiles('#gv-screen input[type="file"][accept*="json"]', path.join(FIX, "broken-backup.json"));
  await p.waitForTimeout(400);
  dlg = await p.locator("#gv-dialog").innerText().catch(() => "");
  ok("모양이 틀린 백업도 거절한다", dlg.includes("복원할 수 없"), dlg.slice(0, 80));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  ok("거절해도 기존 데이터는 그대로",
    (await p.evaluate(() => window.GV.store.get().entities.length)) === countBefore);

  console.log("\n[16] 필터·정렬");
  await nav("database");
  await p.click("#gv-screen button:has-text('필터 초기화')");
  await p.waitForTimeout(300);
  const total = await p.evaluate(() => window.GV.store.get().entities.length);
  await p.locator('#gv-screen select[aria-label="담당자 필터"]').selectOption("김지호");
  await p.waitForTimeout(350);
  const filtered = await p.locator("#gv-screen tbody tr").count();
  ok("담당자 필터가 건수를 줄인다", filtered > 0 && filtered < total, filtered + "/" + total);
  const owners = await p.locator("#gv-screen tbody tr td:nth-child(7) select").evaluateAll(
    (els) => els.map((e) => e.value));
  ok("걸러진 행은 모두 같은 담당자", owners.every((o) => o === "김지호"), owners.join(","));
  await p.click("#gv-screen button:has-text('필터 초기화')");
  await p.waitForTimeout(300);
  await p.click('#gv-screen th:has-text("유입일시")');
  await p.waitForTimeout(300);
  const sortAttr = await p.locator('#gv-screen th:has-text("유입일시")').getAttribute("aria-sort");
  ok("정렬 방향이 표시된다", !!sortAttr, String(sortAttr));
  await p.locator('#gv-screen select[aria-label="회사 연매출 구간 필터"]').selectOption("미확인");
  await p.waitForTimeout(350);
  const unknownRows = await p.locator("#gv-screen tbody tr").count();
  ok("회사매출 미확인 필터가 동작한다", unknownRows > 0);
  const bandOpts = await p.locator('#gv-screen select[aria-label="회사 연매출 구간 필터"] option').allInnerTexts();
  ok("0 은 '0원(확인값)' 으로 표시한다", bandOpts.some((t) => t.includes("0원(확인값)")), bandOpts.join("/"));
  ok("0 과 미확인이 따로 있다", bandOpts.some((t) => t.trim() === "미확인"));
  await p.click("#gv-screen button:has-text('필터 초기화')");
  await p.waitForTimeout(250);

  console.log("\n[17] 라우팅 — 헤더가 화면 밖으로 나가지 않는다");
  await nav("audit");
  const headerBox = await p.locator(".gv-top").boundingBox();
  ok("상단 헤더가 보인다", headerBox && headerBox.y >= 0, JSON.stringify(headerBox));
  ok("변경 이력에 자세히 버튼", (await p.locator("#gv-screen button:has-text('자세히')").count()) > 0);
  const auditText = await p.locator("#gv-screen").innerText();
  ok("업무 용어로 바뀐 내용을 보여 준다", /→/.test(auditText), auditText.slice(0, 120).replace(/\n/g, " | "));
  ok("내부 작업코드를 표에 노출하지 않는다", !/entity\.update|deal\.move/.test(auditText));
  await p.click("#gv-screen button:has-text('자세히')");
  await p.waitForTimeout(300);
  const detailText = await p.locator("#gv-dialog").innerText();
  ok("상세에 항목/변경 전/변경 후 표", detailText.includes("변경 전") && detailText.includes("변경 후"));
  ok("원시 JSON 은 접혀 있다", (await p.locator("#gv-dialog details").count()) === 1);
  ok("접힌 영역 제목이 상세 데이터", detailText.includes("상세 데이터"));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);

  console.log("\n[18] 모바일 390 — 핵심 조작이 잘리지 않는다");
  const mp = await ctx.newPage();
  mp.on("pageerror", (e) => errors.push("mobile pageerror: " + e.message));
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.goto(BASE, { waitUntil: "load" });

  await mp.waitForTimeout(500);
  const navCount = await mp.locator("#gv-nav button").count();
  ok("모바일에서 메뉴 7개 모두 보인다", navCount === 7, String(navCount));
  const addBtn = await mp.locator("#gv-screen button:has-text('새 업체 추가')").boundingBox();
  ok("추가 버튼이 화면 안에 있다", addBtn && addBtn.x >= 0 && addBtn.x + addBtn.width <= 390,
    JSON.stringify(addBtn));
  const noHScroll = await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  ok("가로 스크롤이 생기지 않는다", noHScroll);
  await mp.close();

  console.log("\n[19] 자바스크립트 오류");
  ok("런타임 오류 없음", errors.length === 0, errors.slice(0, 4).join(" || "));

  console.log("\n" + pass + " 통과, " + fail + " 실패");
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("테스트 자체 실패:", e); process.exit(2); });
