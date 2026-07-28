-- ─────────────────────────────────────────────────────────────
-- 05 · 파트 담당자 이메일 → 고객 카드 연동
--   담당자의 고객 관련 메일을 참여 이메일로 매칭해 고객 카드에 기록.
--   개인정보 최소: 본문 전체가 아닌 요약(snippet)만 저장, 첨부는 저장 안 함.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brand_emails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  direction   text NOT NULL DEFAULT 'unknown' CHECK (direction IN ('in','out','unknown')),
  from_addr   text,
  to_addr     text,
  subject     text,
  snippet     text,          -- 본문 요약(일부)
  owner_part  text,          -- 매칭된 담당 파트: intake|sales|onboard|ads|settle
  owner_id    text,          -- 참여한 담당자(admin_users.id)
  message_id  text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  linked_by   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, message_id)  -- 멱등(message_id 있을 때). NULL 은 다중 허용.
);
CREATE INDEX IF NOT EXISTS brand_emails_brand_idx ON brand_emails (brand_id, occurred_at DESC);
