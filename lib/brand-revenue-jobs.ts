import { randomUUID } from "node:crypto";
import { query, queryOne, tx } from "./db";
import { estimateBrandRevenue, type RevenueIdentity } from "./brand-revenue-ai";

/** Idempotent first-arrival scheduling. Never resets completed research on duplicate leads. */
export async function enqueueBrandRevenue(brandId: string): Promise<void> {
  await query(`WITH added AS (
    INSERT INTO brand_revenue_jobs(brand_id) SELECT id FROM brands WHERE id=$1 AND revenue_estimate IS NULL
    ON CONFLICT DO NOTHING RETURNING brand_id)
    UPDATE brands SET revenue_estimate='{"status":"pending"}'::jsonb WHERE id IN(SELECT brand_id FROM added)`, [brandId]);
}
export async function requestBrandRevenue(brandId: string): Promise<void> {
  await tx(async c => {
    const requested = await c.query(`INSERT INTO brand_revenue_jobs(brand_id) VALUES($1)
      ON CONFLICT(brand_id) DO UPDATE SET status='pending',due_at=now()+interval '60 seconds',attempts=0,
        claim_token=NULL,lease_until=NULL,last_error=NULL,finished_at=NULL
      WHERE brand_revenue_jobs.status IN ('done','failed') RETURNING brand_id`, [brandId]);
    if (requested.rowCount) await c.query(`UPDATE brands SET revenue_estimate='{"status":"pending"}'::jsonb WHERE id=$1`, [brandId]);
  });
}
interface Job { brand_id: string; claim_token: string; attempts: number }
export async function runRevenueJobs(): Promise<{ processed: number; completed: number; failed: number; superseded: number }> {
  // Repair missed enqueue calls only for leads created after feature activation, not old customer DB.
  await query(`WITH added AS (
    INSERT INTO brand_revenue_jobs(brand_id,due_at)
    SELECT b.id,b.created_at+interval '60 seconds' FROM brands b,brand_revenue_settings s
    WHERE b.created_at>=s.activated_at AND b.revenue_estimate IS NULL
    ON CONFLICT DO NOTHING RETURNING brand_id)
    UPDATE brands SET revenue_estimate='{"status":"pending"}'::jsonb WHERE id IN(SELECT brand_id FROM added)`);
  await query(`WITH failed AS (
    UPDATE brand_revenue_jobs SET status='failed',last_error='WORKER_TIMEOUT',claim_token=NULL,lease_until=NULL
    WHERE status='running' AND lease_until<now() AND attempts>=3 RETURNING brand_id)
    UPDATE brands SET revenue_estimate='{"status":"failed","reason":"처리 시간 초과"}'::jsonb WHERE id IN(SELECT brand_id FROM failed)`);
  const token = randomUUID();
  const jobs = await query<Job>(`WITH due AS (
    SELECT brand_id FROM brand_revenue_jobs WHERE attempts<3 AND
      ((status='pending' AND due_at<=now()) OR (status='running' AND lease_until<now()))
    ORDER BY due_at LIMIT 2 FOR UPDATE SKIP LOCKED)
    UPDATE brand_revenue_jobs j SET status='running',attempts=attempts+1,claim_token=$1,lease_until=now()+interval '3 minutes'
    FROM due WHERE j.brand_id=due.brand_id RETURNING j.brand_id,j.claim_token,j.attempts`, [token]);
  const results = await Promise.all(jobs.map(async j => {
    try {
      await query(`UPDATE brands SET revenue_estimate='{"status":"running"}'::jsonb WHERE id=$1 AND EXISTS(
        SELECT 1 FROM brand_revenue_jobs WHERE brand_id=$1 AND claim_token=$2 AND status='running')`, [j.brand_id,j.claim_token]);
      const identity = await queryOne<RevenueIdentity>(`SELECT b.brand_name,b.brand_url,c.company_name_kr AS company_name
        FROM brands b LEFT JOIN brand_company c ON c.brand_id=b.id WHERE b.id=$1`, [j.brand_id]);
      if (!identity) throw new Error("BRAND_MISSING");
      const result = await estimateBrandRevenue(identity);
      const saved = await tx(async c => {
        const done = await c.query(`UPDATE brand_revenue_jobs SET status='done',finished_at=now(),claim_token=NULL,lease_until=NULL,last_error=NULL
          WHERE brand_id=$1 AND claim_token=$2 AND status='running' RETURNING brand_id`, [j.brand_id,j.claim_token]);
        if (done.rowCount) await c.query("UPDATE brands SET revenue_estimate=$2::jsonb WHERE id=$1", [j.brand_id,JSON.stringify(result)]);
        return Boolean(done.rowCount);
      });
      return saved ? "completed" : "superseded";
    } catch (err) {
      const code = ["AI_NOT_CONFIGURED","INVALID_REVENUE_RESULT","UNVERIFIED_REVENUE_SOURCE","INCOMPLETE_REVENUE_YEAR"].includes((err as Error)?.message) ? (err as Error).message : "AI_RESEARCH_FAILED";
      // Provider errors may contain prompts or secrets; store a fixed diagnostic only.
      await tx(async c => {
        const failed = await c.query(`UPDATE brand_revenue_jobs SET status=$3,due_at=now()+interval '5 minutes',
          claim_token=NULL,lease_until=NULL,last_error=$4
          WHERE brand_id=$1 AND claim_token=$2 AND status='running' RETURNING brand_id`,
          [j.brand_id,j.claim_token,j.attempts>=3?'failed':'pending',code]);
        if (failed.rowCount) await c.query("UPDATE brands SET revenue_estimate=$2::jsonb WHERE id=$1",
          [j.brand_id,JSON.stringify({status:j.attempts>=3?'failed':'pending',reason:`AI 조회 실패 (${code}). 재시도 또는 설정 확인 필요`})]);
      });
      return "failed";
    }
  }));
  return { processed: jobs.length, completed: results.filter(x => x === "completed").length, failed: results.filter(x => x === "failed").length, superseded: results.filter(x => x === "superseded").length };
}
