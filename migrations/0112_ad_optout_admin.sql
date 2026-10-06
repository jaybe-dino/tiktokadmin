-- ═════════════════════════════════════════════════════════════
-- 112 · 수신거부 명단 관리 — 수동 등록·해제 이력 (추가만)
--   담당자가 전화·메일로 받은 거부 요청을 직접 목록에 넣고, 잘못 넣은 건을 되돌릴 수 있게 한다.
--   누가 언제 무엇을 왜 바꿨는지 남겨야 하므로 이력 표를 따로 둔다.
--
--   일부러 하지 않는 것
--     · 기존 ad_optouts 의 행을 건드리지 않는다. 컬럼도 지우거나 바꾸지 않는다.
--     · 고객이 링크로 누른 기록(source='link')을 수정하거나 지우지 않는다.
--     · 주소를 해싱하지 않는다 — 대조가 안 되면 차단 자체가 무력해진다(0098 과 같은 판단).
--   의존: 0098_ad_optout.sql
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ad_optout_events (
  id bigserial PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('add','remove')),
  kind text NOT NULL CHECK (kind IN ('email','phone')),
  -- 화면·이력에는 마스킹 값만 남긴다. 원문 주소는 ad_optouts 에만 둔다.
  addr_masked text NOT NULL DEFAULT '',
  -- 대조용 지문 — 원문을 다시 적지 않고도 "같은 주소였는지" 확인할 수 있게 한다.
  addr_fingerprint text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_optout_events_at_idx ON ad_optout_events (at DESC);
CREATE INDEX IF NOT EXISTS ad_optout_events_fp_idx ON ad_optout_events (addr_fingerprint, at DESC);
