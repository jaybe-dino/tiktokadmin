-- ═════════════════════════════════════════════════════════════
-- 49 · brands.updated_at 를 "실제 변경 시에만" 갱신.
--   기존 set_updated_at() 트리거는 모든 UPDATE 에서 updated_at=now() 로 덮어써서,
--   glovek 동기화(동일 값 재기록)마다 전 브랜드의 updated_at 이 동기화 시각으로 평탄화됐다.
--   → 원장 "최근 업데이트순" 이 항상 같은 순서(동기화 순)로 보이는 원인.
--   내용이 실제로 바뀐 행만 갱신하도록 교정. (brands 전용 함수 — 다른 테이블 미사용)
-- ═════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  -- 앱은 updated_at 을 대개 직접 쓰지 않으므로, 데이터가 그대로면 NEW=OLD → 갱신 생략.
  -- 명시적으로 updated_at=now() 를 쓴 경우엔 NEW≠OLD 가 되어 정상 갱신된다.
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
