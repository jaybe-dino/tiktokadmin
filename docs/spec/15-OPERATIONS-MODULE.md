# 15 · 운영대행 모듈 — 월간 사이클·시딩·라이브·CS·정산 런 (개발 스펙)

> Claude Code 지시: 200 브랜드 대행 볼륨(월 시딩 ~3,700 · 라이브 ~660 · 리포트 200 · 정산 200)을 소화하는 운영 엔진. 무거운 작업은 큐 워커로 분리(가이드 4순위). glovek 크롤러(creators·videos·brand_stats)를 연료로 재사용.

## 1. 스키마 (migrations/005_operations.sql)

```sql
-- 월간 운영 사이클 (브랜드×월 = 1행)
CREATE TABLE ops_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  month date NOT NULL,                            -- 해당 월 1일
  plan text NOT NULL,                             -- 발행 시점의 brands.plan 스냅샷
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','paused')),
  items_total int DEFAULT 0, items_done int DEFAULT 0,
  report_asset_id uuid,                           -- 월말 리포트 PDF
  closed_at timestamptz, created_at timestamptz DEFAULT now(),
  UNIQUE (brand_id, month)
);

-- 사이클 워크아이템 (플랜별 자동 발행)
CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES ops_cycles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('seeding','live','report','ads','listing','etc')),
  qty_target int NOT NULL DEFAULT 1, qty_done int NOT NULL DEFAULT 0,
  assignee text, due date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','carried_over')),
  note text DEFAULT ''
);

-- 시딩 케이스 (추천→컨택→발송→게시→성과)
CREATE TABLE seedings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES ops_cycles(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  creator_handle text NOT NULL,                   -- glovek creators.handle 참조(논리)
  country text DEFAULT 'US',
  product_id uuid,                                -- products_master
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','contacted','agreed','sent','posted','measured','declined','no_post')),
  fee int DEFAULT 0,                              -- 유가 시딩 단가(0=무가)
  tracking_no text DEFAULT '', sent_at date,
  posted_url text DEFAULT '', posted_at date,
  views bigint, likes int,                        -- 게시 후 성과(크롤러 videos 매칭으로 자동 갱신)
  assignee text, note text DEFAULT '', created_at timestamptz DEFAULT now()
);
CREATE INDEX ON seedings (cycle_id); CREATE INDEX ON seedings (creator_handle);

-- 라이브 편성
CREATE TABLE lives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES ops_cycles(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL, country text DEFAULT 'US',
  host text DEFAULT '', studio text DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','rehearsed','done','canceled')),
  gmv numeric, viewers int, note text DEFAULT ''
);

-- CS 티켓
CREATE TABLE cs_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  channel text NOT NULL,                          -- email|portal|tiktok|phone
  country text DEFAULT '', subject text NOT NULL, body text DEFAULT '',
  priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  sla_due timestamptz,                            -- 생성+24h(urgent 4h)
  assignee text, resolved_at timestamptz, created_at timestamptz DEFAULT now()
);

-- 정산 런
CREATE TABLE settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  month date NOT NULL,
  gmv numeric DEFAULT 0,                          -- 원본: PG/틱톡샵 실데이터(est_gmv는 검증용)
  gmv_source text DEFAULT 'manual',               -- pg|tiktok|manual
  fee_pct numeric NOT NULL DEFAULT 10,            -- contracts.terms.fee_pct에서 로드
  fee_amount int DEFAULT 0, sub_amount int DEFAULT 0, total int DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','invoiced','paid','disputed')),
  anomaly boolean DEFAULT false, anomaly_note text DEFAULT '',
  approved_by text, created_at timestamptz DEFAULT now(),
  UNIQUE (brand_id, month)
);
```

## 2. 월간 사이클 자동화 (cron)

| cron | 주기 | 동작 |
|---|---|---|
| `/api/cron/cycle-open` | 매월 1일 02:00 | 운영중(live_*) 브랜드마다 ops_cycles 생성 + 플랜별 work_items 발행: LF=시딩20·라이브4·리포트1 / Guarantee=시딩30·라이브6·리포트1 / Onboarding=계약 terms 기준. 전월 미완(carried_over) 이월 |
| `/api/cron/cycle-watch` | 매일 | 월중 15일 기준 이행률 50% 미달 → 담당 알림(alerts kind='cycle_behind', 기존 사다리 재사용). Guarantee는 보장조건 게이지 비교 |
| `/api/cron/seeding-track` | 매일 | status='sent' 7일↑ 미게시 → 크리에이터 독촉 초안 / posted_url 무성과 → 크롤러 videos에서 views 자동 매칭 갱신 |
| `/api/cron/cycle-close` | 말일 | 리포트 생성 큐 투입(200부 — 워커) → settlements draft 생성(§4) → 사이클 closed |

## 3. 시딩 파이프라인 (최대 볼륨 — 화면 /seeding)

1. **추천**: `suggest_creators(brand)` — glovek creators에서 카테고리·국가·평균조회수·과거 브랜드 겹침으로 후보 20명 자동(점수 표시). 담당이 체크박스로 채택 → status=suggested.
2. **컨택**: DM/메일 템플릿 초안 자동(브랜드·제품 요약 삽입) → 담당 발송 → agreed/declined.
3. **발송**: 제품·트래킹 입력 → sent. (재고 C(14 문서)와 연동: 시딩 출고 기록)
4. **게시 확인**: 크롤러 videos에 creator_handle+기간 매칭되면 **자동 posted 전환**+URL·views 기입. 7일 미게시 → no_post 위험 알림.
5. **성과**: views 주간 갱신 → 사이클 이행률·월말 리포트 반영. 크리에이터별 이행률 → creators 신뢰 점수(재추천 가중).

## 4. 정산 런 (월초, /pay 확장)

```
cycle-close 후: settlements draft 생성
  gmv     ← (v1) 수기/CSV 업로드(틱톡샵 셀러센터 export) · (v2) API 연동
  검증    ← glovek brand_shop_stats.est_gmv와 ±30% 벗어나면 anomaly=true
  fee     ← contracts.terms.fee_pct × gmv
  sub     ← mall_subscriptions(자동) + payments_manual(수기) 해당 월분
→ 정산 담당 검토(anomaly 우선) → confirmed → 명세 PDF(워커) → 포털 게시(16) + 메일 → paid 체크
disputed 처리: 이의 제기 시 상태 전환 + 코멘트 스레드 + 파트장 승인으로 재계산
```

## 5. CS (v1 경량)
- 유입: 포털 문의(16)·이메일 수집(09에서 kind 분류)·수동 등록. sla_due 24h(urgent 4h) — 기존 알림 사다리 재사용.
- AI: 답변 초안(QnA 지식(14-E) 재사용) → 승인 발송. 반복 질문 자동 FAQ화.

## 6. 화면
`/ops` 사이클 대시보드(브랜드×이행률 히트맵, 미달 빨강) · `/seeding` 파이프라인 보드(상태 칸반) · `/lives` 편성 캘린더 · `/cs` 티켓 큐 · `/pay` 정산 런 탭 추가.

## 7. 완료 기준
- [ ] 월 1일 사이클·워크아이템 자동 발행(플랜별 수량 정확)
- [ ] 시딩: 추천→게시 자동확인→성과 갱신 전 사이클 동작
- [ ] 이행률 50% 미달 알림 + Guarantee 보장 게이지
- [ ] 정산 draft 자동 생성 + anomaly 플래그 + 승인 2단계(12 문서 결재선)
- [ ] 리포트·명세 생성이 요청당 60초 제한을 피해 워커에서 실행
