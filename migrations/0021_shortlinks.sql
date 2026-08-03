-- ─────────────────────────────────────────────────────────────
-- 21 · 드라이브 첨부 쇼트링크 + 클릭 트래킹 (기획확정 8절 · 첨부 발송)
--   · short_links : 드라이브 링크 → 쇼트코드 매핑 원장 (clicks 누적 카운터)
--   · link_clicks : 클릭 개별 로그(시각·UA) — 클릭율 트래킹용
--   file.glovek.space 도메인은 Vercel 도메인 연결 + SHORTLINK_BASE env 로 커버.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS short_links (
  code        text PRIMARY KEY,
  target_url  text NOT NULL,
  brand_id    uuid,                 -- brands.id (선택 — 브랜드 연결 시 클릭율 집계)
  label       text,
  created_by  text,
  clicks      int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS short_links_brand_idx ON short_links (brand_id);

CREATE TABLE IF NOT EXISTS link_clicks (
  id    bigserial PRIMARY KEY,
  code  text NOT NULL,
  at    timestamptz DEFAULT now(),
  ua    text
);

CREATE INDEX IF NOT EXISTS link_clicks_code_idx ON link_clicks (code, at);
