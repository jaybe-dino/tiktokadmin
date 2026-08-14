-- 기능오류 제보 티켓 번호(사람이 읽는 오류번호) — 순번. 화면 표시·요청 참조용.
CREATE SEQUENCE IF NOT EXISTS bug_reports_ticket_seq;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS ticket_no bigint;

-- 기존 행 백필(생성순).
UPDATE bug_reports SET ticket_no = sub.rn
  FROM (SELECT id, row_number() OVER (ORDER BY created_at) AS rn FROM bug_reports WHERE ticket_no IS NULL) sub
 WHERE bug_reports.id = sub.id AND bug_reports.ticket_no IS NULL;

-- 시퀀스를 현재 최댓값 뒤로 이동 + 신규 행 기본값.
SELECT setval('bug_reports_ticket_seq', COALESCE((SELECT max(ticket_no) FROM bug_reports), 0));
ALTER TABLE bug_reports ALTER COLUMN ticket_no SET DEFAULT nextval('bug_reports_ticket_seq');
