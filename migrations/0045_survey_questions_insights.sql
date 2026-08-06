-- ═════════════════════════════════════════════════════════════
-- 45 · 설문 문항 뱅크(편집형) + AI 브랜드 인사이트.
--   ① survey_questions — 하드코딩 문항을 DB 로 이관. 어드민이 추가/수정/정렬/비활성 가능.
--      surveys.answers 는 여전히 qkey 로 저장(하위호환). kind='pre_meeting' 는 1:1 미팅 사전 설문.
--   ② survey_insights — 응답을 AI 가 구조화 추출 → 브랜드별 실데이터로 반영(검토·재적용 가능).
-- ═════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS survey_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'pre_meeting',           -- pre_meeting | post_meeting | (커스텀)
  section text,                                        -- 주제 구획(제품·목표·채널·예산·크리에이터·의사결정·시딩·회사정보)
  qkey text NOT NULL,                                  -- answers jsonb 키(안정)
  label text NOT NULL,
  qtype text NOT NULL DEFAULT 'text'                   -- select|multi|text|short|consent
    CHECK (qtype IN ('select','multi','text','short','consent')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  placeholder text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, qkey)
);
CREATE INDEX IF NOT EXISTS survey_questions_kind_idx ON survey_questions (kind, sort_order);

CREATE TABLE IF NOT EXISTS survey_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  survey_id uuid REFERENCES surveys(id) ON DELETE SET NULL,
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,        -- AI 구조화 추출(카테고리·타겟·예산·인증·경쟁·목표 등)
  summary_md text,                                     -- 사람이 읽는 요약
  applied boolean NOT NULL DEFAULT false,              -- 브랜드 원장에 반영 여부
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_insights_brand_idx ON survey_insights (brand_id, created_at DESC);

-- ── pre_meeting(1:1 미팅 사전) 문항 시딩 — 업로드 설문 자료 A~F + 시딩경험 + 회사정보 ──
INSERT INTO survey_questions (kind, section, qkey, label, qtype, options, placeholder, sort_order)
SELECT 'pre_meeting', x.section, x.qkey, x.label, x.qtype, x.options, x.placeholder, x.ord
FROM jsonb_to_recordset('[
  {"section":"제품·브랜드","qkey":"a1_core_product","label":"A1. 주력 제품과 가장 내세우고 싶은 핵심 효능","qtype":"text","options":[],"placeholder":null,"ord":10},
  {"section":"제품·브랜드","qkey":"a2_product_link","label":"A2. 대표 상품 링크","qtype":"short","options":[],"placeholder":"https://","ord":11},
  {"section":"제품·브랜드","qkey":"a3_core_concern","label":"A3. 제품이 해결하는 핵심 고민 (한 가지)","qtype":"text","options":[],"placeholder":null,"ord":12},
  {"section":"제품·브랜드","qkey":"a4_certs","label":"A4. 보유 인증·클레임 (비건/더마테스트/임상/FDA·MoCRA 등)","qtype":"text","options":[],"placeholder":null,"ord":13},
  {"section":"제품·브랜드","qkey":"a5_differentiator","label":"A5. 경쟁 브랜드 대비 차별점","qtype":"text","options":[],"placeholder":null,"ord":14},
  {"section":"제품·브랜드","qkey":"a6_reviews","label":"A6. 고객들이 가장 많이 하는 반응·후기","qtype":"text","options":[],"placeholder":null,"ord":15},
  {"section":"목표·타겟","qkey":"b7_target_customer","label":"B7. 주요 타겟 고객 (연령/고민/라이프스타일)","qtype":"text","options":[],"placeholder":null,"ord":20},
  {"section":"목표·타겟","qkey":"b8_target_markets","label":"B8. 우선 진출·집중 시장(국가)과 우선순위","qtype":"text","options":[],"placeholder":"예: 미국 우선, 이후 동남아","ord":21},
  {"section":"목표·타겟","qkey":"b9_role_model","label":"B9. 롤모델 브랜드와 이유","qtype":"text","options":[],"placeholder":null,"ord":22},
  {"section":"목표·타겟","qkey":"b10_desired_state","label":"B10. 6개월~1년 후 원하는 브랜드 상태","qtype":"text","options":[],"placeholder":null,"ord":23},
  {"section":"현재 채널·운영","qkey":"c11_marketing_history","label":"C11. 지금까지 진행한 마케팅 활동 (채널·방식)","qtype":"text","options":[],"placeholder":null,"ord":30},
  {"section":"현재 채널·운영","qkey":"c12_tiktok_account","label":"C12. TikTok 브랜드 계정 운영 여부·콘텐츠 유형","qtype":"text","options":[],"placeholder":null,"ord":31},
  {"section":"현재 채널·운영","qkey":"c13_channels_revenue","label":"C13. 현재 판매 채널·온보딩·운영 상태와 대략적인 매출","qtype":"text","options":[],"placeholder":null,"ord":32},
  {"section":"현재 채널·운영","qkey":"c14_offline_collab","label":"C14. 팝업·오프라인·협업 등 진행/계획 활동","qtype":"text","options":[],"placeholder":null,"ord":33},
  {"section":"현재 채널·운영","qkey":"c15_launch_plan","label":"C15. 확정된 출시 일정·캠페인 계획","qtype":"text","options":[],"placeholder":null,"ord":34},
  {"section":"예산·물류","qkey":"d16_budget_band","label":"D16. 월/캠페인 단위 투입 가능 예산 규모","qtype":"select","options":["~100만원","100~300만원","300~500만원","500~1000만원","1000만원 이상","미정"],"placeholder":null,"ord":40},
  {"section":"예산·물류","qkey":"d16_budget_detail","label":"D16-2. 예산 관련 부연 설명(있으면)","qtype":"text","options":[],"placeholder":null,"ord":41},
  {"section":"예산·물류","qkey":"d17_budget_alloc","label":"D17. 예산 우선 배분 (시딩/유가광고/커미션/콘텐츠 등)","qtype":"text","options":[],"placeholder":null,"ord":42},
  {"section":"예산·물류","qkey":"d18_seeding_commission","label":"D18. 제공 가능 시딩 물량·커미션 구조","qtype":"text","options":[],"placeholder":null,"ord":43},
  {"section":"예산·물류","qkey":"d19_logistics","label":"D19. 재고·물류 상황과 감당 가능 물량 (미국 입고/FBA 등)","qtype":"text","options":[],"placeholder":null,"ord":44},
  {"section":"예산·물류","qkey":"d20_agency_budget","label":"D20. 에이전시 비용 별도 책정 예산 여부","qtype":"text","options":[],"placeholder":null,"ord":45},
  {"section":"크리에이터 마케팅","qkey":"e21_first_goal","label":"E21. 크리에이터 마케팅으로 먼저 얻고 싶은 것 (인지도/매출/팬덤)","qtype":"text","options":[],"placeholder":null,"ord":50},
  {"section":"크리에이터 마케팅","qkey":"e22_content_control","label":"E22. 콘텐츠 개입 수준 (가이드 제공 vs 자율)","qtype":"text","options":[],"placeholder":null,"ord":51},
  {"section":"크리에이터 마케팅","qkey":"e23_content_guideline","label":"E23. 콘텐츠 가이드라인 (강조/금지 표현·규제 클레임)","qtype":"text","options":[],"placeholder":null,"ord":52},
  {"section":"의사결정·협업","qkey":"f24_decision_maker","label":"F24. 내부 마케팅 의사결정권자·소통 창구","qtype":"text","options":[],"placeholder":null,"ord":60},
  {"section":"의사결정·협업","qkey":"f25_agency_experience","label":"F25. 에이전시/외부 파트너 협업 경험 (좋았던/아쉬웠던 점)","qtype":"text","options":[],"placeholder":null,"ord":61},
  {"section":"틱톡 시딩 경험","qkey":"g1_seeding_done","label":"① 틱톡 콘텐츠 시딩을 진행한 경험이 있으신가요?","qtype":"select","options":["있음","없음"],"placeholder":null,"ord":70},
  {"section":"틱톡 시딩 경험","qkey":"g2_seeding_link","label":"② 시딩 진행했던 제품 링크","qtype":"short","options":[],"placeholder":"https://","ord":71},
  {"section":"틱톡 시딩 경험","qkey":"g3_seeding_count","label":"③ 지금까지 시딩·크리에이터 협업으로 발행된 누적 콘텐츠 건수","qtype":"short","options":[],"placeholder":"예: 약 30건 / 0건","ord":72},
  {"section":"회사정보","qkey":"biz_reg_no","label":"사업자등록번호","qtype":"short","options":[],"placeholder":"000-00-00000","ord":90},
  {"section":"회사정보","qkey":"company_name","label":"회사명(상호)","qtype":"short","options":[],"placeholder":"사업자등록증상 상호","ord":91},
  {"section":"회사정보","qkey":"company_address","label":"회사 주소","qtype":"short","options":[],"placeholder":"사업자등록증상 주소","ord":92},
  {"section":"회사정보","qkey":"contact_phone","label":"담당자 연락처","qtype":"short","options":[],"placeholder":"010-0000-0000","ord":93},
  {"section":"회사정보","qkey":"marketing_consent","label":"정기 마케팅 정보 수신 동의","qtype":"consent","options":[],"placeholder":null,"ord":94}
]'::jsonb) AS x(section text, qkey text, label text, qtype text, options jsonb, placeholder text, ord int)
ON CONFLICT (kind, qkey) DO NOTHING;

-- post_meeting(미팅 후) 기존 문항도 뱅크로 시딩(편집 대상).
INSERT INTO survey_questions (kind, section, qkey, label, qtype, options, placeholder, sort_order)
SELECT 'post_meeting', '미팅 후', x.qkey, x.label, x.qtype, x.options, x.placeholder, x.ord
FROM jsonb_to_recordset('[
  {"qkey":"budget_band","label":"월 마케팅 예산대","qtype":"select","options":["~300만원","300~500만원","500~1000만원","1000만원 이상","미정"],"placeholder":null,"ord":10},
  {"qkey":"seeding_capacity","label":"월 시딩 가능 수량(무상 제공)","qtype":"select","options":["~10개","10~30개","30~50개","50개 이상","미정"],"placeholder":null,"ord":11},
  {"qkey":"target_countries","label":"목표 국가(복수 선택)","qtype":"multi","options":["미국","베트남","태국","싱가포르","필리핀","말레이시아"],"placeholder":null,"ord":12},
  {"qkey":"timeline","label":"희망 시작 시기","qtype":"select","options":["즉시","1개월 내","3개월 내","미정"],"placeholder":null,"ord":13},
  {"qkey":"concerns","label":"우려사항·질문","qtype":"text","options":[],"placeholder":null,"ord":14},
  {"qkey":"marketing_consent","label":"정기 마케팅 정보 수신 동의","qtype":"consent","options":[],"placeholder":null,"ord":15}
]'::jsonb) AS x(qkey text, label text, qtype text, options jsonb, placeholder text, ord int)
ON CONFLICT (kind, qkey) DO NOTHING;
