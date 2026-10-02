-- ═════════════════════════════════════════════════════════════
-- 109 · 세미나 모집 허브 · 행사별 신청 · 독립 참석자 DB (추가만)
--   공개 세미나 목록(/events)과 행사별 신청(/events/<slug>/apply), 그리고
--   행사마다 따로 열 수 있는 외부 열람 링크(/roster/<token>)를 위한 표.
--
--   표 이름은 모두 sev_ (SEminar eVent) 로 시작한다 — 브랜드 원장·영업 파이프라인과
--   한눈에 구분되도록 하고, 코드에서도 이 접두어 밖의 표를 건드리지 않는다.
--
--   일부러 하지 않는 것
--     · brands · brand_sources · leads · intake_channels · lead_sequence 를 읽거나 쓰지 않는다.
--       세미나 신청이 브랜드 생성·수정이나 1~4일차 자동발송 진입을 일으키지 않는다.
--     · 기존 seminar_* (0103/0105 주간 안내 발송) 표를 건드리지 않는다. 이름도 겹치지 않는다.
--     · weekly_onb_* (0107/0108 온보딩 사전신청) 을 옮기거나 백필하지 않는다.
--     · 외부 공유를 미리 켜지 않는다 — sev_shares.enabled 기본 false, password_hash 기본 NULL.
--       비밀번호를 임의로 만들어 넣지 않는다(관리자가 직접 설정해야 활성화된다).
--     · 초기 행사는 전부 초안(status='draft', publish=false)으로만 넣는다.
--       포스터가 없으므로 임의 이미지를 만들어 붙이지 않는다.
--     · 보관기간을 새로 정하지 않는다 — 기존 개인정보 안내를 그대로 쓴다.
--   의존: 없음(admin_users.id 는 text 로만 참조하고 FK 를 걸지 않는다)
-- ═════════════════════════════════════════════════════════════

-- ── 포스터·첨부 파일(DB 저장) ─────────────────────────────────
--   onb_files 와 같은 방식(bytea)이지만 표를 따로 둔다 — 온보딩 서류와 섞이지 않게.
CREATE TABLE IF NOT EXISTS sev_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'poster' CHECK (kind IN ('poster')),
  filename text NOT NULL DEFAULT '',
  mime text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  bytes bytea NOT NULL,
  uploaded_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 교체하면 이전 파일은 지우지 않고 이 값만 채운다(이력 보존).
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sev_files_created_idx ON sev_files (created_at DESC);

-- ── 행사 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sev_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 행사별 고정 신청 URL 의 조각. 한 번 공개한 뒤에는 바꾸지 않는 것을 전제로 한다.
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  detail_md text NOT NULL DEFAULT '',

  -- 온·오프라인 구분과 장소
  mode text NOT NULL DEFAULT 'online' CHECK (mode IN ('online','offline','hybrid')),
  venue text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  -- "제안 단계 · 대관 미확정" 처럼 아직 확정되지 않은 사정을 그대로 적는다.
  venue_note text NOT NULL DEFAULT '',
  hosts text NOT NULL DEFAULT '',

  -- 일시(KST 로 표시한다). 시간이 아직 안 잡혔으면 time_tbd=true 로 두고 날짜만 쓴다.
  starts_at timestamptz,
  ends_at timestamptz,
  time_tbd boolean NOT NULL DEFAULT false,
  -- "매주 월요일 10:30" 처럼 반복 일정을 사람이 읽는 문장으로 둔다(자동 생성 없음).
  recurring_note text NOT NULL DEFAULT '',

  -- 온라인 참가 링크. 확정 전에는 비워 두고, 공개 여부는 따로 켠다
  --   (허위 링크를 걸지 않기 위해 둘을 분리했다).
  online_url text NOT NULL DEFAULT '',
  show_online_url boolean NOT NULL DEFAULT false,

  -- 정원. NULL 이면 미설정이고 정원 검사를 하지 않는다.
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  -- 신청 폼에서 고를 수 있는 관심 국가(쉼표 구분). 비우면 자유 입력만 받는다.
  countries text NOT NULL DEFAULT '',

  -- 모집 상태. 종료(done)·취소(cancelled) 행도 지우지 않고 이력으로 남긴다.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','upcoming','open','closed','done','cancelled')),
  -- 공개 허브(/events)에 띄울지. 초안은 false 로 두어 "공개 초안"과 "실제 모집"을 구분한다.
  publish boolean NOT NULL DEFAULT false,
  -- 신청 접수를 받을지. publish 와 따로 둔다(게시만 하고 접수는 닫아둘 수 있게).
  apply_open boolean NOT NULL DEFAULT false,

  poster_file_id uuid REFERENCES sev_files(id),

  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sev_events_pub_idx ON sev_events (publish, status, starts_at);
CREATE INDEX IF NOT EXISTS sev_events_start_idx ON sev_events (starts_at DESC NULLS LAST);

-- ── 신청자(참석자) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sev_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES sev_events(id) ON DELETE CASCADE,

  company_name text NOT NULL,
  brand_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL,
  contact_title text NOT NULL DEFAULT '',
  phone text NOT NULL,
  email text NOT NULL,
  site_url text NOT NULL DEFAULT '',
  countries text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',

  -- 개인정보 수집·이용 동의(필수)와 마케팅 정보 수신 동의(선택)를 따로 기록한다.
  privacy_agreed boolean NOT NULL DEFAULT false,
  privacy_agreed_at timestamptz,
  marketing_agreed boolean NOT NULL DEFAULT false,
  marketing_agreed_at timestamptz,
  -- 동의 시점에 화면에 떠 있던 안내문 식별자(문구가 바뀌어도 무엇에 동의했는지 남게).
  consent_version text NOT NULL DEFAULT '',

  -- 신청 접수(applied)와 참석 확정(confirmed)을 구분한다. 확정은 직원이 직접 바꾼다.
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied','waitlist','confirmed','attended','noshow','cancelled')),
  admin_note text NOT NULL DEFAULT '',
  owner_admin_id text,

  -- 같은 행사에 같은 연락처로 두 번 접수되지 않게. 다른 행사는 따로 신청할 수 있다.
  dedupe_key text NOT NULL,
  source text NOT NULL DEFAULT 'seminar_event',
  is_test boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sev_reg_dedupe_uniq ON sev_registrations (event_id, dedupe_key);
CREATE INDEX IF NOT EXISTS sev_reg_event_idx ON sev_registrations (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sev_reg_status_idx ON sev_registrations (event_id, status);

-- 상태·담당·메모 변경 이력. 개인정보 본문은 담지 않는다(무엇이 바뀌었는지만).
CREATE TABLE IF NOT EXISTS sev_reg_events (
  id bigserial PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES sev_registrations(id) ON DELETE CASCADE,
  field text NOT NULL DEFAULT 'status',
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sev_reg_events_idx ON sev_reg_events (registration_id, at DESC);

-- ── 행사별 외부 열람 링크 ────────────────────────────────────
--   한 행사에 여러 공유 대상(주최사·연사 등)을 각각 다른 링크·비밀번호로 줄 수 있다.
CREATE TABLE IF NOT EXISTS sev_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES sev_events(id) ON DELETE CASCADE,
  -- URL 조각. 회전(rotate)하면 새 값으로 바뀌고 기존 링크는 즉시 죽는다.
  token text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT '',

  -- scrypt 해시만 저장한다. NULL 이면 비밀번호 미설정 — 이 상태로는 활성화되지 않는다.
  password_hash text,
  password_set_at timestamptz,
  -- 기본 false. 관리자가 공유 대상과 노출 항목을 확인한 뒤에만 켠다.
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by text NOT NULL DEFAULT '',

  -- 외부에 보여줄 항목. 기본은 회사·브랜드·신청/참석상태뿐이고 연락처는 마스킹된 값만 고를 수 있다.
  fields text[] NOT NULL DEFAULT ARRAY['company','brand','status']::text[],
  -- 외부 내려받기는 기본 OFF.
  allow_download boolean NOT NULL DEFAULT false,

  expires_at timestamptz,
  revoked_at timestamptz,
  rotated_at timestamptz,

  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sev_shares_event_idx ON sev_shares (event_id, created_at DESC);

-- 외부 열람 세션. 쿠키에는 이 토큰만 담고, 어떤 공유(=어떤 행사)인지는 서버가 여기서 읽는다.
CREATE TABLE IF NOT EXISTS sev_share_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES sev_shares(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS sev_share_sessions_share_idx ON sev_share_sessions (share_id, expires_at DESC);

-- 비밀번호 시도 기록 — 횟수 제한에만 쓴다. 입력한 비밀번호는 남기지 않는다.
CREATE TABLE IF NOT EXISTS sev_share_attempts (
  id bigserial PRIMARY KEY,
  share_id uuid NOT NULL REFERENCES sev_shares(id) ON DELETE CASCADE,
  ok boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sev_share_attempts_idx ON sev_share_attempts (share_id, at DESC);

-- ── 초기 행사: 전부 초안(비공개·접수닫힘) ────────────────────
--   확정되지 않은 시간·장소는 비워 두고 사정을 venue_note 에 적는다.
--   포스터는 실제 파일이 없으므로 붙이지 않는다(임의 제작 금지).
INSERT INTO sev_events
  (slug, title, summary, mode, venue, address, venue_note, hosts,
   starts_at, ends_at, time_tbd, recurring_note, countries, status, publish, apply_open, created_by)
VALUES
  ('weekly-tiktokshop-online',
   '틱톡샵 온라인 세미나',
   '틱톡샵 입점·운영 기본기를 다루는 온라인 세미나입니다.',
   'online', '', '', '참가 링크는 확정된 값을 관리자가 등록한 뒤 공개합니다.',
   '글로브K',
   timestamptz '2026-10-05 10:30+09', NULL, false,
   '매주 월요일 10:30 (KST)', '', 'draft', false, false, 'seed:0109'),

  ('tiktokshop-japan-global-1006',
   'TikTok Shop 일본·글로벌 진출 실무',
   'TikTok Shop 일본 및 글로벌 진출 실무를 다루는 오프라인 세미나입니다.',
   'offline', '숭실대 테크스테이션 컨퍼런스홀', '상도로55길 6', '',
   '비브로 · 디노 · 숭실대 캠퍼스타운',
   timestamptz '2026-10-06 13:00+09', timestamptz '2026-10-06 16:00+09', false,
   '', '일본,글로벌', 'draft', false, false, 'seed:0109'),

  ('global-strategy-bio-ceo-1020',
   '글로벌 진출 전략 + 전경련 바이오 CEO 클럽',
   '글로벌 진출 전략 세션과 전경련 바이오 CEO 클럽을 함께 진행하는 일정입니다.',
   'offline', '', '', '제안 단계 · 대관 미확정', '',
   timestamptz '2026-10-20 13:00+09', timestamptz '2026-10-20 18:00+09', false,
   '', '', 'draft', false, false, 'seed:0109'),

  ('hanjin-oneclick-connect-1022',
   '한진 원클릭 커넥트 — K브랜드 미국·일본 진출',
   'K브랜드의 미국·일본 진출을 다루는 한진 원클릭 커넥트 세션입니다.',
   'offline', '', '', '시간 · 장소 미확인', '한진',
   timestamptz '2026-10-22 00:00+09', NULL, true,
   '', '미국,일본', 'draft', false, false, 'seed:0109'),

  ('japan-tiktokshop-1026',
   '일본 TikTok Shop 실무',
   '일본 TikTok Shop 운영 실무를 다루는 세션입니다.',
   'offline', '', '', '시간 · 장소 미정', '',
   timestamptz '2026-10-26 00:00+09', NULL, true,
   '', '일본', 'draft', false, false, 'seed:0109')
ON CONFLICT (slug) DO NOTHING;
