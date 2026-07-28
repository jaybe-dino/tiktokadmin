-- ─────────────────────────────────────────────────────────────
-- 02 · 단계별 커스텀 필수항목 (관리자 설정)
--
-- 핵심 게이트(lib/gates.ts)는 그대로 두고, 그 위에 관리자가 설정하는
-- "각 단계에서 무조건 체크/입력되어야 하는 항목"을 얹는다.
-- 전이 시: 코드 게이트 + (from 단계의) 활성·필수 요구항목 모두 충족해야 통과.
-- ─────────────────────────────────────────────────────────────

-- 단계별 요구항목 정의 (전역 템플릿)
CREATE TABLE IF NOT EXISTS stage_requirements (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state     text NOT NULL,                    -- 이 단계를 떠나기 전 충족 필요
  kind      text NOT NULL CHECK (kind IN ('check','field')),
  field_key text,                             -- kind='field' 일 때 검사할 brands 컬럼
  label     text NOT NULL,
  required  boolean NOT NULL DEFAULT true,
  sort      int NOT NULL DEFAULT 0,
  active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stage_requirements_state_idx ON stage_requirements (state, active);

-- 브랜드별 체크 상태 (kind='check' 항목)
CREATE TABLE IF NOT EXISTS brand_stage_checks (
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  req_id   uuid NOT NULL REFERENCES stage_requirements(id) ON DELETE CASCADE,
  done     boolean NOT NULL DEFAULT false,
  done_by  text,
  done_at  timestamptz,
  PRIMARY KEY (brand_id, req_id)
);

-- 기본 시드 (관리자가 /settings 에서 수정·추가·비활성 가능)
INSERT INTO stage_requirements (state, kind, field_key, label, sort) VALUES
  ('meeting',       'field', 'category', '카테고리 입력', 1),
  ('meeting',       'check', NULL,       '니즈·예산 파악', 2),
  ('contact',       'check', NULL,       '제안서 발송', 1),
  ('contact',       'check', NULL,       '결제 방식 합의', 2),
  ('contract_done', 'check', NULL,       '계약서 서명본 수령', 1),
  ('docs',          'check', NULL,       '서류 원본 대조', 1),
  ('setup',         'check', NULL,       '입점 계정 생성 확인', 1),
  ('setup',         'check', NULL,       '정산 계좌 등록', 2),
  ('live_mall',     'check', NULL,       '킥오프 미팅 완료', 1)
ON CONFLICT DO NOTHING;
