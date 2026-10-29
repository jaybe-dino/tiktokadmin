-- ═════════════════════════════════════════════════════════════
-- 115 · 원장 → Google Sheets 동기화 실행 기록 (추가만)
--   하루 한 번 실행을 보장하고(겹침 방지), 실패가 지난 성공을 지우지 않게 한다.
--
--   일부러 하지 않는 것
--     · 원장(brands)과 그 어떤 기존 표도 건드리지 않는다. 이 표만 추가한다.
--     · 연락처·매출·토큰을 담지 않는다. 건수와 상태만 남긴다.
--   의존: 없음(단독 적용 가능).
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sheet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 어느 시트에 썼는지. 여러 시트로 늘어나도 날짜 키가 섞이지 않게 함께 잡는다.
  spreadsheet_id text NOT NULL,
  -- KST 기준 날짜(YYYY-MM-DD). 하루 한 번을 판정하는 단위다.
  run_date date NOT NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','done','failed')),
  -- 같은 날 재시도한 횟수. 선점이 UPDATE 로 넘어갈 때 올라간다.
  attempts int NOT NULL DEFAULT 1,

  brands int NOT NULL DEFAULT 0,
  updated_rows int NOT NULL DEFAULT 0,
  appended_rows int NOT NULL DEFAULT 0,
  -- 사유 문구만. 연락처·매출·토큰은 넣지 않는다.
  error text NOT NULL DEFAULT '',

  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- 겹침 방지의 실체 — 같은 (시트, 날짜)는 한 행뿐이다.
--   동시에 두 실행이 들어오면 INSERT 경합에서 하나만 통과한다.
CREATE UNIQUE INDEX IF NOT EXISTS sheet_sync_runs_day_uniq
  ON sheet_sync_runs (spreadsheet_id, run_date);
CREATE INDEX IF NOT EXISTS sheet_sync_runs_time_idx
  ON sheet_sync_runs (started_at DESC);
