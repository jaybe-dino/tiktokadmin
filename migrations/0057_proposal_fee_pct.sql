-- 운영견적: 판매 수수료(%) — 우리 비용 = 월 금액 + 판매매출의 X%.
--   월비용(quote_amount)과 별개로, 매출 연동 수수료율을 함께 저장·표기한다.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS fee_pct numeric;
