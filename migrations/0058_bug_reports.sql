-- 기능오류 제보 — 화면 우하단 플로팅 버튼에서 스크린샷+설명 제출.
--   제출 시점의 URL·브라우저·뷰포트 등 디버깅 정보를 함께 수집, 관리 파트에서 목록으로 트리아지.
CREATE TABLE IF NOT EXISTS bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text,                               -- 제보 시점 페이지 URL
  description text NOT NULL DEFAULT '',    -- 사용자 설명
  reporter text,                          -- admin_users.id(이메일)
  user_agent text,
  viewport text,                          -- "1440x900"
  meta jsonb NOT NULL DEFAULT '{}',        -- 언어·referrer·플랫폼·시각 등 부가 수집
  image bytea,                            -- 스크린샷(선택)
  image_mime text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','triaged','in_progress','resolved','wontfix')),
  dev_note text NOT NULL DEFAULT '',       -- 개발 추가할 사항 정리(관리자 메모)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bug_reports_status_idx ON bug_reports (status, created_at DESC);
