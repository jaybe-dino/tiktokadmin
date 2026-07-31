# 14 · 고객카드 완결 — 갭 4종 보강 (설문·브랜드측 인물·재고입고·물류계약) + QnA 지식화

> Claude Code 지시: 아래 스키마를 migrations/003으로 추가하고, 브랜드 360에 해당 탭/섹션을 구현해줘. 10(데이터)·M2(온보딩)·M6(인증)과 연결.

## A. 미팅 후 마케팅 설문 (신규)

목적: 1:1 미팅 직후 브랜드에 설문을 자동 발송해 마케팅 의사·조건(예산·시딩 여력·목표국·일정)을 구조화 수집 → 영업 판단·제안서(M4) 입력값으로.

```sql
CREATE TABLE surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'post_meeting',      -- post_meeting|onboarding_intake|nps
  token text UNIQUE NOT NULL,                     -- 공개 응답 링크용
  sent_at timestamptz, responded_at timestamptz,
  answers jsonb DEFAULT '{}',                     -- {budget_band, seeding_capacity, target_countries[], timeline, concerns, marketing_consent}
  created_at timestamptz DEFAULT now()
);
```
- **플로우**: 미팅 완료(08 회의록 생성) → 팔로업 메일에 설문 링크 자동 포함(별도 메일 아님 — 응답률) → 공개 응답 페이지 `/s/{token}`(로그인 불필요, 모바일) → 응답 시 brands 반영(countries·plan_hint) + 담당 Slack "설문 도착" + 브리프 갱신.
- 미응답 3일 → 리마인더 1회(email_drafts). 문항은 settings에서 편집(초기 6문항: 월 마케팅 예산대 / 월 시딩 가능 수량 / 목표 국가 / 희망 시작 시기 / 우려사항 / 정기 마케팅 수신 동의).
- 게이트 연동(소프트): contact→contract_review 시 설문 응답 있으면 카드에 표시(하드 차단은 안 함).

## B. 브랜드측 담당자 인물 관리 (신규 — 실데이터 근거: 복수 담당 다수)

```sql
CREATE TABLE brand_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL, title text DEFAULT '',      -- 직책(대표/MD/마케팅…)
  email text, phone text,
  role text DEFAULT 'main' CHECK (role IN ('main','marketing','logistics','settlement','etc')),
  is_primary boolean DEFAULT false,
  note text DEFAULT '', created_at timestamptz DEFAULT now()
);
```
- 360 "연락처" 섹션: 인물 카드 목록(+추가). is_primary가 brands.contact_name/email/phone과 동기.
- **dedup 연동**: brand_contacts.email/phone도 매칭 키에 포함(별칭처럼). backfill 시 노션 콤마 복수 이메일·전화를 인물로 분해.
- 메일 수집(09)·리마인더 발송 대상 선택이 이 테이블 기준(정산 안내는 settlement 담당에게).

## C. 재고 초기 투입·입고 (신규)

목적: 온보딩 시 국가별 초기 물량 투입 현황 — "언제 몇 개 어느 창고로 보냈고 도착했나".

```sql
CREATE TABLE inventory_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products_master(id),
  country text NOT NULL,
  warehouse_id uuid,                              -- D. logistics_contracts 참조
  qty int NOT NULL, unit_cost int,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','shipped','arrived','stocked','issue')),
  tracking_no text DEFAULT '', shipped_at date, arrived_at date,
  note text DEFAULT '', created_at timestamptz DEFAULT now()
);
```
- 360 "재고" 탭: 국가×제품 초기 투입 표(상태 색상). setup→live 게이트에 소프트 조건(초기 재고 stocked ≥1) 추가 옵션.
- 지연 감시: shipped 후 14일 미도착 → 온보딩 채널 알림. (판매 후 실시간 재고는 v2 — 틱톡샵 데이터 연동 시)

## D. 물류 계약 현황 (신규 — apply warehouses 실구조 재사용)

```sql
CREATE TABLE logistics_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  country text NOT NULL,                          -- US|VN|TH|MY|SG (+CN/HK/KR: apply 창고 실값)
  provider text DEFAULT '',                       -- 3PL명/FBA 등
  warehouse_region text DEFAULT '', contact text DEFAULT '', phone text DEFAULT '',
  address text DEFAULT '',
  status text NOT NULL DEFAULT 'none'
    CHECK (status IN ('none','negotiating','contracted','active','expired')),
  contract_asset_id uuid,                         -- 계약서 파일(assets, apply 파일 참조 가능)
  start_date date, end_date date,
  apply_warehouse_id int,                         -- apply tiktok_shop_warehouses 원본 연결
  note text DEFAULT '', created_at timestamptz DEFAULT now()
);
```
- 360 "물류" 섹션: 국가별 계약 상태 뱃지. docs→setup 게이트의 물류 항목이 이 테이블 status='contracted'+ 로 판정(기존 doc_items logistics 항목과 동기).
- apply ingest(doc_progress)에 warehouse 요약 포함 → 자동 생성. 만료 end_date-30일 알림(M6 인증과 동일 패턴).

## E. QnA 지식화 (09 확장)

```sql
CREATE TABLE qna_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL, answer text NOT NULL,
  category text DEFAULT '',                        -- 인증/물류/정산/플랜/운영
  source_brand_id uuid, source_ref text,           -- 어느 메일/문의에서 발췌
  usage_count int DEFAULT 0, approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```
- 플로우: 고객 메일 질문(09 수집) → AI 답장 초안 시 qna_entries 유사 항목 검색·재사용(usage_count++) → 새 질문이면 답변 승인 시 "QnA로 저장" 원클릭 → **반복 질문이 자산화**.
- **미팅 경유 유입 (v3 보강)**: 08 회의록의 "우려/반대 포인트"에서 질문을 추출해 동일 사이클을 탄다 — 매칭되면 팔로업 메일에 답변 자동 포함, 새 질문이면 approved=false 후보 등록 + 초안에 [답변 필요] 플레이스홀더(미기입 시 발송 승인 불가). 즉 QnA의 소스는 메일(09)+미팅(08) 두 갈래.
- 월 1회: usage 상위 QnA → 브랜드 포털 FAQ·온보딩 안내문에 자동 반영 제안.

## F. 계약 내용(온보딩·마케팅) 입력 — 신규 아님, 우선 구현 지시
- 문서 10 contracts 그대로. **v0.3에서 M3 화면(계약 등록 폼: kind·기간·terms 빌더·파일 업로드)을 A~E와 함께 구현** — 기존 계약 16건 입력이 첫 작업.

## G. 360 최종 탭 구성 (통합 후)
`개요(카드) · 연락처(B) · 설문(A) · 서류/온보딩 · 제품·인증(M5/M6) · 재고(C) · 물류(D) · 계약(F) · 결제/정산 · 메일/미팅 · 타임라인`

## H. 완료 기준
- [ ] 미팅 완료 → 팔로업 메일에 설문 링크 자동 포함 → 응답이 brands·브리프에 반영
- [ ] 복수 담당 인물이 카드에 표시되고 dedup 키로 동작(노션 콤마 데이터 분해 적재)
- [ ] 국가×제품 초기 재고 표 + 14일 미도착 알림
- [ ] 물류 계약 상태가 docs→setup 게이트 판정에 반영
- [ ] 반복 질문 답장에 QnA 재사용·저장 사이클 동작
