-- ═════════════════════════════════════════════════════════════
-- 82 · SLA 초과 Slack 알림 도입 — 기존 활성 위반 알림 flood 방지
--   신규 기능: SLA 초과 시 단계별 채널에 담당자 @태그 포스트(미발송분만 1회).
--   배포 직후 첫 cron 이 기존 누적 위반을 한꺼번에 쏘지 않도록, 이미 활성인
--   sla_breach 알림은 '발송됨'으로 표시(sentinel). 이후 신규·재발 위반만 알림.
-- ═════════════════════════════════════════════════════════════
UPDATE alerts
   SET slack_ts = 'suppressed-initial'
 WHERE kind = 'sla_breach' AND resolved_at IS NULL AND slack_ts IS NULL;
