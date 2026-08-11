-- 기존 이메일 캘린더 미팅 제목에서 URL(예약페이지·줌 링크 등) 제거 — 링크가 제목처럼 보이던 문제 정리.
--   URL 을 걷어내고 공백 정리, 남는 텍스트가 없으면 '미팅 초대'.
UPDATE meetings
   SET topic = COALESCE(
     NULLIF(
       btrim(regexp_replace(
         regexp_replace(topic, 'https?://[^[:space:]]+', ' ', 'gi'),
         '[[:space:]]+', ' ', 'g'
       )),
       ''
     ),
     '미팅 초대'
   )
 WHERE created_by = 'email-calendar'
   AND topic ~* 'https?://';
