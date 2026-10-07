-- ═════════════════════════════════════════════════════════════
-- 113 · 「브랜드 해외매출 실행전략 세미나」 공개 신청 (추가만)
--   같은 핵심 프로그램을 4회 운영하고, 신청자는 희망 회차 1개를 고른다.
--   접수(submitted)와 선정(selected)을 분리한다 — 선착순 자동선정은 없다.
--
--   일부러 하지 않는 것
--     · 기존 sev_* (세미나 모집 허브)·seminar_* (주간 안내 발송)·brands 원장을 건드리지 않는다.
--     · ad_optouts(수신거부 명단)를 쓰지 않는다. 광고 동의는 이 표에만 기록하고,
--       기존 수신거부 의사를 동의로 덮어쓰지 않는다.
--     · 신청 시점에 메일·문자를 보내지 않는다(자동 접수메일 기본 OFF).
--   의존: 없음(단독 적용 가능). pgcrypto 의 gen_random_uuid 만 쓴다.
-- ═════════════════════════════════════════════════════════════

-- ── 프로그램 설정(단일 행) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS sap_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  title text NOT NULL DEFAULT '브랜드 해외매출 실행전략 세미나',
  -- 공개 화면에 그대로 띄우는 모집 문구. 정원·선정 규칙을 사람이 읽는 문장으로 둔다.
  tagline text NOT NULL DEFAULT '회차별 30명 선정 · 무료 온라인 세미나',
  summary text NOT NULL DEFAULT '',
  curriculum_md text NOT NULL DEFAULT '',

  -- 신청 접수 여부. 전체 신청은 제한 없이 받는다(정원은 선정 단계에서만 쓴다).
  apply_open boolean NOT NULL DEFAULT true,

  -- 발송 관련 스위치 — 이번 작업에서는 둘 다 OFF 로 배포한다.
  --   send_enabled: 선정 안내·Zoom 링크 발송(초안 생성까지만 하고 보내지 않는다)
  --   auto_ack_enabled: 신청 즉시 자동 접수메일
  send_enabled boolean NOT NULL DEFAULT false,
  auto_ack_enabled boolean NOT NULL DEFAULT false,

  -- 개인정보 안내에 표시할 실제 값. 확인되지 않은 값은 비워 두고 화면에서 그 줄을 빼 둔다
  --   (지어내서 표시하지 않기 위해 기본값을 비워 둔다).
  --   값은 https://glovek.space/privacy 에 공개된 운영자·보호책임자·문의처와 같게 둔다.
  org_legal_name text NOT NULL DEFAULT '디노스튜디오',
  org_rep_name text NOT NULL DEFAULT '대표 허정발 (개인정보 보호책임자)',
  org_address text NOT NULL DEFAULT '서울특별시 서초구 사임당로26 8층 802호',
  org_biz_no text NOT NULL DEFAULT '',
  privacy_contact_email text NOT NULL DEFAULT 'chief@dinostudio.kr',
  privacy_contact_phone text NOT NULL DEFAULT '010-5663-1273',

  -- 보유기간 — 필수정보는 마지막 회차 종료 후 3개월, 광고용은 최대 1년 또는 철회 시까지 중 먼저.
  --   기존 처리방침에는 세미나 전용 보유기간이 없다 — 이 행사 동의문에만 쓰는 구체 기간이다.
  retention_required text NOT NULL DEFAULT '마지막 회차 종료 후 3개월',
  retention_ads text NOT NULL DEFAULT '동의일로부터 최대 1년 또는 수신 철회 시까지 중 먼저 도달하는 시점',
  -- 보유기간 계산 기준일 = 마지막 회차 종료일. 회차가 바뀌면 관리자가 이 값을 맞춘다.
  retention_base_date date NOT NULL DEFAULT DATE '2026-10-23',
  retention_required_months int NOT NULL DEFAULT 3 CHECK (retention_required_months > 0),
  retention_ads_months int NOT NULL DEFAULT 12 CHECK (retention_ads_months > 0),

  -- 동의 시점의 안내문을 식별하는 값. 문구를 고치면 이 값도 함께 올린다.
  consent_version text NOT NULL DEFAULT 'sap-2026-10',

  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sap_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── 회차 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sap_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_no int NOT NULL UNIQUE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- 회차를 접수 대상에서 내릴 때 행을 지우지 않고 이 값을 내린다(신청 이력이 남아야 하므로).
  active boolean NOT NULL DEFAULT true,
  -- 선정 상한. 접수가 아니라 선정에만 적용한다.
  select_cap int NOT NULL DEFAULT 30 CHECK (select_cap > 0),

  -- 참가 링크 — 관리자만 입력·열람한다. 공개 화면·공개 API·CSV 기본값에 내보내지 않는다.
  zoom_url text NOT NULL DEFAULT '',
  zoom_note text NOT NULL DEFAULT '',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sap_sessions_span CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS sap_sessions_order_idx ON sap_sessions (starts_at);

-- 확정 회차 4건(2026-10-13·16·20·23 각 11:00~12:00 KST = 02:00~03:00 UTC).
--   Zoom 링크는 비워 둔다 — 관리자가 직접 넣는다(실링크를 새로 만들지 않는다).
INSERT INTO sap_sessions (session_no, starts_at, ends_at) VALUES
  (1, '2026-10-13T02:00:00Z', '2026-10-13T03:00:00Z'),
  (2, '2026-10-16T02:00:00Z', '2026-10-16T03:00:00Z'),
  (3, '2026-10-20T02:00:00Z', '2026-10-20T03:00:00Z'),
  (4, '2026-10-23T02:00:00Z', '2026-10-23T03:00:00Z')
ON CONFLICT (session_no) DO NOTHING;

-- ── 신청 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sap_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sap_sessions(id) ON DELETE RESTRICT,

  -- 필수
  company_name text NOT NULL,
  brand_name text NOT NULL DEFAULT '',
  no_brand boolean NOT NULL DEFAULT false,      -- 브랜드 미보유를 고른 경우
  contact_name text NOT NULL,
  job_role text NOT NULL,                        -- 대표 / 해외영업 / 마케팅 / 기타
  job_role_etc text NOT NULL DEFAULT '',
  email text NOT NULL,                           -- 입력 원문
  email_norm text NOT NULL,                      -- 정규화(소문자·trim) — 중복 판정 기준
  product_category text NOT NULL,
  overseas_stage text NOT NULL,
  target_countries text NOT NULL,                -- "아직 미정" 포함
  question text NOT NULL,                        -- 세미나 질문 또는 해결과제

  -- 선택
  phone text NOT NULL DEFAULT '',
  site_url text NOT NULL DEFAULT '',
  selling_countries text NOT NULL DEFAULT '',
  selling_channels text NOT NULL DEFAULT '',
  revenue_band text NOT NULL DEFAULT '',         -- '' = 미기입, 'undisclosed' = 미공개 선택
  overseas_revenue_band text NOT NULL DEFAULT '',
  export_timing text NOT NULL DEFAULT '',
  support_areas text NOT NULL DEFAULT '',
  wants_consult boolean NOT NULL DEFAULT false,  -- 1:1 상담 희망(별도 명시 항목)
  biz_no text NOT NULL DEFAULT '',               -- 사업자번호(선택)

  -- 동의 — 셋을 따로 기록한다. 광고 미동의가 신청·선정에 불이익이 되지 않는다.
  consent_required boolean NOT NULL DEFAULT false,
  consent_required_at timestamptz,
  consent_optional boolean NOT NULL DEFAULT false,
  consent_optional_at timestamptz,
  consent_ads boolean NOT NULL DEFAULT false,
  consent_ads_at timestamptz,
  consent_version text NOT NULL DEFAULT '',
  -- 동의 만료 시점 — 저장해 두고 파기 대상을 눈으로 확인할 수 있게 한다.
  --   이 값만으로 자동 삭제하지 않는다(현재 코드베이스에 자동 파기 작업이 없다).
  consent_required_expires_at timestamptz,
  consent_ads_expires_at timestamptz,
  --   광고 동의를 철회하면 철회 시각을 남긴다(앞선 동의 기록은 고치지 않는다).
  consent_ads_withdrawn_at timestamptz,

  -- 접수 ≠ 선정. 선착순 자동선정을 하지 않으므로 기본값은 submitted 다.
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','selected','waitlisted','not_selected','cancelled')),
  status_reason text NOT NULL DEFAULT '',
  selected_at timestamptz,
  admin_note text NOT NULL DEFAULT '',
  owner_admin_id text,

  -- 유입 출처. 기존 원장 값을 덮어쓰지 않고 이 표에만 둔다.
  --   전체 DB·해외판매 DB 는 서로 겹칠 수 있으므로 "출처 태그"로만 구분한다.
  source text NOT NULL DEFAULT 'seminar_apply',
  utm_source text NOT NULL DEFAULT '',
  utm_medium text NOT NULL DEFAULT '',
  utm_campaign text NOT NULL DEFAULT '',
  campaign_id text NOT NULL DEFAULT '',

  -- 기존 고객 원장과의 연결 — 확인 후에만 채운다(비파괴적, 자동 수정 없음).
  brand_id uuid,
  matched_at timestamptz,
  matched_by text NOT NULL DEFAULT '',

  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sap_reg_required_consent CHECK (consent_required),
  CONSTRAINT sap_reg_brand_or_none CHECK (no_brand OR brand_name <> '')
);
-- 같은 회차에 같은 이메일이 두 번 들어가지 않게(중복 제출 idempotency).
--   다른 회차는 별건으로 받는다.
CREATE UNIQUE INDEX IF NOT EXISTS sap_reg_session_email_uniq
  ON sap_registrations (session_id, email_norm);
CREATE INDEX IF NOT EXISTS sap_reg_session_idx ON sap_registrations (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sap_reg_status_idx ON sap_registrations (session_id, status);
CREATE INDEX IF NOT EXISTS sap_reg_email_idx ON sap_registrations (email_norm);
-- 선정 상한을 세는 질의가 쓰는 부분 인덱스.
CREATE INDEX IF NOT EXISTS sap_reg_selected_idx ON sap_registrations (session_id) WHERE status = 'selected';
-- 보유기간이 지난 행을 찾는 질의용.
CREATE INDEX IF NOT EXISTS sap_reg_expiry_idx ON sap_registrations (consent_required_expires_at);

-- ── 상태·동의 변경 이력 ──────────────────────────────────────
--   개인정보 본문은 담지 않는다(무엇이 언제 어떻게 바뀌었는지만).
CREATE TABLE IF NOT EXISTS sap_reg_events (
  id bigserial PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES sap_registrations(id) ON DELETE CASCADE,
  field text NOT NULL DEFAULT 'status',
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sap_reg_events_idx ON sap_reg_events (registration_id, at DESC);

-- 동의 이력 — 철회도 행 추가로만 남긴다(앞선 동의 기록을 고치지 않는다).
CREATE TABLE IF NOT EXISTS sap_consent_events (
  id bigserial PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES sap_registrations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('required','optional','ads')),
  granted boolean NOT NULL,
  consent_version text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',        -- 'applicant' 또는 관리자 식별자
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sap_consent_events_idx ON sap_consent_events (registration_id, at DESC);

-- ── 제출 속도 제한 ───────────────────────────────────────────
--   IP 원문을 남기지 않는다 — 분 단위 버킷 + 해시만 둔다.
CREATE TABLE IF NOT EXISTS sap_rate_hits (
  bucket text NOT NULL,          -- '<ip 해시>:<분 단위 시각>'
  n int NOT NULL DEFAULT 1,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket)
);
CREATE INDEX IF NOT EXISTS sap_rate_hits_at_idx ON sap_rate_hits (at);
