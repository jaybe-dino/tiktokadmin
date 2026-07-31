-- ═════════════════════════════════════════════════════════════
-- 08 · 커뮤니케이션 자동화 — Phase 3 (줌 회의 08 + Gmail/배정 09 + 발송센터 9-C)
--   ⚠️ 기존 brand_emails(0005·메시지 저장, M9 UI 연동)는 유지.
--      09 스펙의 별칭 테이블은 brand_email_aliases 로, 메시지는 email_messages 로 신설.
-- ═════════════════════════════════════════════════════════════

-- ── 08. 줌 미팅 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,   -- 매칭 실패 시 NULL
  zoom_meeting_id text NOT NULL,
  zoom_uuid text UNIQUE NOT NULL,                           -- 멱등키
  topic text DEFAULT '', host_email text,
  participants jsonb DEFAULT '[]',
  scheduled_at timestamptz,
  host_admin_id uuid,
  started_at timestamptz, duration_min int,
  recording_url text, recording_expires timestamptz,
  audio_file_path text,
  transcript text,
  transcript_source text DEFAULT 'whisper',
  summary_md text,
  followup_status text NOT NULL DEFAULT 'none'
    CHECK (followup_status IN ('none','drafted','approved','sent','skipped')),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('scheduled','received','transcribing','summarizing','ready','unmatched','no_show','canceled','error')),
  error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meetings_brand_idx ON meetings (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meetings_status_idx ON meetings (status);

-- ── 08. 메일 초안 (followup/reminder/payment_notice/reply) ─────
CREATE TABLE IF NOT EXISTS email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'followup',
  to_email text NOT NULL, subject text NOT NULL, body_md text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','sent','discarded')),
  edited_by text, sent_at timestamptz, resend_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_drafts_brand_idx ON email_drafts (brand_id, status);

-- ── 09-A. 브랜드측 이메일 별칭 (매칭 키) ───────────────────────
CREATE TABLE IF NOT EXISTS brand_email_aliases (
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email text NOT NULL,
  added_by text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, email)
);
CREATE INDEX IF NOT EXISTS brand_email_aliases_email_idx ON brand_email_aliases (lower(email));

-- ── 09-A. Gmail 수집 메시지 (정제본·메타) ──────────────────────
CREATE TABLE IF NOT EXISTS email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  gmail_msg_id text UNIQUE NOT NULL,
  thread_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  owner_email text NOT NULL,
  from_addr text NOT NULL, to_addrs text[] DEFAULT '{}',
  subject text DEFAULT '', snippet text DEFAULT '',
  body_text text,
  has_attachment boolean DEFAULT false,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_messages_brand_idx ON email_messages (brand_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_thread_idx ON email_messages (thread_id);

-- ── admin_users 확장 (줌·Gmail 매핑) ───────────────────────────
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS zoom_email text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS gmail_sync_enabled boolean DEFAULT false;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS gmail_history_id text;

-- ── 09-B. 배정 로그 (owner_backup 는 0006 에서 이미 추가) ──────
CREATE TABLE IF NOT EXISTS assignment_log (
  id bigserial PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role text NOT NULL,
  from_user text, to_user text NOT NULL,
  by_user text NOT NULL, reason text DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignment_log_brand_idx ON assignment_log (brand_id, at DESC);

-- ── 09-C. 발송 센터 (대량·개별) + 리드 그룹 ────────────────────
ALTER TABLE brands ADD COLUMN IF NOT EXISTS lead_group text;

CREATE TABLE IF NOT EXISTS bulk_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('lead_group','filter','manual')),
  target_def jsonb NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','both')),
  template_key text, body_md text NOT NULL,
  scheduled_at timestamptz, status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','queued','sending','done','canceled')),
  total int, sent int, excluded_optout int, excluded_nocontact int,
  created_by text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bulk_send_targets (
  bulk_id uuid REFERENCES bulk_sends(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  channel text, status text DEFAULT 'pending',
  sent_at timestamptz, PRIMARY KEY (bulk_id, brand_id)
);
