-- 마케팅 제안서 고도화 — 제안 예정일·최종 제안 일정·RFP·AI 제안방향.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS propose_date date;      -- 제안 예정일
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS final_due_date date;    -- 최종 제안 예정 일정
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS rfp_text text;          -- 사전 RFP(설문 요약 또는 직접 입력)
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS rfp_file_url text;      -- RFP 업로드 링크
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS ai_direction text;      -- AI 제안 방향(예산·RFP·우리 서비스 기반)

-- 마케팅 제안 AI 참고용 '우리 서비스 소개' — 계속 업데이트(설정에서 관리). 단일 행.
CREATE TABLE IF NOT EXISTS mkt_services_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  services_md text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mkt_services_config (id, services_md) VALUES (1,
  '# GloveK 마케팅 서비스\n- 틱톡샵 해외진출(멀티몰·온보딩) 운영대행\n- 크리에이터 시딩·라이브 커머스 기획/운영\n- 퍼포먼스 광고(틱톡·메타) 세팅·운영\n- 콘텐츠 제작(숏폼·상세페이지 현지화)\n- 데이터 리포트·정산 관리\n대상 국가: 미국·일본·동남아(태국/베트남/필리핀/말레이시아/싱가포르) 등'
) ON CONFLICT (id) DO NOTHING;
