-- 보류(hold) 세분화 + 보류 SLA 7일 (BUG-28/29, 칸반 보류 2라인).
--   hold_kind: 'recontact'(재컨택 — 7영업일 후 알림, 다시 7영업일 후 자동 드랍)
--              'handoff'  (이관클로징 — 플로우링크 이관 대기, 자동 드랍하지 않음)
--   NULL 은 재컨택으로 간주(기존 보류 건 하위호환).
ALTER TABLE brands ADD COLUMN IF NOT EXISTS hold_kind text;

-- 보류 SLA 7일(영업일). 기존 정책이 있으면 갱신.
INSERT INTO sla_policies (state, max_days) VALUES ('hold', 7)
ON CONFLICT (state) DO UPDATE SET max_days = EXCLUDED.max_days;
