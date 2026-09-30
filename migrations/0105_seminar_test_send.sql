-- ═════════════════════════════════════════════════════════════
-- 105 · 세미나 안내 — 지정 수신자 테스트 발송 (추가만)
--   마스터 스위치·문구 활성화 없이, 저장된 1차 참가안내를 "같은 치환·같은 발송 경로"로
--   미리 지정해 둔 담당자 연락처에만 1건씩 보내 확인하기 위한 관리자 전용 경로다.
--
--   안전장치(코드로 강제)
--     · 보낼 수 있는 주소는 seminar_config 에 저장된 테스트 연락처뿐이다(서버가 대조한다).
--       화면에서 넘어온 주소를 그대로 쓰지 않는다.
--     · 고객 회차(seminar_sessions·seminar_targets·seminar_sends)와 수신거부 기록을
--       읽지도 쓰지도 않는다 — 이 표만 쓴다.
--     · 같은 채널로 동시에 두 번 나가지 않게 'sending' 은 채널당 1건만 존재할 수 있다.
--   의존: 0103_seminar_notify.sql
-- ═════════════════════════════════════════════════════════════

-- 테스트 수신자(담당자 본인 연락처). 비어 있으면 테스트 발송이 막힌다.
ALTER TABLE seminar_config ADD COLUMN IF NOT EXISTS test_phone text NOT NULL DEFAULT '';
ALTER TABLE seminar_config ADD COLUMN IF NOT EXISTS test_email text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS seminar_test_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  stage text NOT NULL DEFAULT 'notice' CHECK (stage IN ('notice','followup')),
  -- 회차 날짜(표시용). 고객 회차 행과 연결되지 않는다.
  session_date date,
  -- 수신 주소는 마스킹해서만 남긴다(원문은 저장하지 않는다).
  to_masked text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body_preview text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending','sent','failed','canceled')),
  provider text NOT NULL DEFAULT '',
  provider_id text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS seminar_test_sends_created_idx ON seminar_test_sends (created_at DESC);
-- 중복 클릭·동시 요청 방지 — 같은 채널로 진행 중인 테스트는 1건만.
CREATE UNIQUE INDEX IF NOT EXISTS seminar_test_sends_one_sending
  ON seminar_test_sends (channel) WHERE status = 'sending';
