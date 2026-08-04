-- ═════════════════════════════════════════════════════════════
-- 34 · 계약형태(contract_type) 백필 — 기존 브랜드가 플랜은 있으나 contract_type 이
--   비어 contact→contract_review 게이트("계약형태 미정")에 막혀 있던 것을 해소.
--   플랜 → 트랙 매핑(lib/track.ts 와 동일): live_focus/guarantee=mall · onboarding=onboarding · pro=marketing.
-- ═════════════════════════════════════════════════════════════
UPDATE brands SET contract_type = 'mall'
 WHERE contract_type IS NULL AND plan IN ('live_focus_490k', 'guarantee_1m');

UPDATE brands SET contract_type = 'onboarding'
 WHERE contract_type IS NULL AND plan = 'onboarding_onetime';

UPDATE brands SET contract_type = 'marketing'
 WHERE contract_type IS NULL AND plan = 'pro_89k';

-- 서명된 계약이 있으면 그 종류로도 보정(플랜이 없던 경우 대비).
UPDATE brands b SET contract_type = CASE
    WHEN c.kind IN ('mall','guarantee') THEN 'mall'
    WHEN c.kind = 'onboarding' THEN 'onboarding'
    WHEN c.kind IN ('marketing','marketing_retainer') THEN 'marketing'
  END
 FROM contracts c
 WHERE c.brand_id = b.id AND b.contract_type IS NULL
   AND c.kind IN ('mall','guarantee','onboarding','marketing','marketing_retainer');
