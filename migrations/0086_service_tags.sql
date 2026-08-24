-- 영업 파이프라인 '운영 중' 서비스 트랙 태그 — 운영대행/마케팅대행(선택, 필수 아님).
--   온보딩 신청서가 맵핑되면 tag_ops_agency, 마케팅 제안서가 맵핑되면 tag_mkt_agency 자동 활성화(수동 토글도 가능).
ALTER TABLE brands ADD COLUMN IF NOT EXISTS tag_ops_agency boolean NOT NULL DEFAULT false;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS tag_mkt_agency boolean NOT NULL DEFAULT false;
