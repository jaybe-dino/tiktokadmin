-- ═════════════════════════════════════════════════════════════
-- 10 · 브랜드 포털 — Phase 6 (문서 16)
--   매직링크 인증 + brand_id 강제 격리(lib/portal-db.ts).
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portal_sessions (
  token text PRIMARY KEY,
  contact_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_sessions_brand_idx ON portal_sessions (brand_id);

CREATE TABLE IF NOT EXISTS portal_invites (
  token text PRIMARY KEY,
  contact_id uuid NOT NULL,
  email text NOT NULL,
  used_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
