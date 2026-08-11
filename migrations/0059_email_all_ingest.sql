-- 공용 메일함의 모든 메일을 기본 수집(브랜드 미매칭 포함). brand_id 를 NULL 허용으로.
--   미매칭 메일은 brand_id IS NULL 로 저장되고, 메일함에서 수동으로 브랜드에 연결한다.
ALTER TABLE email_messages ALTER COLUMN brand_id DROP NOT NULL;

-- 미매칭(brand_id NULL) 스레드 최신순 조회 최적화.
CREATE INDEX IF NOT EXISTS email_messages_unmatched_idx
  ON email_messages (sent_at DESC) WHERE brand_id IS NULL;
