-- ═════════════════════════════════════════════════════════════
-- 41 · 틱톡샵 계정 발송(회의 확정) — 서류수급 최종 → 개설되면 계정 정보 입력 →
--   브랜드에 셀러센터 링크·ID·PW 자동 문자/이메일 발송. 운영·정산 파트에서 관리.
-- ═════════════════════════════════════════════════════════════
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS tiktok_shop_url text DEFAULT '',      -- 셀러센터/판매 링크(9번 판매 링크)
  ADD COLUMN IF NOT EXISTS tiktok_seller_id text DEFAULT '',
  ADD COLUMN IF NOT EXISTS tiktok_seller_pw text DEFAULT '',
  ADD COLUMN IF NOT EXISTS tiktok_opened_at timestamptz,          -- 개설 완료 시각
  ADD COLUMN IF NOT EXISTS tiktok_sent_at timestamptz;            -- 계정 안내 발송 시각(1회)
