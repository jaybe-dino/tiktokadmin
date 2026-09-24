-- ═════════════════════════════════════════════════════════════
-- 98 · 광고 수신거부(marketing opt-out) — 수신자 단위
--   의존: brands 만 (0001). 0093~0095·0097 과 무관하며 단독 적용 가능.
--   · 광고 목적에만 적용한다. 계약·일정·거래 등 service 목적 발송은 이 표를 보지 않는다.
--   · 기존 전체 수신거부(brands.msg_opt_out, 0096)는 그대로 두고 약화하지 않는다.
--     둘 중 하나라도 켜져 있으면 광고는 나가지 않는다.
--   · 수신거부 링크의 토큰은 DB 에 저장한 난수다 — 로그인 세션 비밀키와 무관하므로
--     인증 키를 교체해도 고객의 수신거부 의사가 사라지지 않는다.
-- ═════════════════════════════════════════════════════════════

-- 수신자(사람) — 광고를 보낼 때 이메일·전화 쌍으로 1행을 만들고 그 행의 토큰을 링크에 쓴다.
--   값이 없는 수단은 NULL 이 아니라 '' 로 둬 (email, phone) 유일성이 제대로 걸리게 한다.
CREATE TABLE IF NOT EXISTS ad_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,                  -- 256비트 난수(base64url) — 추측 불가
  email text NOT NULL DEFAULT '',              -- 정규화(소문자)
  phone text NOT NULL DEFAULT '',              -- 정규화(숫자만, 국내형식)
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'lead'            -- lead: 실제 수신자 / qa: 검증용 합성 주소
    CHECK (kind IN ('lead','qa')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_recipients_addr_present CHECK (email <> '' OR phone <> ''),
  CONSTRAINT ad_recipients_pair_uniq UNIQUE (email, phone)
);
CREATE INDEX IF NOT EXISTS ad_recipients_email_idx ON ad_recipients (email) WHERE email <> '';
CREATE INDEX IF NOT EXISTS ad_recipients_phone_idx ON ad_recipients (phone) WHERE phone <> '';

-- 수신거부 기록 — 수단별 1행. 주소는 정규화해 그대로 둔다(brands 에 이미 같은 값이 있고,
--   비밀키로 해싱하면 키 교체 시 기록이 무력화되므로 오히려 위험하다).
CREATE TABLE IF NOT EXISTS ad_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL DEFAULT 'marketing' CHECK (purpose IN ('marketing')),
  kind text NOT NULL CHECK (kind IN ('email','phone')),
  addr text NOT NULL,                       -- 정규화 주소
  addr_masked text NOT NULL DEFAULT '',     -- 화면 표시용(예: ab***@example.com)
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES ad_recipients(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'link'
    CHECK (source IN ('link','admin','import','qa')),
  note text NOT NULL DEFAULT '',
  opted_out_at timestamptz NOT NULL DEFAULT now(),   -- 감사 시각(최초 확정)
  confirm_count int NOT NULL DEFAULT 1,              -- 재클릭 횟수(멱등 — 상태는 그대로)
  last_confirm_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_optouts_addr_uniq UNIQUE (purpose, kind, addr)
);
CREATE INDEX IF NOT EXISTS ad_optouts_brand_idx ON ad_optouts (brand_id);
CREATE INDEX IF NOT EXISTS ad_optouts_time_idx ON ad_optouts (opted_out_at DESC);
