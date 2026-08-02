-- ═════════════════════════════════════════════════════════════
-- 12 · AI 에이전트 레이어 — 실행 로그 + on/off 상태
--   에이전트 "정의"는 코드(lib/agents.ts) 레지스트리, 여기엔 운영 상태만.
-- ═════════════════════════════════════════════════════════════

-- 에이전트 실행 로그
CREATE TABLE IF NOT EXISTS agent_runs (
  id bigserial PRIMARY KEY,
  agent text NOT NULL,                       -- 레지스트리 key
  status text NOT NULL DEFAULT 'running'      -- running|ok|error
    CHECK (status IN ('running','ok','error')),
  summary text DEFAULT '',
  detail jsonb DEFAULT '{}',
  actions int NOT NULL DEFAULT 0,            -- 생성한 알림·초안 등 조치 수
  triggered_by text DEFAULT 'cron',          -- cron|manual|ingest
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs (agent, started_at DESC);

-- 에이전트 on/off·최근 실행
CREATE TABLE IF NOT EXISTS agent_config (
  agent text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  last_run timestamptz,
  note text DEFAULT ''
);
