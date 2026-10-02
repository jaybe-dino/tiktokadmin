-- ═════════════════════════════════════════════════════════════
-- 108 · 온보딩 신청서 — 자가 기입 매출 구간 (추가만)
--   신청자가 고른 "최근 12개월 브랜드 전체 매출" 구간을 신청 건에만 저장한다.
--
--   일부러 하지 않는 것
--     · brands(브랜드 원장)의 매출 값을 건드리지 않는다. 이 값은 신청자가 스스로 적은 것이라
--       원장 수치와 섞으면 안 된다.
--     · 기존 신청 행을 채우지 않는다 — NULL(미기입) 그대로 둔다.
--   의존: 0107_weekly_onboarding_apply.sql
-- ═════════════════════════════════════════════════════════════

ALTER TABLE weekly_onb_applications ADD COLUMN IF NOT EXISTS revenue_band text;

-- 허용값만 들어가게 한다. NULL(기존 신청·미기입)은 그대로 통과한다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weekly_onb_revenue_band_check') THEN
    ALTER TABLE weekly_onb_applications ADD CONSTRAINT weekly_onb_revenue_band_check
      CHECK (revenue_band IS NULL OR revenue_band IN
        ('pre','lt1','b1_5','b5_10','b10_30','b30_100','gte100','unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS weekly_onb_revenue_idx ON weekly_onb_applications (revenue_band);
