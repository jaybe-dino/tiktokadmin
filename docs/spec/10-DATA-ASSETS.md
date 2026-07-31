# 10 · 데이터·자산 구조 — 고객카드 · 제품·인증 · 제안 · 계약 · 파일

> Claude Code 지시: 어드민 앱에 아래 데이터 구조와 화면을 구현해줘. 원칙: **원본이 이미 있는 데이터(apply 서류·glovek 파일)는 복제하지 않고 참조**, 어드민이 만드는 것(제안·계약·인증 메타)만 어드민이 소유한다.

---

## A. 고객 카드 (Customer Card) — 퍼널 단계별 데이터 세트

brands가 원장이지만, 담당자가 보는 "카드"는 단계마다 필요한 정보가 다르다. **카드 = brands + 연결 테이블들의 단계별 프로젝션.**

| 퍼널 단계 | 카드에 보이는 섹션 | 필수 데이터(게이트 연동) |
|---|---|---|
| 유입 (lead~meeting) | 연락처·유입경로·카테고리·채널URL·사전분석 브리프·등급 | 담당자명, 이메일/전화, 유입경로 |
| 영업 (contact~contract) | + 제안 이력(버전·금액)·논의 플랜/국가·미팅 회의록·메일 스레드 | 계약형태, 플랜, **제안서 발송 기록(proposals)** |
| 온보딩 (docs~setup) | + 회사정보(법인 국/영·대표·주소)·서류 체크리스트·**제품 목록+국가별 인증 현황**·계약서 | biz_no, 서류 100%, **계약서 signed** |
| 운영 (live_*) | + 운영 사이클 진행률·시딩/라이브 이력·성과(GMV·T레벨)·인증 만료 경고 | 광고담당, 마케팅 사이클 |
| 정산 (settling) | + 결제·정산 명세·계약 조건(수수료율·약정) | 결제상태, 계약 terms |

- 구현: `/brand/[id]`(04의 360)를 이 표대로 재구성 — 현재 단계 섹션이 상단, 나머지는 접힘.
- **회사 정보**: apply `tiktok_shop_applications`(SC-01)가 원본 → 어드민엔 요약 캐시 테이블 `brand_company`(아래) + 원본 딥링크.

```sql
CREATE TABLE brand_company (           -- 회사 요약 캐시 (원본: apply SC-01 / 수기)
  brand_id uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  company_name_kr text, company_name_en text,
  company_type text,                   -- company|individual
  rep_name text, reg_date text,
  biz_category text,                   -- 업태·종목
  address_kr text, address_en text,
  biz_cert_asset_id uuid,              -- 사업자등록증 파일(assets 참조) — doc_items와 동기
  biz_verified boolean DEFAULT false,  -- 사업자번호 진위확인
  -- 세금계산서 (v3 보강 — 360 "회사정보" 탭)
  tax_email text, tax_contact_name text, tax_contact_phone text,
  tax_cycle text DEFAULT 'monthly',    -- monthly(월말 일괄)|per_case(건별)
  tax_note text,
  -- 정산 계좌 (지급 전 예금주=상호 일치 검증 — 불일치 시 정산 확정 차단)
  bank_name text, bank_holder text, bank_account text,
  bank_cert_asset_id uuid,             -- 통장 사본(assets 참조)
  bank_verified boolean DEFAULT false,
  -- 브랜드 정보
  brand_name_en text, logo_asset_id uuid,
  channel_urls jsonb DEFAULT '{}',     -- {own_mall, smartstore, instagram, tiktok, ...}
  source text DEFAULT 'manual',        -- apply|manual (수기 보정 시 변경 이력은 stage_history 계열 audit)
  source_url text, updated_at timestamptz DEFAULT now()
);
-- 화면: 브랜드 360 "회사정보" 탭 — 사업자 정보 · 세금계산서 · 정산 계좌 · 브랜드 정보(채널·별칭·자산) 4블록.
-- 이 값이 카드 헤더·제안서·계약서·정산(세금계산서 발행·지급)의 단일 원천이다.
```

---

## B. 제품 마스터 + 국가별 인증 (운영·리스크의 핵심)

브랜드당 제품 5~10개 × 5개국 인증 = 200브랜드면 **수천 개의 인증 상태**. 만료·미비를 시스템이 감시해야 판매 중단 사고를 막는다.

```sql
CREATE TABLE products_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name_kr text NOT NULL, name_en text DEFAULT '',
  category text DEFAULT '', sku text DEFAULT '',
  price_band text DEFAULT '',                 -- 대표 가격대
  main_image_url text DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','discontinued')),
  source text NOT NULL DEFAULT 'manual',      -- apply_step4|glovek_onb|manual
  source_ref text,                            -- apply products.id 등
  created_at timestamptz DEFAULT now()
);

CREATE TABLE product_certs (                  -- 제품 × 국가 인증
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
  country text NOT NULL,                      -- US|VN|TH|MY|SG
  cert_type text NOT NULL,                    -- FDA등록|보건부신고|태국FDA|할랄|HSA|영문라벨|원산지증명|기타
  status text NOT NULL DEFAULT 'none'
    CHECK (status IN ('none','preparing','submitted','ready','rejected','expired')),
  cert_number text DEFAULT '',
  issued_at date, expires_at date,
  asset_id uuid,                              -- assets 참조(인증서 파일)
  note text DEFAULT '', updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, country, cert_type)
);
```

- **원본 동기화**: apply Step4(products/product_countries의 cert_status·cert_file) → ingest에 `product_sync` 이벤트 추가(07 apply 프롬프트에 1지점 추가: step4 저장 시 제품·국가별 인증 요약 전송). glovek 온보딩 자가진단의 국가 인증 응답(missing_certs)도 초기값으로 반영.
- **자동 감시(cron)**: `expires_at - 30일` → 담당+브랜드 리마인더 / `status IN (none,rejected)`인 채 해당 국가 `운영중` → ⚠️ **판매 리스크 알림**(운영 채널). 사전분석·등급 재계산에도 반영.
- 화면: 브랜드 360 "제품·인증" 탭 = 제품×국가 매트릭스(상태 색상), 만료 임박 목록은 /monitor에.

---

## C. 제안·견적 (Proposals) — 영업 게이트의 실체

```sql
CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  plan text NOT NULL,                         -- live_focus_490k|guarantee_1m|onboarding_onetime
  countries text[] DEFAULT '{}',
  term text DEFAULT 'monthly',                -- monthly|6month
  quote_amount int NOT NULL,                  -- 견적(할인 반영)
  discount_note text DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','rejected','superseded')),
  sent_at timestamptz, decided_at timestamptz,
  asset_id uuid,                              -- 제안서 PDF 파일
  note text DEFAULT '', created_by text, created_at timestamptz DEFAULT now()
);
```
- **견적 생성기**: glovek `computeQuote` 로직(트랙료×국가수, 2국10%/3~4국15%/5국20%, 6개월 약정 20%)을 어드민에 이식 — 국가·약정 선택 시 금액 자동 산출 → 제안서 초안(AI가 브리프·회의록 기반 커스텀 문구) → PDF 생성 → assets 저장 → 발송(email_drafts 경유) 시 status=sent.
- 게이트 연동: `contact→contract_*`의 "제안서 발송 기록" = `proposals.status='sent'` 존재로 판정(03 게이트 규칙 업데이트).
- accepted 시 plan·countries가 brands에 자동 반영.

---

## D. 계약서 (Contracts) — 조건이 정산·보장을 결정

```sql
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mall','onboarding','guarantee')),
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','sent','signed','expired','terminated')),
  start_date date, end_date date, signed_at timestamptz,
  terms jsonb NOT NULL DEFAULT '{}',          -- {fee_pct:10, term_months:6, guarantee:{...조건5}, countries:[...]}
  asset_id uuid,                              -- 계약서 파일(서명본)
  esign_ref text DEFAULT '',                  -- 전자서명 서비스 참조(모두싸인 등, 추후)
  note text DEFAULT '', created_at timestamptz DEFAULT now()
);
```
- **terms(jsonb)가 핵심**: 수수료율·약정개월·Guarantee 보장조건(6개월 5조건)·국가 — 정산 런(15 §4)과 Guarantee 보장 트래킹(15 §2 cycle-watch)이 이 값을 읽는다. 계약서 파일만 있고 조건이 구조화 안 되면 정산 자동화 불가.
- 게이트 연동: `docs` 진입(계약완료) 조건에 `contracts.status='signed'` 추가 옵션(사업 결정: 결제 선행 vs 계약 선행 — 기본은 결제 확인, 계약 signed는 docs→setup 전 필수로 권장).
- 자동 감시: `end_date - 30일` 갱신 알림(영업+정산), terminated 시 사이클 중단·정산 마감 연쇄.

---

## E. 통합 자산 저장소 (Assets) — "모든 자료"의 단일 색인

```sql
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL,        -- proposal|contract|cert|doc|report|meeting_rec|brand_intro|etc
  filename text NOT NULL, mime text, size_bytes bigint,
  storage_url text,          -- 어드민 스토리지(Blob/S3) — 어드민 생성물만
  external_url text,         -- 원본이 apply/glovek/드라이브에 있으면 링크만(복제 금지)
  source text NOT NULL DEFAULT 'admin',   -- admin|apply|glovek|zoom|drive
  source_ref text, uploaded_by text,
  retention_until date,      -- 보존 정책
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON assets (brand_id, kind);
```
- 원칙: **어드민이 생성한 것(제안 PDF·계약서·리포트·회의록)만 storage_url에 실물 저장.** apply 서류(사업자등록증·UBO 등)와 glovek 업로드는 `external_url` 참조만 — 민감서류 이중 보관 금지(보안·용량).
- 브랜드 360 "자료" 탭 = 이 테이블의 kind별 그룹 뷰. 검색(파일명·kind·기간).
- 접근권한: kind별(cert·doc은 온보딩+파트장, contract는 영업·정산·exec). 보존기간 cron 파기.

---

## F. 연결 요약 (기존 문서와의 접점)
| 이 문서 | 연결 |
|---|---|
| proposals.status='sent' | 03 게이트 `contact→contract_*` 판정 교체 |
| contracts.terms.fee_pct | (15) 정산 런 수수료 계산 원천 |
| product_certs 만료·미비 | SLA cron에 `cert_risk` 알림 kind 추가 |
| product_sync 이벤트 | 02 ingest 카탈로그 + 07 apply 프롬프트에 1지점 추가 |
| assets | 08 회의록·요약, 09 이메일 첨부 메타, 리포트 산출물의 공통 색인 |

## G. MCP 툴 추가 (06 확장)
```ts
get_customer_card({brand_id, stage?})        → 단계별 카드 프로젝션(A표 기준)
list_products({brand_id}) / upsert_product / upsert_cert
find_cert_risks({days_ahead=30})             → 만료 임박·미비 인증 목록
create_proposal({brand_id, plan, countries, term}) → computeQuote 견적+초안 생성
register_contract({brand_id, kind, terms, asset_id})
list_assets({brand_id, kind?})
```

## H. 완료 기준
- [ ] 브랜드 360이 단계별 카드 구성(A표)으로 렌더, 필수 데이터 미비 시 게이트와 동일 표시
- [ ] 제품×국가 인증 매트릭스 + 만료 30일 전 알림 + 운영중 미비 인증 리스크 알림
- [ ] 견적 생성기 금액이 glovek computeQuote와 동일(테스트 5케이스)
- [ ] 제안 sent → 게이트 통과 판정 연동, accepted → brands 반영
- [ ] 계약 terms(jsonb)에서 수수료율을 읽어 정산 계산에 사용 가능(스텁)
- [ ] assets에서 apply 민감서류가 복제되지 않고 링크 참조만 됨

---
## I. v3 추가 — 마케팅 프로젝트 제안 관리 + 제품별 인증 서류 (자료 단위)

### I-1. 마케팅 프로젝트 (브랜드사 ↔ 프로젝트 제안 맵핑)
> 온보딩·운영 계약이 없어도 **마케팅 단독 계약**이 가능하다. 따라서 ① 마케팅 화면에서 브랜드사를 직접 추가할 수 있어야 하고(원장 dedup 그대로 경유 — 별도 원장 금지), ② 한 브랜드에 프로젝트 제안 여러 건이 매핑된다.

```sql
CREATE TABLE mkt_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title text NOT NULL,                       -- 예: "US 라이브커머스 시즌2"
  rfp_asset_id uuid REFERENCES assets(id),   -- RFP 파일(없으면 인바운드)
  rfp_summary text,                          -- RFP 요약(AI 생성 가능)
  proposal_asset_id uuid REFERENCES assets(id),  -- 제안서 문서(버전은 assets 버전 규칙)
  proposal_status text NOT NULL DEFAULT 'draft'
    CHECK (proposal_status IN ('draft','sent','negotiating','won','dropped')),  -- 제안 현황
  contract_id uuid REFERENCES contracts(id), -- 수주 시 계약 연결(계약 현황은 contracts.status)
  owner_admin_id uuid, note text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON mkt_projects(brand_id);
```
- **화면 구조**: 좌측 = 계약된 브랜드사 목록(검색) + [브랜드사 추가(마케팅)] / 우측 = 선택 브랜드의 프로젝트 목록 — 각 행: RFP · 제안 내용 · 제안 현황 · 계약 현황.
- **마케팅발 브랜드 추가**: 등록 폼 → dedup(이메일→전화→사업자→브랜드명) → 기존 행 있으면 연결, 없으면 생성(source='mkt_direct'). contracts.kind에 'marketing' 추가 — 온보딩 계약 없이 marketing 계약만 있는 브랜드는 카드에 "마케팅 단독" 뱃지.
- **상태 연동**: proposal_status='won' + contracts(kind=marketing, signed) → 브랜드 state가 lead측이면 contract_done 전진 후보(게이트 동일 적용). 드랍 사유는 자가학습 입력.
- MCP 툴: list_mkt_projects({brand_id?, status?}) · upsert_mkt_project · link_project_contract.

### I-2. 제품별 인증 서류 — 자료 단위 관리 (B 확장)
> B의 product_certs는 "국가×제품 인증 상태"의 요약이다. 실무는 그 아래 **자료(서류) 단위** — FDA 시설등록증·시험성적서·성분표·라벨 시안·할랄 등 — 로 움직이므로 서류 테이블을 분리한다.

```sql
CREATE TABLE product_cert_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
  country text,                              -- NULL=공통 자료
  doc_type text NOT NULL,                    -- fda_facility|fda_listing|test_report|ingredients|label_draft|halal|origin|기타
  title text NOT NULL, asset_id uuid REFERENCES assets(id),   -- 파일은 assets 참조(민감서류 링크 규칙 동일)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','review','valid','rejected','expired')),
  expires_at date, owner_admin_id uuid, note text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON product_cert_docs(product_id, country);
```
- **화면**: 제품·인증 메뉴에서 브랜드 검색(계약된 업체 중심 필터) → 제품 선택 → 자료별 표(자료·국가·상태·파일·만료·담당) + 업로드. product_certs 요약 상태는 이 서류들의 롤업(전부 valid → 완료).
- 만료·경보는 서류 단위로 발화(만료 30일 전) — B의 매트릭스 경보와 동일 사다리.
- 인증 AI 가이드(요건 체크리스트)가 생성하는 "필요 서류 목록"이 이 테이블의 기대 행이 된다 — 미비 자료가 곧 할 일.

### I-3. 마케팅 프로젝트 2종 구분 (v3 보강)
- `mkt_projects.kind` 추가: `'project'`(개별 프로젝트 — RFP→제안→수주→진행→완료 파이프라인 보드) | `'routine'`(루틴 운영대행 — 계약 기간 내 회차 캠페인 반복).
- **개별 프로젝트 보드 컬럼**: RFP·인입 → 제안 작성 → 발송·협의 → 수주·계약 → 진행·납품 → 완료/드랍. 게이트: 수주→진행은 contracts(kind=marketing, signed) 필수 · 제안 마감일은 워크큐 등록 · 발송 후 무응답 5일 리마인더.
- **루틴 운영대행**: contracts.kind='marketing_retainer'(월 정산) + 회차는 ops_cycles 재사용(15 문서). 캠페인 = work_items 확장 — `campaign_type`: `affiliate_seeding`(어필리에이트 시딩: 크리에이터 n명·커미션·회수 콘텐츠·GMV) | `live_commerce`(라이브커머스: 일정·호스트·리허설 체크리스트·목표 GMV) | `content_remake`(Remake Studio 소재).
- **회차 사이클(지속관리)**: 회차 시작 시 계약 범위대로 캠페인 자동 개설 → 기간 내 마감(D-3 지연 알림) → 종료 시 AI 결과 리포트 초안(GMV·전월 비교) → 승인 → 브랜드 발송·포털 게시 → **다음 회차 자동 개설**(전 회차 학습: 성과 상위 크리에이터 재섭외 제안).
