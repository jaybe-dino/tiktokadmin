-- 담당자별 "오늘 내 할 일" 일일 다이제스트 — 매일 12:00(KST) AI 에이전트가 갱신.
--   어제까지의 열린 항목(회신 필요·SLA·마감·초안·미팅 등)을 담당자별로 요약·정리해 저장.
--   홈(오늘)에서 "내 담당만"일 때 본인 몫을 표시.
CREATE TABLE IF NOT EXISTS daily_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id text NOT NULL,
  for_date date NOT NULL,
  summary text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{brand_id,brand_name,task,reason,priority,link}]
  generated_by text NOT NULL DEFAULT 'agent', -- agent(AI) | rules(규칙기반)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, for_date)
);
CREATE INDEX IF NOT EXISTS daily_todos_user_date_idx ON daily_todos (admin_user_id, for_date DESC);
