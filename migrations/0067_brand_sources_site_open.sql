-- brand_sources.site CHECK 제거 — 앱이 실제로 쓰는 자유형 소스 라벨과 정합.
--   0001 의 CHECK(site IN ('glovek','apply','tpartners','manual'))는 실제 사용값
--   ('admin','gmail','zoom','ics','reminder','funnel','portal','project','followup','drop',
--    'offboard','churn','running' …)을 막아, 대부분의 타임라인 기록이 조용히 실패해 왔다.
--   (타임라인 직접 기록은 재던져 서버 예외로 표출.) 소스 라벨은 자유값이므로 CHECK 제거가 정합적.
ALTER TABLE brand_sources DROP CONSTRAINT IF EXISTS brand_sources_site_check;
