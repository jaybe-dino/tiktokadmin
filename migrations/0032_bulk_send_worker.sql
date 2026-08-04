-- ═════════════════════════════════════════════════════════════
-- 32 · 대량 발송 워커 지원 — 큐(bulk_sends)를 실제로 소비해 발송하는
--   크론 워커(lib/bulk-send.ts)가 진행상황·오류를 기록할 컬럼 추가.
--   기존: bulk_sends 는 status='queued' 로만 쌓이고 소비자가 없었음(발송 0).
-- ═════════════════════════════════════════════════════════════

-- 발송 대상별 오류·시도 기록(재시도·감사).
ALTER TABLE bulk_send_targets ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE bulk_send_targets ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

-- status: pending | sent | failed | skipped
--   (기존 DEFAULT 'pending' 유지 · CHECK 는 두지 않음 — 값 확장 여지)

-- 발송 배치 시작·완료 시각(런 관측용).
ALTER TABLE bulk_sends ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE bulk_sends ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE bulk_sends ADD COLUMN IF NOT EXISTS failed int NOT NULL DEFAULT 0;

-- 큐 소비 인덱스(queued 를 오래된 순으로 픽업).
CREATE INDEX IF NOT EXISTS bulk_sends_status_idx ON bulk_sends (status, created_at);
CREATE INDEX IF NOT EXISTS bulk_send_targets_pending_idx ON bulk_send_targets (bulk_id, status);
