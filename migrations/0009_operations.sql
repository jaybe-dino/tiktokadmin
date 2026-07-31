-- ═════════════════════════════════════════════════════════════
-- 09 · 운영대행 엔진 — Phase 5 (문서 15)
--   월간 사이클·워크아이템·시딩·라이브·CS·정산 런.
--   glovek 크롤러(creators·videos·brand_shop_stats)는 읽기전용 연료.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ops_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  month date NOT NULL,                            -- 해당 월 1일
  plan text NOT NULL,                             -- 발행 시점 brands.plan 스냅샷
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','paused')),
  items_total int DEFAULT 0, items_done int DEFAULT 0,
  report_asset_id uuid REFERENCES assets(id),
  closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, month)
);
CREATE INDEX IF NOT EXISTS ops_cycles_month_idx ON ops_cycles (month, status);

CREATE TABLE IF NOT EXISTS work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES ops_cycles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('seeding','live','report','ads','listing','etc')),
  qty_target int NOT NULL DEFAULT 1, qty_done int NOT NULL DEFAULT 0,
  assignee text, due date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','carried_over')),
  note text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS work_items_cycle_idx ON work_items (cycle_id);

CREATE TABLE IF NOT EXISTS seedings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES ops_cycles(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  creator_handle text NOT NULL,
  country text DEFAULT 'US',
  product_id uuid,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','contacted','agreed','sent','posted','measured','declined','no_post')),
  fee int DEFAULT 0,
  tracking_no text DEFAULT '', sent_at date,
  posted_url text DEFAULT '', posted_at date,
  views bigint, likes int,
  assignee text, note text DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seedings_cycle_idx ON seedings (cycle_id);
CREATE INDEX IF NOT EXISTS seedings_creator_idx ON seedings (creator_handle);

CREATE TABLE IF NOT EXISTS lives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES ops_cycles(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL, country text DEFAULT 'US',
  host text DEFAULT '', studio text DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','rehearsed','done','canceled')),
  gmv numeric, viewers int, note text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS lives_cycle_idx ON lives (cycle_id);
CREATE INDEX IF NOT EXISTS lives_sched_idx ON lives (scheduled_at);

CREATE TABLE IF NOT EXISTS cs_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  channel text NOT NULL,                          -- email|portal|tiktok|phone
  country text DEFAULT '', subject text NOT NULL, body text DEFAULT '',
  priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  sla_due timestamptz,
  assignee text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cs_tickets_status_idx ON cs_tickets (status, sla_due);

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  month date NOT NULL,
  gmv numeric DEFAULT 0,
  gmv_source text DEFAULT 'manual',               -- pg|tiktok|manual
  fee_pct numeric NOT NULL DEFAULT 10,            -- contracts.terms.fee_pct
  fee_amount int DEFAULT 0, sub_amount int DEFAULT 0, total int DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','invoiced','paid','disputed')),
  anomaly boolean DEFAULT false, anomaly_note text DEFAULT '',
  approved_by text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, month)
);
CREATE INDEX IF NOT EXISTS settlements_month_idx ON settlements (month, status);
