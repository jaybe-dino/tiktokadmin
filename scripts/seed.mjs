#!/usr/bin/env node
// 로컬 개발용 샘플 데이터. 운영 DB 에서는 실행하지 말 것.
// 사용: DATABASE_URL=... node scripts/seed.mjs
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 필요");
  process.exit(1);
}
const client = new pg.Client({ connectionString: DATABASE_URL });

const ADMINS = [
  ["jaybe@dinostudio.kr", "제이비", "exec"],
  ["intake@glovek.space", "유입담당", "intake"],
  ["sales@glovek.space", "영업담당", "sales"],
  ["onboard@glovek.space", "온보딩담당", "onboard"],
  ["ads@glovek.space", "광고담당", "ads"],
];

const BRANDS = [
  { brand_name: "코스메랩", email: "hello@cosmelab.kr", phone: "01011112222", state: "docs", contract_type: "onboarding", source: "apply_consult", plan: "onboarding_onetime", pay_status: "once_paid", grade: "A", rec_track: "onboarding", category: "뷰티", owner_onboard: "onboard@glovek.space", biz_no: "1112233444" },
  { brand_name: "핏앤핏", email: "team@fitnfit.co", phone: "01033334444", state: "live_mall", contract_type: "mall", source: "glovek_consult", plan: "live_focus_490k", pay_status: "subscribed", grade: "B", rec_track: "live", category: "헬스", owner_ads: "ads@glovek.space" },
  { brand_name: "그린티하우스", email: "info@greentea.kr", state: "contact", source: "glovek_consult", grade: "S", rec_track: "onboarding", category: "F&B", owner_sales: "sales@glovek.space" },
  { brand_name: "루미너스", email: "hi@luminous.co", state: "lead_new", source: "tp_seminar", category: "뷰티" },
];

async function main() {
  await client.connect();

  for (const [id, name, role] of ADMINS) {
    await client.query(
      `INSERT INTO admin_users (id, name, role) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role`,
      [id, name, role],
    );
  }
  console.log(`  ↳ admin_users ${ADMINS.length}건`);

  for (const b of BRANDS) {
    const cols = Object.keys(b);
    const vals = Object.values(b);
    const ph = cols.map((_, i) => `$${i + 1}`).join(",");
    await client.query(
      `INSERT INTO brands (${cols.join(",")}) VALUES (${ph})
       ON CONFLICT (email) DO NOTHING`,
      vals,
    );
  }
  console.log(`  ↳ brands ${BRANDS.length}건`);

  // 온보딩 브랜드에 서류 템플릿
  const { rows } = await client.query("SELECT id FROM brands WHERE email='hello@cosmelab.kr'");
  if (rows[0]) {
    const bid = rows[0].id;
    const items = [
      ["biz_reg", "사업자등록증", true],
      ["step1", "STEP1 · 기본정보", true],
      ["step2", "STEP2 · UBO/이사", false],
      ["logistics", "물류계약서", false],
    ];
    for (const [key, label, done] of items) {
      await client.query(
        `INSERT INTO doc_items (brand_id, template, item_key, label, done)
         VALUES ($1,'onboarding',$2,$3,$4) ON CONFLICT (brand_id, item_key) DO NOTHING`,
        [bid, key, label, done],
      );
    }
    console.log(`  ↳ doc_items 4건 (코스메랩)`);
  }

  console.log("\n완료.");
}

main()
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  })
  .finally(() => client.end());
