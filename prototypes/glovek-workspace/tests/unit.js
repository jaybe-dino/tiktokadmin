/* 순수 로직 점검 — 브라우저 없이 node 로 돌린다.
 *   사용: node tests/unit.js
 *   util.js / model.js 를 그대로 읽어 window 흉내만 내고 실행한다.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const sandbox = {
  window: {},
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
  console, URL, Blob: class {}, TextDecoder, DOMParser: class {}, Date, Math, JSON
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
["assets/js/util.js", "assets/js/model.js"].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
});
const U = sandbox.window.GV.util;
const M = sandbox.window.GV.model;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log("  X " + name + (extra ? " -- " + extra : ""));
}
function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
}

console.log("1) 매출 구간 경계 - 상한은 미만");
eq("null 은 미확인", M.revenueBand(null), "미확인");
eq("0 은 확인값 0원", M.revenueBand(0), "0원(확인값)");
ok("0 과 미확인은 다른 값", M.revenueBand(0) !== M.revenueBand(null));
eq("9.99억은 10억 미만", M.revenueBand(999999999), "10억원 미만");
eq("정확히 10억은 10억~50억", M.revenueBand(1e9), "10억~50억원");
eq("49.9억은 10억~50억", M.revenueBand(4999999999), "10억~50억원");
eq("정확히 50억은 50억~100억", M.revenueBand(5e9), "50억~100억원");
eq("정확히 100억은 100억~500억", M.revenueBand(1e10), "100억~500억원");
eq("정확히 500억은 500억 이상", M.revenueBand(5e10), "500억원 이상");

console.log("2) 회사 연매출은 회사 범위·신고/근거확인 상태·연도가 모두 있어야 한다");
const ent = (rev) => ({
  id: "e", name: "t", kind: "company", legalName: "t(주)", category: "리빙",
  contacts: [{ phone: "010-0000-0000" }], revenue: rev
});
eq("회사 별도 + 신고 + 연도", M.companyRevenueAmount(ent({ amount: 2e9, year: 2025, scope: "company_separate", status: "reported" })), 2e9);
eq("브랜드 단위는 회사 연매출 아님", M.companyRevenueAmount(ent({ amount: 2e9, year: 2025, scope: "brand", status: "reported" })), null);
eq("AI 추정은 회사 연매출 아님", M.companyRevenueAmount(ent({ amount: 2e9, year: 2025, scope: "company_separate", status: "estimated" })), null);
eq("연도 없으면 아님", M.companyRevenueAmount(ent({ amount: 2e9, year: null, scope: "company_separate", status: "verified" })), null);
eq("브랜드 단위 구간은 미확인", M.companyRevenueBand(ent({ amount: 2e9, year: 2025, scope: "brand", status: "reported" })), "미확인");
ok("브랜드 단위는 참고값", M.referenceRevenue(ent({ amount: 2e9, year: 2025, scope: "brand", status: "reported" })).why === "브랜드 단위");
eq("회사 신고값은 회사 실적에 표시하되 확인 상태를 구분", M.referenceRevenue(ent({ amount: 2e9, year: 2025, scope: "company_separate", status: "reported" })), null);

console.log("3) verified 묶음은 모두 갖춰야 한다");
const full = { amount: 1e9, year: 2025, legalEntity: "테스트(주)", scope: "company_separate", sourceUrl: "https://a.example.invalid" };
ok("완전한 묶음 통과", M.verifiedBundle(full).ok);
["amount", "year", "legalEntity", "sourceUrl"].forEach((k) => {
  const part = Object.assign({}, full);
  part[k] = (k === "amount" || k === "year") ? null : "";
  ok(k + " 없으면 거절", !M.verifiedBundle(part).ok);
});
ok("브랜드 범위면 거절", !M.verifiedBundle(Object.assign({}, full, { scope: "brand" })).ok);
eq("L3 는 완전한 묶음일 때만", M.derivedReadiness(ent(Object.assign({}, full, { status: "verified" }))), "L3");
eq("연도 없는 verified 는 L2", M.derivedReadiness(ent(Object.assign({}, full, { status: "verified", year: null }))), "L2");
eq("법인 없는 verified 는 L2", M.derivedReadiness(ent(Object.assign({}, full, { status: "verified", legalEntity: "" }))), "L2");

const forcedUnverified = ent(Object.assign({}, full, { status: "reported" }));
forcedUnverified.readinessOverride = { level: "L3" };
eq("수동 L3도 근거 확인 전에는 허용하지 않음", M.readinessOf(forcedUnverified), "L2");
const forcedMissing = ent(Object.assign({}, full, { status: "verified", year: null }));
forcedMissing.readinessOverride = { level: "L3" };
eq("수동 L3도 기준연도 없으면 허용하지 않음", M.readinessOf(forcedMissing), "L2");
const forcedVerified = ent(Object.assign({}, full, { status: "verified" }));
forcedVerified.readinessOverride = { level: "L3" };
eq("근거 묶음이 완전한 수동 L3는 허용", M.readinessOf(forcedVerified), "L3");

console.log("4) 수주 게이트는 계약 범위를 쓴다(고객 회계 범위 아님)");
const wonReq = M.moveRequirements("won");
ok("수주에 contractScope 필요", wonReq.fields.indexOf("contractScope") >= 0);
ok("수주에 revenueScope 를 쓰지 않음", wonReq.fields.indexOf("revenueScope") < 0);
ok("금액 없으면 거절", !M.validateMove("won", { contractAmount: "", contractDate: "2026-11-01", contractScope: "운영 대행" }).ok);
ok("계약 범위 없으면 거절", !M.validateMove("won", { contractAmount: "1000000", contractDate: "2026-11-01", contractScope: "" }).ok);
ok("날짜 형식 아니면 거절", !M.validateMove("won", { contractAmount: "1000000", contractDate: "어제", contractScope: "운영 대행" }).ok);
const wonOk = M.validateMove("won", { contractAmount: "8,600,000", contractDate: "2026-11-01", contractScope: "일본 운영 대행 월 단위" });
ok("정상 입력 통과", wonOk.ok);
eq("콤마 금액 파싱", wonOk.patch.contractAmount, 8600000);
eq("계약 범위 저장", wonOk.patch.contractScope, "일본 운영 대행 월 단위");
ok("보류는 사유 필요", !M.validateMove("hold", { reason: "" }).ok);
ok("사유 있으면 통과", M.validateMove("hold", { reason: "예산 보류" }).ok);
ok("계약검토는 금액·날짜 필요", !M.validateMove("contract_review", { expectedAmount: "", contractDate: "" }).ok);

console.log("5) 헤더 추정 - 정확 일치 먼저, 그다음 긴 힌트");
eq("매출연도", M.guessField("매출연도"), "revenueYear");
eq("매출 기준연도", M.guessField("매출 기준연도"), "revenueYear");
eq("회사연매출", M.guessField("회사연매출"), "revenueAmount");
eq("회사 연매출 금액(원)", M.guessField("회사 연매출 금액(원)"), "revenueAmount");
eq("매출근거URL", M.guessField("매출근거URL"), "revenueSourceUrl");
eq("revenue_source_url", M.guessField("revenue_source_url"), "revenueSourceUrl");
eq("revenue_year", M.guessField("revenue_year"), "revenueYear");
eq("담당자명", M.guessField("담당자명"), "contactName");
eq("담당자", M.guessField("담당자"), "owner");
eq("contact_name", M.guessField("contact_name"), "contactName");
eq("external_id", M.guessField("external_id"), "extId");
eq("외부ID", M.guessField("외부ID"), "extId");
eq("inflow_at", M.guessField("inflow_at"), "inflowAt");
eq("유입일시", M.guessField("유입일시"), "inflowAt");
eq("아예 모르면 빈값", M.guessField("ZZZ"), "");

console.log("6) KST 날짜·시각");
eq("KST 입력 -> ISO", U.kstInputToIso("2026-11-01T09:30"), "2026-11-01T00:30:00.000Z");
eq("ISO -> KST 입력값", U.kstInputValue("2026-11-01T00:30:00.000Z"), "2026-11-01T09:30");
eq("왕복 보존", U.kstInputValue(U.kstInputToIso("2026-03-02T23:59")), "2026-03-02T23:59");
eq("없는 날짜 거절", U.kstInputToIso("2026-02-31T10:00"), null);
eq("형식 틀리면 거절", U.kstInputToIso("2026-11-01"), null);
eq("KST 표시", U.fmtKst("2026-11-01T00:30:00.000Z"), "2026-11-01 09:30");
ok("시간대 없는 날짜시각은 KST", U.parseDate("2026-11-01 09:30").toISOString() === "2026-11-01T00:30:00.000Z");
ok("Z 가 붙으면 UTC 그대로", U.parseDate("2026-11-01T09:30:00Z").toISOString() === "2026-11-01T09:30:00.000Z");

console.log("7) 안전 처리");
eq("javascript 스킴 차단", U.safeUrl("javascript:alert(1)"), null);
eq("data 스킴 차단", U.safeUrl("data:text/html,x"), null);
eq("자격증명 포함 차단", U.safeUrl("https://u:p@a.example.invalid"), null);
eq("bare 도메인 정규화", U.safeUrl("a.example.invalid"), "https://a.example.invalid/");
eq("수식 시작 차단", U.safeUrl("=HYPERLINK(1)"), null);
eq("이메일 검증", U.safeEmail("a@b.example.com"), "a@b.example.com");
eq("잘못된 이메일 거절", U.safeEmail("a@b"), null);
eq("CSV 수식 주입 방지", U.csvCell("=1+1"), "'=1+1");
eq("CSV 따옴표 처리", U.csvCell('a"b,c'), '"a""b,c"');
eq("HTML 이스케이프", U.esc("<img src=x onerror=1>"), "&lt;img src=x onerror=1&gt;");
eq("제어문자 제거", U.clean("a\u0000b"), "a b");

console.log("8) CSV 파싱");
const rows = U.parseCsv('a,b\n"1,2",3\r\n"line\nbreak",4\n');
eq("행 수", rows.length, 3);
eq("따옴표 안 콤마", rows[1][0], "1,2");
ok("따옴표 안 줄바꿈", rows[2][0].indexOf("\n") > 0);

console.log("9) 정렬 - 미확인은 뒤로");
const sorted = U.sortBy([{ v: 3 }, { v: null }, { v: 1 }], (x) => x.v, "desc").map((x) => x.v);
eq("내림차순 + null 뒤", JSON.stringify(sorted), JSON.stringify([3, 1, null]));

console.log("");
console.log(pass + " 통과, " + fail + " 실패");
process.exit(fail ? 1 : 0);
