#!/usr/bin/env node
// migrations/ 의 순번 .sql 파일을 순서대로 실행하고 schema_migrations 로 추적.
// 사용: DATABASE_URL=... node scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows } = await client.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ↳ skip ${file} (이미 적용됨)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`  ↳ apply ${file} ... `);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("✓");
      count++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.log("✗");
      throw err;
    }
  }
  console.log(`\n완료: ${count}개 마이그레이션 적용, ${files.length}개 파일.`);
}

main()
  .catch((err) => {
    console.error("\n✗ 마이그레이션 실패:", err.message);
    process.exit(1);
  })
  .finally(() => client.end());
