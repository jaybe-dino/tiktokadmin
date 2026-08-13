-- MCP 오퍼레이터 커넥터 — 사용자별 접속 토큰(해시 저장). 대표/파트장(exec·lead)만 발급.
--   /api/mcp 엔드포인트가 Authorization: Bearer <token> 또는 ?token= 로 검증한다.
--   토큰 평문은 저장하지 않음(scrypt 해시). 힌트(끝 4자리)만 표시용으로 보관.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mcp_token_hash   text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mcp_token_hint   text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mcp_token_set_at timestamptz;
