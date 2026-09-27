-- ═════════════════════════════════════════════════════════════
-- 99 · 브랜드별 PM 에이전트 (추가만 — 기존 표/컬럼을 바꾸지 않는다)
--   의존: brands(id), admin_users(id)  ※ 그 밖의 표는 참조하지 않는다.
--   · pm_brand_config  : 브랜드별 PM 활성/담당자/마지막 실행·오류/다음 액션
--   · pm_kpis          : 합의 KPI(목표·단위·기간·현재값·측정일·담당·근거)
--   · pm_tasks         : 문제/할일/질문 (우선순위·담당·마감·상태·원문근거)
--   · pm_task_events   : 업무 변경 이력(누가 무엇을 언제)
--   · pm_manual_comms  : 수집 미연결 채널(슬랙·카톡·통화 등) 수동 원문 등록
--   · pm_runs          : 분석 실행 이력 + 동시 실행 보호
--   ※ 값 없음과 0 을 구분해야 하므로 수치 컬럼은 모두 NULL 허용이다.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pm_brand_config (
  brand_id uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,          -- 자동 운영은 브랜드가 켤 때만(opt-in)
  owner_admin_id text,                              -- admin_users.id (text=이메일)
  last_run_at timestamptz,
  last_run_mode text,                               -- rules | ai
  last_status text,                                 -- ok | error | running
  last_error text,
  last_summary text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  unit text NOT NULL DEFAULT '',
  -- 목표·현재값은 NULL(미입력)과 0(실제 0)을 구분한다.
  target_value numeric,
  current_value numeric,
  measured_at date,                                 -- 현재값을 언제 재었는지
  direction text NOT NULL DEFAULT 'up'
    CHECK (direction IN ('up','down')),             -- down = 낮을수록 좋은 역방향 지표
  period_start date,
  period_end date,
  owner_admin_id text,
  evidence text NOT NULL DEFAULT '',                -- 근거(원문·링크·회의 등)
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','contract','proposal')),
  source_ref text NOT NULL DEFAULT '',              -- 참고 출처 식별자(계약·제안 id 등)
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_kpis_brand_idx ON pm_kpis (brand_id, status, period_end);

CREATE TABLE IF NOT EXISTS pm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'todo'
    CHECK (kind IN ('issue','todo','question')),
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  priority int NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),   -- 1 높음
  owner_admin_id text,
  due_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','doing','done','reopened','dismissed')),
  -- 사람이 확정한 업무와 기계가 제안한 것을 섞지 않는다.
  origin text NOT NULL DEFAULT 'human'
    CHECK (origin IN ('human','rules','ai')),
  confirmed_by text,                                -- 사람이 확정했으면 그 계정
  confirmed_at timestamptz,
  evidence_kind text NOT NULL DEFAULT '',           -- email | meeting | note | manual_comm | source | kpi
  evidence_id text NOT NULL DEFAULT '',
  evidence_url text NOT NULL DEFAULT '',
  evidence_label text NOT NULL DEFAULT '',
  -- 반복 실행 시 같은 제안을 다시 만들지 않기 위한 키(제안만 사용).
  dedupe_key text,
  edited_by_human boolean NOT NULL DEFAULT false,   -- 사람이 손댄 업무는 덮어쓰지 않는다
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_tasks_brand_idx ON pm_tasks (brand_id, status, priority, due_date);
-- 같은 브랜드 안에서 같은 제안이 중복 생성되지 않게(사람이 만든 건 dedupe_key 없음 = 제약 없음).
CREATE UNIQUE INDEX IF NOT EXISTS pm_tasks_dedupe_uniq
  ON pm_tasks (brand_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS pm_task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  field text NOT NULL DEFAULT 'status',
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_task_events_task_idx ON pm_task_events (task_id, at DESC);

CREATE TABLE IF NOT EXISTS pm_manual_comms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel text NOT NULL
    CHECK (channel IN ('slack','kakao','call','sms','offline','other')),
  occurred_at timestamptz NOT NULL,                 -- 대화 시각(수집 시각이 아니다)
  author text NOT NULL DEFAULT '',                  -- 누가 말했는지(사람이 적는다)
  source_label text NOT NULL DEFAULT '',            -- 원문 출처 설명
  source_url text NOT NULL DEFAULT '',              -- 원문 링크(있으면)
  body text NOT NULL DEFAULT '',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_manual_comms_brand_idx ON pm_manual_comms (brand_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS pm_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'rules' CHECK (mode IN ('rules','ai')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','ok','error')),
  triggered_by text NOT NULL DEFAULT 'manual',      -- manual | cron
  summary text NOT NULL DEFAULT '',
  created_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS pm_runs_brand_idx ON pm_runs (brand_id, started_at DESC);
-- 같은 브랜드에서 분석이 동시에 두 번 돌지 않게(진행 중 1건만).
CREATE UNIQUE INDEX IF NOT EXISTS pm_runs_one_running
  ON pm_runs (brand_id) WHERE status = 'running';
