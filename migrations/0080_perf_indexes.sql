-- ═════════════════════════════════════════════════════════════
-- 80 · 성능 인덱스 보강 — 브랜드 원장 목록 기본 정렬/필터 경로
--   (기존 33개 인덱스 위에 목록 쿼리 hot path 만 추가. 모두 IF NOT EXISTS)
-- ═════════════════════════════════════════════════════════════

-- 브랜드 원장 기본 정렬(최근 업데이트순) + 리드 추가순.
CREATE INDEX IF NOT EXISTS brands_updated_at_idx ON brands (updated_at DESC);
CREATE INDEX IF NOT EXISTS brands_created_at_idx ON brands (created_at DESC);

-- 상태 필터 + 업데이트 정렬 복합(가장 흔한 조합).
CREATE INDEX IF NOT EXISTS brands_state_updated_idx ON brands (state, updated_at DESC);

-- 마케팅 제안서 문서(0076) — 목록/브랜드 조회 경로.
CREATE INDEX IF NOT EXISTS mkt_proposal_docs_brand_idx ON mkt_proposal_docs (brand_id);
CREATE INDEX IF NOT EXISTS mkt_proposal_docs_created_idx ON mkt_proposal_docs (created_at DESC);
