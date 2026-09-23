-- ═════════════════════════════════════════════════════════════
-- 97 · Zoom 클라우드 녹화·전사 자동 수집
--   · meetings 에 수집 상태/매핑 근거 컬럼 추가
--   · zoom_webhook_events : 웹훅 원장(중복·역순 도착 방어 + 안전한 재처리)
--   · meeting_recordings  : 수집한 녹화/전사 파일(회의 인스턴스 + 파일 id 로 중복 방지)
--   · meeting_brand_links : 브랜드 매핑 변경 이력(근거 보존)
--   ※ 다운로드 토큰이 붙은 URL 은 저장하지 않는다(사람이 여는 share/play 링크만).
-- ═════════════════════════════════════════════════════════════

-- 전사 수집 상태.
--   none          : 해당 없음(수동 회의 등)
--   pending       : 녹화는 왔고 전사 대기 중(Zoom 이 아직 안 만듦)
--   ready         : 전사 수집 완료
--   recording_only: 녹음만 있고 전사가 없는 것으로 확인됨(전사 기능/언어/요금제)
--   failed        : 수집 실패(재시도 대상)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'none';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_fetched_at timestamptz;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_error text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_attempts int NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_next_try timestamptz;
-- 사람이 여는 녹화 링크(share_url) — 토큰 없는 주소만.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS recording_share_url text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS recording_files_count int NOT NULL DEFAULT 0;
-- 브랜드 매핑 근거(booking/uuid/alias/email/manual/none)와 후보 목록.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS match_method text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS match_note text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS match_candidates jsonb NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS meetings_transcript_status_idx ON meetings (transcript_status, transcript_next_try);

CREATE TABLE IF NOT EXISTS zoom_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  dedupe_key text UNIQUE NOT NULL,        -- 같은 이벤트 재전송을 한 행으로 묶는다
  zoom_uuid text,
  event_ts bigint,                        -- Zoom payload.event_ts — 역순 도착 판정
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','done','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS zoom_webhook_events_status_idx ON zoom_webhook_events (status, received_at);
CREATE INDEX IF NOT EXISTS zoom_webhook_events_uuid_idx ON zoom_webhook_events (zoom_uuid);

CREATE TABLE IF NOT EXISTS meeting_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,
  zoom_uuid text NOT NULL,
  zoom_file_id text NOT NULL,
  file_type text NOT NULL DEFAULT '',      -- MP4 / M4A / TRANSCRIPT / CC / TIMELINE …
  recording_type text NOT NULL DEFAULT '', -- shared_screen_with_speaker_view / audio_transcript …
  file_extension text NOT NULL DEFAULT '',
  file_size bigint,
  play_url text,                           -- 사람이 여는 링크(토큰 없음)
  recording_start timestamptz,
  recording_end timestamptz,
  collected boolean NOT NULL DEFAULT false,-- 본문을 실제로 가져왔는지(전사)
  collected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zoom_uuid, zoom_file_id)
);
CREATE INDEX IF NOT EXISTS meeting_recordings_meeting_idx ON meeting_recordings (meeting_id);

CREATE TABLE IF NOT EXISTS meeting_brand_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  prev_brand_id uuid,
  method text NOT NULL DEFAULT '',         -- booking / uuid / alias / email / manual / cleared
  reason text NOT NULL DEFAULT '',         -- 사람이 읽는 근거
  by_admin text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_brand_links_meeting_idx ON meeting_brand_links (meeting_id, created_at DESC);
