-- ═════════════════════════════════════════════════════════════
-- 107 · 틱톡샵 주간 온보딩 신청 (추가만)
--   세미나 전 온보딩 상담·준비 신청을 따로 받아, 직원이 바로 조회·연락할 수 있게 한다.
--
--   일부러 하지 않는 것
--     · brands 를 만들거나 기존 고객 값을 덮어쓰지 않는다 — 이 표에만 쌓인다.
--     · 자동 문자·메일 캠페인(intake_channels · lead_sequence)에 다시 등록하지 않는다.
--     · 선착순 확정·자동 마감 로직을 두지 않는다. "주 3개 브랜드 모집"은 안내 문구일 뿐이다.
--     · 보관기간을 새로 정하지 않는다 — 기존 안내(관련 법령에 따라 처리)를 그대로 쓴다.
--   의존: 없음(admin_users.id 는 text 참조만 하고 FK 를 걸지 않는다)
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS weekly_onb_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 신청자가 적는 값
  brand_name text NOT NULL,
  company_name text NOT NULL,
  site_url text NOT NULL DEFAULT '',
  contact_name text NOT NULL,
  contact_title text NOT NULL DEFAULT '',
  phone text NOT NULL,
  email text NOT NULL,
  note text NOT NULL DEFAULT '',

  -- 어느 주차 모집에 들어온 신청인지(KST 월요일). 같은 주 중복 제출을 막는 단위다.
  week_key date NOT NULL,
  -- 중복 판정용 정규화 값(소문자 이메일 + 숫자만 남긴 전화).
  dedupe_key text NOT NULL,

  -- 이 신청의 연락 진행 상태. 계약·온보딩 단계(brands.state)와 별개이며 서로 건드리지 않는다.
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','scheduled','done','dropped')),
  owner_admin_id text,
  admin_note text NOT NULL DEFAULT '',

  -- 유입 출처 구분 — 기존 리드 소스와 섞지 않는다.
  source text NOT NULL DEFAULT 'weekly_onboarding',
  -- 검수용 합성 데이터 표시. 집계·목록 기본값에서 가려낼 수 있다.
  is_test boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weekly_onb_created_idx ON weekly_onb_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS weekly_onb_week_idx ON weekly_onb_applications (week_key DESC, status);
-- 같은 사람이 같은 주에 두 번 접수되지 않게(새로고침·중복 클릭 방지).
--   다음 주에는 다시 신청할 수 있다 — 주간 모집이므로 영구 차단하지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS weekly_onb_dedupe_uniq
  ON weekly_onb_applications (dedupe_key, week_key);

-- 상태 변경 이력 — 누가 언제 무엇을 바꿨는지만 남긴다(개인정보는 담지 않는다).
CREATE TABLE IF NOT EXISTS weekly_onb_events (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES weekly_onb_applications(id) ON DELETE CASCADE,
  field text NOT NULL DEFAULT 'status',
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weekly_onb_events_app_idx ON weekly_onb_events (application_id, at DESC);
