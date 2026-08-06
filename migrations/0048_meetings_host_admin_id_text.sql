-- ═════════════════════════════════════════════════════════════
-- 48 · meetings.host_admin_id 타입 교정 (uuid → text).
--   admin_users.id 는 text(이메일)이고 owner_*·created_by 등 모든 관리자 식별 컬럼이 text 인데,
--   meetings.host_admin_id 만 uuid 로 잘못 정의되어 있었다. 이 때문에
--     · 수동 미팅 추가(createMeetingAction) 시 host_admin_id 에 이메일을 넣어 INSERT 실패
--     · 줌 웹훅 동기화(matchHostAdmin→host_admin_id) 시 호스트가 아는 관리자면 INSERT/UPDATE 실패
--   가 발생했다. 기존 값은 항상 INSERT 실패로 비어 있으므로 무손실 변환.
-- ═════════════════════════════════════════════════════════════
ALTER TABLE meetings
  ALTER COLUMN host_admin_id TYPE text USING host_admin_id::text;
