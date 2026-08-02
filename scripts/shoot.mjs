// UI 전수 스크린샷 QA — 로그인 쿠키로 전 화면을 순회하며 스크린샷 + 콘솔에러·레이아웃붕괴 검출.
//
// 사용법:
//   1) 로컬 서버 기동(예: PORT=3100 npm start) + DATABASE_URL 로 마이그레이션·시드 완료
//   2) 세션 쿠키 값 생성:
//        node -e 'const{createHmac}=require("crypto");const e="you@ex.com";\
//          console.log(Buffer.from(e).toString("base64url")+"."+createHmac("sha256",process.env.ADMIN_SESSION_SECRET).update(e).digest("hex"))'
//   3) SHOOT_COOKIE=<위 값> SHOOT_BID=<브랜드UUID> node scripts/shoot.mjs [출력폴더]
//
// env: SHOOT_BASE(기본 http://localhost:3100) · SHOOT_COOKIE(필수) · SHOOT_BID(brand360용) · SHOOT_CHROME(chromium 경로)
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.SHOOT_BASE || "http://localhost:3100";
const COOKIE = process.env.SHOOT_COOKIE || "";
const BID = process.env.SHOOT_BID || "";
const CHROME = process.env.SHOOT_CHROME || process.env.PLAYWRIGHT_CHROMIUM || undefined;
const OUT = process.argv[2] || "./ui-shots";
if (!COOKIE) { console.error("SHOOT_COOKIE 환경변수가 필요합니다(로그인 세션 쿠키 값)."); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["today", "/today"], ["board", "/"], ["queue", "/queue"], ["monitor", "/monitor"],
  ["customers", "/customers"], ["import", "/import"], ["duplicates", "/duplicates"],
  ["meetings", "/meetings"], ["proposals", "/proposals"], ["contracts", "/contracts"],
  ["mkt", "/mkt"], ["send", "/send"], ["mail", "/mail"], ["drafts", "/drafts"],
  ["campaigns", "/campaigns"], ["qna", "/qna"], ["docs", "/docs"], ["products", "/products"],
  ["assets", "/assets"], ["ops", "/ops"], ["cs", "/cs"], ["settlements", "/settlements"],
  ["pay", "/pay"], ["agents", "/agents"], ["insights", "/insights"], ["approvals", "/approvals"],
  ["slack", "/slack"], ["settings", "/settings"], ["guide", "/guide"],
  ...(BID ? [["brand360", `/brand/${BID}`]] : []),
];

const host = new URL(BASE).hostname;
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "glovek_admin", value: COOKIE, domain: host, path: "/" }]);

const report = [];
for (const [name, path] of ROUTES) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("PAGEERR: " + String(e).slice(0, 160)));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().split("/").pop()}`); });
  let status = 0;
  try {
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
    status = resp ? resp.status() : 0;
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  } catch (e) {
    errors.push("NAV: " + String(e).slice(0, 160));
  }
  let overflow = false;
  try { overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 4); } catch {}
  report.push({ name, path, status, errors, overflow });
  console.log(`${status} ${overflow ? "⟷OVERFLOW" : "        "} ${name.padEnd(12)} ${errors.length ? "❌ " + errors[0] : "✓"}`);
  await page.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
const bad = report.filter((r) => r.status >= 400 || r.errors.length || r.overflow);
console.log(`\n=== 요약: 전체 ${report.length} · 문제 ${bad.length} ===`);
for (const b of bad) console.log(`  ${b.name}: status=${b.status} overflow=${b.overflow} err=${b.errors.length}`);
