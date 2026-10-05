-- ═════════════════════════════════════════════════════════════
-- 111 · 세미나 발송 시도 이력(실제 보낸 내용 보존) + 선점 소유자 (추가만)
--   지금까지 seminar_sends 에는 "결과"만 남고 실제로 나간 제목·본문이 없었다.
--   시도마다 1행을 남겨, 수신거부 꼬리말까지 포함한 최종 전송 본문을 그대로 보존한다.
--
--   일부러 하지 않는 것
--     · 지난 발송을 소급 생성하지 않는다 — 기록이 없는 건은 화면에서 "기록 없음"으로 보인다.
--     · 내용 칸(subject·body·to_masked·channel·stage·attempt_no)은 한 번 쓰고 고치지 않는다.
--       코드가 나중에 바꾸는 것은 결과 칸(result·provider·provider_id·error·finished_at)뿐이다.
--     · 원문 연락처를 넣지 않는다 — 마스킹한 값만 남긴다(원본은 seminar_targets 에 이미 있다).
--     · 기존 표의 컬럼을 지우거나 이름을 바꾸지 않는다.
--   의존: 0103_seminar_notify.sql
-- ═════════════════════════════════════════════════════════════

-- 어느 실행이 이 행을 선점했는지. 중단 시 "내가 잡은 것만" 되돌리기 위해 쓴다
--   (다른 실행이 잡은 건을 건드리지 않게 하는 소유권 표시).
ALTER TABLE seminar_sends ADD COLUMN IF NOT EXISTS claimed_by uuid;
CREATE INDEX IF NOT EXISTS seminar_sends_claimed_by_idx
  ON seminar_sends (claimed_by) WHERE status = 'sending';

CREATE TABLE IF NOT EXISTS seminar_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES seminar_sends(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES seminar_sessions(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES seminar_targets(id) ON DELETE CASCADE,
  -- 어느 실행(seminar_runs)에서 나간 시도인지. 실행 이력과 맞춰 보기 위한 참조.
  run_id uuid,

  stage text NOT NULL CHECK (stage IN ('notice','followup')),
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  -- seminar_sends.attempts 와 같은 번호. 같은 예약의 몇 번째 시도인지.
  attempt_no int NOT NULL CHECK (attempt_no >= 1),

  -- ── 여기부터 "보낸 내용" — 한 번 쓰고 고치지 않는다 ──
  to_masked text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',          -- 문자는 빈 값
  body text NOT NULL,                        -- 수신거부 꼬리말까지 붙인 최종 본문
  purpose text NOT NULL DEFAULT '',          -- service | ad (그때의 문구 성격)
  started_at timestamptz NOT NULL DEFAULT now(),

  -- ── 여기부터 "결과" — 전송이 끝난 뒤 한 번 채운다 ──
  result text NOT NULL DEFAULT 'attempted'
    CHECK (result IN ('attempted','sent','failed')),
  provider text NOT NULL DEFAULT '',
  provider_id text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  finished_at timestamptz,

  -- 같은 예약의 같은 시도 번호는 1행뿐이다(재실행해도 이력이 부풀지 않는다).
  UNIQUE (send_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS seminar_send_attempts_session_idx
  ON seminar_send_attempts (session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS seminar_send_attempts_send_idx
  ON seminar_send_attempts (send_id, attempt_no DESC);
