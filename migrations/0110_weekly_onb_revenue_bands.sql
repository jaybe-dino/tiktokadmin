-- ═════════════════════════════════════════════════════════════
-- 110 · 온보딩 신청서 — 자가 기입 매출 구간 재정의 (허용값 확대만)
--   폼에서 고를 수 있는 구간이 바뀌었다(1억~10억 / 10억~50억 / 50억~200억 /
--   200억~500억 / 500억~1000억). 새 값을 저장할 수 있게 CHECK 를 넓힌다.
--
--   일부러 하지 않는 것
--     · 이미 저장된 값을 새 구간으로 바꿔 적지 않는다. 예전 구간(lt1·b1_5·b5_10·
--       b10_30·b30_100·gte100)도 계속 허용값으로 남겨 기존 행이 그대로 유효하다.
--     · 미기입(NULL)인 기존 신청을 채우지 않는다.
--     · brands(브랜드 원장)의 매출 값을 건드리지 않는다 — 신청자가 스스로 적은 값이라
--       원장 수치와 섞으면 안 된다.
--     · 컬럼을 지우거나 이름을 바꾸지 않는다. 데이터를 옮기는 UPDATE 가 없다.
--   의존: 0108_weekly_onb_revenue.sql
-- ═════════════════════════════════════════════════════════════

-- 0108 을 건너뛰고 이 파일만 적용해도 컬럼이 생기도록(순서 사고 방지).
ALTER TABLE weekly_onb_applications ADD COLUMN IF NOT EXISTS revenue_band text;

-- 기존 CHECK 는 새 구간을 거절하므로 "더 넓은" 것으로 갈아 끼운다.
--   새 제약은 예전 값 전부를 포함하므로 기존 행이 검사에서 떨어지지 않는다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weekly_onb_revenue_band_check') THEN
    ALTER TABLE weekly_onb_applications DROP CONSTRAINT weekly_onb_revenue_band_check;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weekly_onb_revenue_band_check_v2') THEN
    ALTER TABLE weekly_onb_applications ADD CONSTRAINT weekly_onb_revenue_band_check_v2
      CHECK (revenue_band IS NULL OR revenue_band IN (
        -- 지금 폼에서 고를 수 있는 구간
        'pre','b1_10','b10_50','b50_200','b200_500','b500_1000','unknown',
        -- 예전에 저장된 구간(그대로 둔다)
        'lt1','b1_5','b5_10','b10_30','b30_100','gte100'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS weekly_onb_revenue_idx ON weekly_onb_applications (revenue_band);
