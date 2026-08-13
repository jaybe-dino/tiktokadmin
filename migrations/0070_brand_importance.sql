-- 브랜드 중요도(별 0~3) — 고객 카드에 중요 표시. 0=일반(별 없음), 최대 3.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS importance int NOT NULL DEFAULT 0;
