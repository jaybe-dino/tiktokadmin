-- 소개자료 발송 — 설정에서 관리하는 소개 문자(SMS)·이메일 내용. 브랜드360에서 클릭 발송.
--   welcome_config 와 동일 패턴(단일 행 id=1). {브랜드명}{담당자명} 치환.
CREATE TABLE IF NOT EXISTS intro_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  send_sms boolean NOT NULL DEFAULT true,
  send_email boolean NOT NULL DEFAULT true,
  sms_template text NOT NULL DEFAULT '[GloveK] {브랜드명}님, 요청하신 소개자료 보내드립니다. 자세한 내용은 이메일을 확인해 주세요. 문의는 회신 주세요.',
  email_subject text NOT NULL DEFAULT '[GloveK] {브랜드명}님께 — 회사·서비스 소개자료',
  email_body text NOT NULL DEFAULT '{브랜드명} 담당자님, 안녕하세요. GloveK입니다.\n\n요청 주신 회사·서비스 소개자료를 보내드립니다.\n틱톡샵 해외진출(멀티몰·온보딩) 관련 진행 방식과 성과 사례를 담았습니다.\n\n[소개자료 링크]\n\n검토 후 궁금한 점은 본 메일에 회신해 주세요. 미팅도 편히 요청 주세요.\n\n감사합니다.\nGloveK 드림',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO intro_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
