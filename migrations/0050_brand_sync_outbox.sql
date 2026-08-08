-- ═════════════════════════════════════════════════════════════
-- 50 · brands → glovek 양방향 동기화용 아웃박스(변경 큐).
--   공유 필드(브랜드명·담당자명·연락처·사업자번호·카테고리·URL)가 실제로 바뀐 행만
--   큐에 적재 → 크론 플러시가 glovek brand-upsert API 로 push(변경분만).
--   편집 경로가 여러 곳에 흩어져 있어 개별 훅 대신 트리거로 일괄 포착한다.
--   ⚠️ echo 방지: 값이 그대로면 트리거가 적재하지 않고(아래 IS DISTINCT),
--      플러시는 HTTP 응답 후 행을 삭제하며, glovek 측은 updated_at 기준 last-write-wins
--      로 동일/과거 값을 no-op 처리 → 무한 루프가 생기지 않는다.
-- ═════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS brand_sync_outbox (
  brand_id   uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  queued_at  timestamptz NOT NULL DEFAULT now(),
  attempts   int         NOT NULL DEFAULT 0,
  last_error text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS brand_sync_outbox_queued_idx ON brand_sync_outbox (queued_at);

CREATE OR REPLACE FUNCTION enqueue_brand_sync() RETURNS trigger AS $$
BEGIN
  -- ⚠️ glovek 에서 받은(=glovek 출처) 브랜드에만 동기화 적용. admin 자체 리드/CSV/
  --    마케팅 직접등록 브랜드는 glovek 에 없으므로 push 대상에서 제외한다(중요).
  --    출처 판별: glovek 안정 PK(glovek_user_id) 보유 또는 source 가 'glovek%'.
  IF NOT (
    (NEW.glovek_user_id IS NOT NULL AND NEW.glovek_user_id <> '')
    OR NEW.source LIKE 'glovek%'
  ) THEN
    RETURN NULL;
  END IF;
  -- 공유(양방향) 필드가 실제로 달라졌을 때만 적재.
  IF NEW.brand_name   IS DISTINCT FROM OLD.brand_name
  OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
  OR NEW.email        IS DISTINCT FROM OLD.email
  OR NEW.phone        IS DISTINCT FROM OLD.phone
  OR NEW.biz_no       IS DISTINCT FROM OLD.biz_no
  OR NEW.category     IS DISTINCT FROM OLD.category
  OR NEW.brand_url    IS DISTINCT FROM OLD.brand_url THEN
    INSERT INTO brand_sync_outbox (brand_id) VALUES (NEW.id)
      ON CONFLICT (brand_id) DO UPDATE SET queued_at = now(), attempts = 0, last_error = '';
  END IF;
  RETURN NULL; -- AFTER 트리거
END; $$ LANGUAGE plpgsql;

-- UPDATE 전용. 신규 INSERT 는 적재하지 않는다:
--   · glovek 출처 신규 = 방금 glovek 에서 받은 것이라 되돌려 push 할 필요 없음
--   · admin 자체 신규 = glovek 대상 아님
--   admin 이 glovek 출처 브랜드의 공유 필드를 "수정"할 때만 되돌려 보낸다.
DROP TRIGGER IF EXISTS brands_enqueue_sync ON brands;
CREATE TRIGGER brands_enqueue_sync AFTER UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION enqueue_brand_sync();
