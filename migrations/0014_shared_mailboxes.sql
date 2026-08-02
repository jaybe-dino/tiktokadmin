-- ═════════════════════════════════════════════════════════════
-- 14 · 회사 공용 메일함 + 담당자 자동 전달
--   주요 고객과 커뮤하는 회사 공용 이메일(2~3개+)을 등록해 수집.
--   수신 메일을 고객(brand)과 매칭 → 현재 단계 담당자에게 자동 전달.
-- ═════════════════════════════════════════════════════════════

-- ── 회사 공용 메일함 레지스트리 (수집 대상) ────────────────────
CREATE TABLE IF NOT EXISTS shared_mailboxes (
  email text PRIMARY KEY,                       -- 회사 공용 주소(예: sales@dinostudio.kr)
  label text NOT NULL DEFAULT '',               -- 표시명(예: 영업 대표 메일)
  enabled boolean NOT NULL DEFAULT true,        -- 수집 on/off
  forward_to_owner boolean NOT NULL DEFAULT true,-- 수신 시 담당자 자동 전달 여부
  note text DEFAULT '',
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 수신 메일의 담당자 자동 전달 이력 (멱등) ──────────────────
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS forwarded_to text;      -- 전달한 담당자 이메일
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS forwarded_at timestamptz;
