-- ═════════════════════════════════════════════════════════════
-- 103 · 주간 세미나 안내 자동발송 (추가만)
--   매주 월요일 10:30(KST) 온라인 세미나 안내(1차)와 11:10 후속(2차) 발송을 서버에서 처리한다.
--   대상은 "그 회차의 모집 구간에 새로 들어온 세미나 신청"뿐이다 —
--   전체 누적 리드·다른 유입 루트·테스트 리드는 들어오지 않는다.
--
--   신청 시각은 브랜드 수정시각이 아니라 신청 이벤트의 brand_sources.occurred_at 을 쓴다.
--   (brands.source 는 최초 생성 때만 정해져 재신청을 반영하지 않으므로 대상 판정에 쓰지 않는다.)
--
--   표 구성
--     · seminar_config    : 1행 전역 설정(주간 경계·시각·Zoom 링크·마스터 스위치)
--     · seminar_templates : 단계별 문구(초안). enabled=false 면 그 단계는 발송하지 않는다.
--     · seminar_sessions  : 회차(월요일 1건). 모집 구간·Zoom 링크를 그 회차에 고정한다.
--     · seminar_targets   : 회차별 대상(신청 1건 = 1행). 신청 시점에 회차가 고정된다.
--     · seminar_sends     : 회차×대상×단계×채널 발송 원장(중복 방지·재시도·provider id)
--     · seminar_runs      : 실행 이력(동시 실행 잠금)
--
--   기본값은 전부 "보내지 않음" 이다 — enabled=false · zoom_url 없음 · 템플릿 비활성.
--   의존: brands(0001) · brand_sources(0001)
-- ═════════════════════════════════════════════════════════════

-- ── 전역 설정(1행) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seminar_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- 마스터 스위치. false 면 예약만 만들고 실제 발송은 하지 않는다(기본 OFF).
  enabled boolean NOT NULL DEFAULT false,

  -- 대상 판정 —— 세미나 신청으로 인정할 유입 소스 키(intake_sources.key).
  source_keys text[] NOT NULL DEFAULT ARRAY['apply_seminar','tp_seminar'],

  -- 주간 경계 —— 확정 전까지 바꿔 끼울 수 있게 둔다.
  --   session_to_session : 지난 회차 시작(월 10:30) ~ 이번 회차 시작 직전
  --   calendar_week      : 지난 주 월 00:00 ~ 일 23:59:59(KST)
  week_mode text NOT NULL DEFAULT 'session_to_session'
    CHECK (week_mode IN ('session_to_session','calendar_week')),

  -- 회차 시각(KST). 1차 10:30 · 2차 11:10.
  session_weekday int NOT NULL DEFAULT 1 CHECK (session_weekday BETWEEN 0 AND 6),  -- 0=일 … 1=월
  session_hour int NOT NULL DEFAULT 10 CHECK (session_hour BETWEEN 0 AND 23),
  session_minute int NOT NULL DEFAULT 30 CHECK (session_minute BETWEEN 0 AND 59),
  followup_hour int NOT NULL DEFAULT 11 CHECK (followup_hour BETWEEN 0 AND 23),
  followup_minute int NOT NULL DEFAULT 10 CHECK (followup_minute BETWEEN 0 AND 59),

  -- 안내 발송 시각(KST) — 회차 며칠 전 몇 시에 보낼지. 확정 전이라 기본은 회차 당일.
  notice_lead_days int NOT NULL DEFAULT 0 CHECK (notice_lead_days BETWEEN 0 AND 7),
  notice_hour int NOT NULL DEFAULT 9 CHECK (notice_hour BETWEEN 0 AND 23),
  notice_minute int NOT NULL DEFAULT 0 CHECK (notice_minute BETWEEN 0 AND 59),

  -- 늦은 신청 처리 —— 안내 발송이 이미 끝난 뒤 들어온 신청.
  --   send_now  : 회차 시작 cutoff 전이면 즉시 안내(한 번만)
  --   next_week : 다음 회차로 넘김
  --   skip      : 안내하지 않음(수동 처리)
  late_policy text NOT NULL DEFAULT 'send_now' CHECK (late_policy IN ('send_now','next_week','skip')),
  -- 회차 시작 몇 분 전까지 접수를 그 회차로 볼지(그 뒤 신청은 다음 회차).
  cutoff_minutes int NOT NULL DEFAULT 30 CHECK (cutoff_minutes BETWEEN 0 AND 1440),

  -- 수신자 묶는 기준 —— contact(연락처 단위, 같은 팀 다른 참석자는 각자 수신) / brand(팀 1건)
  dedupe_scope text NOT NULL DEFAULT 'contact' CHECK (dedupe_scope IN ('contact','brand')),

  -- 고정 Zoom 링크(전용 참가 링크). 비어 있으면 발송을 차단한다(허위 링크 금지).
  zoom_url text NOT NULL DEFAULT '',
  -- 안내에 쓰는 세미나 제목.
  session_title text NOT NULL DEFAULT 'GloveK 온라인 세미나 | 녹화 강의',
  -- 이 날짜 이전 회차는 만들지 않는다(첫 회차 이전 주를 실수로 만들지 않게).
  first_session_date date NOT NULL DEFAULT DATE '2026-10-05',

  -- 채널 마스터 토글(단계별 토글은 seminar_templates 에 따로 있다).
  send_email boolean NOT NULL DEFAULT true,
  send_sms boolean NOT NULL DEFAULT true,

  max_attempts int NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  -- 예정 시각이 이만큼 지난 예약은 보내지 않는다(스위치를 켠 순간 묵은 안내가 쏟아지는 것 방지).
  stale_hours int NOT NULL DEFAULT 6 CHECK (stale_hours BETWEEN 1 AND 168),
  note text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 확정된 고정 참가 링크·제목·첫 회차를 설정값으로 넣어 둔다.
--   enabled 는 false 그대로다 — 링크가 연결돼도 실제 발송은 담당자가 켜야 시작된다.
INSERT INTO seminar_config (id, zoom_url, session_title, first_session_date)
VALUES (1,
        'https://us06web.zoom.us/j/82484286530?pwd=PgiKDarEsIvjlL5egs0GGYgkSaZUFw.1',
        'GloveK 온라인 세미나 | 녹화 강의',
        DATE '2026-10-05')
ON CONFLICT (id) DO NOTHING;

-- ── 단계별 문구(초안) ───────────────────────────────────────
--   purpose: service = 신청한 세미나의 참가 안내(거래·서비스 안내)
--            ad      = 광고성 내용(광고 수신거부 대상 — 기존 규칙 그대로 적용)
CREATE TABLE IF NOT EXISTS seminar_templates (
  stage text PRIMARY KEY CHECK (stage IN ('notice','followup')),
  enabled boolean NOT NULL DEFAULT false,      -- 확정 전까지 초안 상태
  purpose text NOT NULL CHECK (purpose IN ('service','ad')),
  send_email boolean NOT NULL DEFAULT true,
  send_sms boolean NOT NULL DEFAULT true,
  email_subject text NOT NULL DEFAULT '',
  email_body text NOT NULL DEFAULT '',
  sms_body text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 초안 시드 — 모두 enabled=false(담당자가 문구를 확정하고 켠다).
--   {{브랜드명}} {{담당자명}} {{일시}} {{줌링크}} 치환.
INSERT INTO seminar_templates (stage, purpose, email_subject, email_body, sms_body) VALUES
  ('notice', 'service',
   '[GloveK] {{세미나명}} 참가 안내 ({{일시}})',
   E'{{담당자명}}님, 안녕하세요. 디노스튜디오 GloveK입니다.\n\n신청해 주신 {{세미나명}} 참가 안내를 드립니다.\n\n• 일시: {{일시}}\n• 참여 링크: {{줌링크}}\n\n대기실이 열려 있어 순차로 입장 처리되며, 입장 시 마이크는 음소거 상태입니다.\n시작 5분 전까지 위 링크로 접속해 주세요.\n\n디노스튜디오 GloveK 드림',
   E'[GloveK] {{세미나명}}\n{{일시}}\n{{줌링크}}'),
  ('followup', 'ad',
   '[GloveK] 2부 세션 안내 ({{일시}})',
   E'{{담당자명}}님, 안녕하세요.\n\n이어지는 2부 세션 안내를 드립니다.\n\n• 일시: {{일시}}\n• 참여 링크: {{줌링크}}\n\n디노스튜디오 GloveK 드림',
   E'[GloveK] 2부 세션 {{일시}}\n{{줌링크}}')
ON CONFLICT (stage) DO NOTHING;

-- ── 회차 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seminar_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date date NOT NULL UNIQUE,           -- KST 기준 회차 날짜(월요일)
  starts_at timestamptz NOT NULL,              -- 1차 시작(10:30 KST)
  followup_at timestamptz NOT NULL,            -- 2차 시작(11:10 KST)
  notice_due_at timestamptz NOT NULL,          -- 안내 발송 예정 시각
  -- 모집 구간 — 이 구간에 들어온 신청만 이 회차 대상이다.
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  -- 회차 생성 시점의 설정 스냅샷(나중에 설정이 바뀌어도 이 회차 판정은 그대로).
  week_mode text NOT NULL,
  source_keys text[] NOT NULL,
  zoom_url text NOT NULL DEFAULT '',
  session_title text NOT NULL DEFAULT '',
  dedupe_scope text NOT NULL DEFAULT 'contact',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','canceled')),
  note text NOT NULL DEFAULT '',
  built_at timestamptz,                        -- 대상 명단을 마지막으로 새로 만든 시각
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seminar_sessions_start_idx ON seminar_sessions (starts_at DESC);

-- ── 회차별 대상 ─────────────────────────────────────────────
--   신청 1건(brand_sources 의 lead 이벤트) = 1행. 회차가 여기서 고정되므로
--   11:10 후속도 같은 회차 대상에게만 나간다.
CREATE TABLE IF NOT EXISTS seminar_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES seminar_sessions(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  lead_event_id uuid NOT NULL,                 -- brand_sources.id (신청 건)
  applied_at timestamptz NOT NULL,             -- brand_sources.occurred_at (신청 시각)
  source_key text NOT NULL DEFAULT '',
  -- 발송 시점 스냅샷(브랜드 정보가 나중에 바뀌어도 원장이 흔들리지 않게)
  brand_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  -- 중복 판정용 정규화 값(소문자 이메일 / 숫자만 남긴 전화)
  dedupe_email text NOT NULL DEFAULT '',
  dedupe_phone text NOT NULL DEFAULT '',
  -- eligible=발송 대상 · duplicate=같은 회차 같은 연락처 재신청 · excluded=연락처 없음 등
  -- deferred=늦은 신청을 다음 회차로 이월(다음 회차 생성 때 함께 편입된다)
  status text NOT NULL DEFAULT 'eligible'
    CHECK (status IN ('eligible','duplicate','excluded','deferred')),
  exclude_reason text NOT NULL DEFAULT '',
  late boolean NOT NULL DEFAULT false,          -- 안내 예정 시각 이후에 들어온 신청
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, lead_event_id)
);
CREATE INDEX IF NOT EXISTS seminar_targets_session_idx ON seminar_targets (session_id, status);
CREATE INDEX IF NOT EXISTS seminar_targets_brand_idx ON seminar_targets (brand_id);
-- 같은 회차에서 같은 연락처가 두 번 대상이 되지 않게 하는 안전망(경합 대비).
CREATE UNIQUE INDEX IF NOT EXISTS seminar_targets_email_uniq
  ON seminar_targets (session_id, dedupe_email) WHERE status='eligible' AND dedupe_email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS seminar_targets_phone_uniq
  ON seminar_targets (session_id, dedupe_phone) WHERE status='eligible' AND dedupe_phone <> '';

-- ── 발송 원장 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seminar_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES seminar_sessions(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES seminar_targets(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('notice','followup')),
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed','skipped','canceled')),
  attempts int NOT NULL DEFAULT 0,
  claimed_at timestamptz,                      -- 'sending' 선점 시각(멈춘 건 회수용)
  sent_at timestamptz,
  provider text NOT NULL DEFAULT '',           -- gmail|resend|aligo
  provider_id text NOT NULL DEFAULT '',        -- 메시지 id (추적용)
  error text NOT NULL DEFAULT '',
  skip_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 회차 + 수신자 + 단계 + 채널 = 1건. 재시도해도 새 행이 생기지 않는다.
  UNIQUE (session_id, target_id, stage, channel)
);
CREATE INDEX IF NOT EXISTS seminar_sends_due_idx ON seminar_sends (status, due_at);
CREATE INDEX IF NOT EXISTS seminar_sends_session_idx ON seminar_sends (session_id, stage, status);

-- ── 실행 이력(동시 실행 잠금) ───────────────────────────────
CREATE TABLE IF NOT EXISTS seminar_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('build','dispatch')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary text NOT NULL DEFAULT '',
  error text,
  triggered_by text NOT NULL DEFAULT 'cron'
);
-- 같은 종류의 실행이 동시에 두 개 돌지 않게 한다(크론 중복·수동 실행 겹침 방지).
CREATE UNIQUE INDEX IF NOT EXISTS seminar_runs_one_running
  ON seminar_runs (kind) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS seminar_runs_started_idx ON seminar_runs (started_at DESC);
