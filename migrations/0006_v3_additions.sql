-- ═════════════════════════════════════════════════════════════
-- 06 · v3 확정판 반영 (공식 기획 패키지 v1.0)
--   · 캐노니컬 퍼널 재확정(lead_new…settling) + v3 컬럼/테이블 + 조직·협업(002)
--   ⚠️ 어드민 테이블만. glovek 실서비스 테이블은 미접근.
-- ═════════════════════════════════════════════════════════════

-- 0) (안전) v2 값이 들어갔다면 캐노니컬로 역매핑 후 CHECK 재확정
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_state_check;
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_contract_type_check;
UPDATE brands SET state='lead_new'  WHERE state='inquiry';
UPDATE brands SET state='seminar'   WHERE state='expo';
UPDATE brands SET state='live_mall' WHERE state='live';
UPDATE brands SET contract_type='mall' WHERE contract_type='glovek';
ALTER TABLE brands ADD CONSTRAINT brands_state_check CHECK (state IN (
  'lead_new','seminar','meeting','contact','contract_review','contract_done',
  'docs','setup','live_mall','live_onboarding','settling','dropped','churned'));
ALTER TABLE brands ADD CONSTRAINT brands_contract_type_check
  CHECK (contract_type IN ('mall','onboarding'));

ALTER TABLE doc_items DROP CONSTRAINT IF EXISTS doc_items_template_check;
UPDATE doc_items SET template='mall' WHERE template='glovek';
ALTER TABLE doc_items ADD CONSTRAINT doc_items_template_check
  CHECK (template IN ('mall','onboarding'));

-- stage_requirements 도 캐노니컬 상태로 정리(v2 시드 제거)
DELETE FROM stage_requirements WHERE state IN ('inquiry','expo','live');

-- 1) brands v3 컬럼
ALTER TABLE brands ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;   -- 낙관적 잠금
ALTER TABLE brands ADD COLUMN IF NOT EXISTS owner_backup text;                -- 백업 담당(09-B)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS notion_page_url text;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS certified_countries text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS brands_is_test_idx ON brands (is_test);

-- 2) SLA 실측 캘리브레이션 (v3 §2-2)
INSERT INTO sla_policies (state, max_days, note) VALUES ('lead_new',2,'2일 내 1차 컨택')
  ON CONFLICT (state) DO NOTHING;
UPDATE sla_policies SET max_days=7  WHERE state='meeting';
UPDATE sla_policies SET max_days=10 WHERE state='docs';

-- 3) 표기충돌 대응 별칭 (261건) + dedup 확장 소스
CREATE TABLE IF NOT EXISTS brand_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  alias text NOT NULL,
  kind  text NOT NULL DEFAULT 'name',   -- name|email|url
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, alias)
);
CREATE INDEX IF NOT EXISTS brand_aliases_alias_idx ON brand_aliases (lower(alias));

-- 4) PULL 동기화 커서 (v3 §4-2)
CREATE TABLE IF NOT EXISTS sync_state (
  source text PRIMARY KEY,               -- glovek|apply|tpartners|notion
  cursor text, last_run timestamptz, note text DEFAULT ''
);

-- 5) 조직·권한 (002 org — 12-RBAC)
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY, name text NOT NULL, part text
);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS team_id text REFERENCES teams(id);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'own'
  CHECK (scope IN ('own','team','all'));

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL,                    -- drop|refund|settlement|...
  payload jsonb NOT NULL DEFAULT '{}',
  requested_by text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by text, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests (status, created_at);

CREATE TABLE IF NOT EXISTS access_log (
  id bigserial PRIMARY KEY,
  actor text, action text, target text, meta jsonb DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);

-- 6) 협업 (002 collab — 13)
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  author text NOT NULL, body text NOT NULL,
  mentions text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_brand_idx ON comments (brand_id, created_at);

CREATE TABLE IF NOT EXISTS presence (
  admin_user_id text NOT NULL,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, brand_id)
);
