-- ═════════════════════════════════════════════════════════════
-- 98 · 광고 수신거부(marketing opt-out) — 수신자 단위
--   의존: brands 만 (0001). 0093~0095·0097 과 무관하며 단독 적용 가능.
--   · 광고 목적에만 적용한다. 계약·일정·거래 등 service 목적 발송은 이 표를 보지 않는다.
--   · 기존 전체 수신거부(brands.msg_opt_out, 0096)는 그대로 두고 약화하지 않는다.
--     둘 중 하나라도 켜져 있으면 광고는 나가지 않는다.
--   · 주소는 평문으로 저장하지 않는다 — 서버 비밀키로 만든 해시 + 화면 표시용 마스킹만 저장.
-- ═════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ad_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL DEFAULT 'marketing' CHECK (purpose IN ('marketing')),
  kind text NOT NULL CHECK (kind IN ('email','phone')),
  addr_hash text NOT NULL,                  -- HMAC(정규화 주소) — 평문 아님
  addr_masked text NOT NULL DEFAULT '',     -- 화면 표시용(예: ab***@example.com)
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'link'
    CHECK (source IN ('link','admin','import','qa')),
  note text NOT NULL DEFAULT '',
  opted_out_at timestamptz NOT NULL DEFAULT now(),   -- 감사 시각(최초 확정)
  confirm_count int NOT NULL DEFAULT 1,              -- 재클릭 횟수(멱등 — 상태는 그대로)
  last_confirm_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purpose, kind, addr_hash)
);
CREATE INDEX IF NOT EXISTS ad_optouts_brand_idx ON ad_optouts (brand_id);
CREATE INDEX IF NOT EXISTS ad_optouts_time_idx ON ad_optouts (opted_out_at DESC);
