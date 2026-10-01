-- ═════════════════════════════════════════════════════════════
-- 106 · 카카오톡 대화 수집 — 방↔브랜드 매핑 · 중복 방지 · 수집 상태 (추가만)
--   지금까지 카카오 대화는 사람이 붙여 넣는 길밖에 없었다(자동 수집 경로 없음).
--   이 마이그레이션은 "인증된 수집기가 보내오면 받아 저장할 자리"를 만든다.
--
--   원칙
--     · 방이 어느 브랜드인지 확실하지 않으면 저장하지 않는다 — pending 으로만 남긴다.
--       (불확실한 방을 임의로 브랜드에 붙이지 않는다)
--     · 같은 메시지를 두 번 받아도 한 번만 저장한다(source_ref 유니크).
--     · 수집기가 실제로 보내오기 전에는 "자동 수집됨"이라고 표시하지 않는다.
--   의존: brands(0001) · pm_manual_comms(0099)
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kakao_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 수집기가 보내는 방 식별자(방 이름이 바뀌어도 유지되는 값). 원문 대화는 담지 않는다.
  room_key text UNIQUE NOT NULL,
  room_name text NOT NULL DEFAULT '',
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  -- pending = 아직 어느 브랜드인지 정하지 않음(이 상태에서는 메시지를 저장하지 않는다)
  -- linked  = 담당자가 브랜드를 확인해 연결함 · ignored = 수집 대상 아님
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','linked','ignored')),
  note text NOT NULL DEFAULT '',
  -- 수집기가 이 방을 마지막으로 알려온 시각 / 그 안의 마지막 대화 시각
  last_seen_at timestamptz,
  last_message_at timestamptz,
  -- 실제로 저장까지 성공한 마지막 시각. 비어 있으면 "수집기에서 받은 기록 없음".
  last_ingest_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  stored_count int NOT NULL DEFAULT 0,
  linked_by text,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kakao_rooms_brand_idx ON kakao_rooms (brand_id, status);
CREATE INDEX IF NOT EXISTS kakao_rooms_status_idx ON kakao_rooms (status, last_seen_at DESC);

-- 수집 실행 기록 — 성공·중복·미매핑·실패를 그대로 남긴다.
CREATE TABLE IF NOT EXISTS kakao_ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_key text NOT NULL DEFAULT '',
  agent text NOT NULL DEFAULT '',          -- 수집기 식별(사람이 읽는 이름)
  received int NOT NULL DEFAULT 0,
  stored int NOT NULL DEFAULT 0,
  duplicate int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,          -- 미매핑·무시 방 등으로 저장하지 않은 수
  failed int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','partial','error','rejected')),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kakao_ingest_runs_created_idx ON kakao_ingest_runs (created_at DESC);

-- 수집된 메시지는 기존 pm_manual_comms 에 그대로 쌓는다(화면·AI 가 이미 이 표를 읽는다).
--   source_ref 로 같은 메시지를 두 번 저장하지 않는다.
ALTER TABLE pm_manual_comms ADD COLUMN IF NOT EXISTS source_ref text NOT NULL DEFAULT '';
-- manual = 사람이 직접 등록 · kakao_collector = 인증된 수집기가 보낸 것
ALTER TABLE pm_manual_comms ADD COLUMN IF NOT EXISTS ingest_source text NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS pm_manual_comms_source_ref_uniq
  ON pm_manual_comms (brand_id, source_ref) WHERE source_ref <> '';
