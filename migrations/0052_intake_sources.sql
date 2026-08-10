-- ═════════════════════════════════════════════════════════════
-- 52 · 유입 소스 라벨 관리(CRUD) — 자동발송 허용 유입소스 목록을 DB 로.
--   기존엔 소스 라벨이 코드 3곳(lib/types SOURCES, ChannelManager, WelcomeConfig)에
--   하드코딩·불일치 → "다 안 보임". 이 테이블이 단일 소스 오브 트루스.
--   intake_channels.source / welcome_config.sources[] 가 참조하는 key 목록.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS intake_sources (
  key text PRIMARY KEY,                       -- 소스 식별 키 (예: meta_ads)
  label text NOT NULL,                        -- 표시명 (예: 메타/페북 광고)
  enabled boolean NOT NULL DEFAULT true,      -- 목록 노출/선택 가능 여부
  sort int NOT NULL DEFAULT 100,              -- 정렬 순서
  builtin boolean NOT NULL DEFAULT false,     -- 코드 기본 소스(참고용; 삭제 시 경고)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- lib/types.ts SOURCES/SOURCE_LABELS 13개 시드 (이미 있으면 유지).
INSERT INTO intake_sources (key, label, sort, builtin) VALUES
  ('glovek_consult', 'Glovek 상담',      10, true),
  ('glovek_inquiry', 'Glovek 문의',      20, true),
  ('glovek_signup',  'Glovek 가입',      30, true),
  ('apply_consult',  'apply 상담',       40, true),
  ('apply_seminar',  'apply 세미나',     50, true),
  ('apply_qna',      'apply QnA',        60, true),
  ('apply_smr',      'apply SMR',        70, true),
  ('tp_seminar',     'tpartners 세미나', 80, true),
  ('tp_ebook',       'tpartners 전자책', 90, true),
  ('referrer',       '영업 직접',       100, true),
  ('expo',           '전시/팝업',       110, true),
  ('meta_ads',       '메타/페북 광고',  120, true),
  ('etc',            '기타',            999, true)
ON CONFLICT (key) DO NOTHING;
