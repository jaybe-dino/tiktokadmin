# 12 · 권한·조직 체계 (RBAC) — 30~40명 조직용

> Claude Code 지시: v0.1 스키마에 함께 반영한다(나중에 넣으면 전 화면 재작업). 01·03(ops)·04(화면)와 연결.

## 1. 조직 모델 (2단: 파트 > 팀)

```sql
CREATE TABLE teams (
  id text PRIMARY KEY,                -- 'intake-1', 'sales-a' ...
  part text NOT NULL CHECK (part IN ('intake','sales','onboard','ads','ops','settle','mgmt')),
  name text NOT NULL,
  lead_user text                      -- 팀장 admin_users.id
);
ALTER TABLE admin_users ADD COLUMN team_id text REFERENCES teams(id);
ALTER TABLE admin_users ADD COLUMN is_part_lead boolean DEFAULT false;  -- 파트장
-- role 확장: 기존 7종 유지 + 'viewer'(읽기전용, 신규입사 교육용)
```

## 2. 권한 3축 (보기 / 편집 / 승인)

| 축 | 규칙 |
|---|---|
| **보기(scope)** | `own`(내 담당 브랜드) / `team`(우리 팀 담당) / `part`(파트 전체) / `all`. 기본: 담당자=team, 팀장=part, 파트장·exec=all. **협상 금액·정산 상세는 별도 플래그**(sales/settle/exec만) |
| **편집** | 자기 파트 구간의 필드만(예: 온보딩 담당은 doc_items·brand_company, 광고 담당은 캠페인). 공통 필드(메모·접촉기록)는 보기 권한자 전원 |
| **승인(approve)** | 13장이 아닌 여기서 정의: 드랍/후퇴 승인=팀장+, 할인 상한 초과 제안=파트장, 정산 확정=settle 팀장+exec 2단계, 계약 terms 변경=파트장 |

구현: `lib/permissions.ts` — `can(user, action, resource)` 단일 함수. 모든 ops API·페이지 로더가 이 함수만 경유(화면별 하드코딩 금지).

```ts
type Action = 'view'|'edit'|'approve'|'view_money';
can(user, 'view', brand)      // scope 계산: owner_* 포함 여부 → team → part → all
can(user, 'approve', {kind:'drop'|'discount'|'settlement'|'contract_terms'|'state_back'})
```

## 3. 승인 워크플로 (게이트 엔진 확장)

```sql
CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                 -- drop|discount|settlement|contract_terms|state_back|bulk_action
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,             -- 요청 내용(예: {to_state, reason} / {discount_pct})
  requested_by text NOT NULL,
  approver_role text NOT NULL,        -- team_lead|part_lead|exec
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by text, decided_at timestamptz, decision_note text,
  created_at timestamptz DEFAULT now()
);
```
- 흐름: ops API가 승인 필요 판정 → approval_requests 생성 → 승인자 Slack 카드([승인/반려+사유]) → 승인 시 원래 액션 자동 실행(같은 게이트 재검증). 48h 미결 시 상위 에스컬레이션.
- 할인 상한: `sla_policies`처럼 설정 테이블에 `discount_limit_pct`(기본 20) — 초과 제안은 sent 전에 승인 필요.

## 3-B. 계정 프로비저닝 — 계정별 연동 매핑 (v3 보강)

> 30~40명 체제의 핵심: **계정 하나에 이메일·줌·Slack 연동이 전부 매핑**되어야 자동화(미팅 자동 배정·메일 수집·DM 알림)가 사람별로 작동한다. 연동 미완성 계정은 자동화에서 조용히 빠지므로, 완성도(4/4)를 시스템이 감시한다.

### 3-B-1. admin_users 확장 스키마
```sql
ALTER TABLE admin_users ADD COLUMN slack_user_id text;        -- DM·멘션 라우팅 (필수)
ALTER TABLE admin_users ADD COLUMN zoom_email text;           -- 호스트→담당 자동 매핑 키 (08 §3-0, 상담 담당 필수)
ALTER TABLE admin_users ADD COLUMN zoom_scheduler_url text;   -- 개인 예약 링크 (팔로업 메일 재예약 링크에 삽입)
ALTER TABLE admin_users ADD COLUMN gmail_sync boolean DEFAULT false;  -- 이 계정 메일함 수집 대상 여부 (09)
ALTER TABLE admin_users ADD COLUMN gmail_address text;        -- 수집 대상 주소 (회사 도메인만 허용)
ALTER TABLE admin_users ADD COLUMN notify_prefs jsonb DEFAULT '{"dm":true,"email_digest":true,"quiet":[22,8]}';
ALTER TABLE admin_users ADD COLUMN ooo_until date;            -- 부재(휴가) 종료일
ALTER TABLE admin_users ADD COLUMN ooo_delegate text;         -- 부재 중 위임 대상 admin_users.id
ALTER TABLE admin_users ADD COLUMN invited_at timestamptz, ADD COLUMN activated_at timestamptz;
```

### 3-B-2. 계정 생성(초대) 플로우 — /settings/org
1. 파트장이 초대: 이름·회사 이메일·팀·역할 입력 → 초대 메일 발송(매직 링크).
2. 본인 첫 로그인 시 **셀프 연동 위저드**: ① Slack 계정 연결 확인(이메일 매칭 자동 + 수동 보정) → ② Zoom 이메일 입력·scheduler 링크 등록(상담 역할만 필수) → ③ Gmail 수집 동의(수집은 브랜드 매칭 메일만이라는 안내 고지) → ④ 알림 설정.
3. 완료 시 activated_at 기록. **연동 완성도 4/4가 될 때까지 /settings/org 목록에 배지 표시** + 주 1회 파트장 리마인드.

### 3-B-3. 연동별 규칙
| 연동 | 매핑 키 | 없으면 생기는 일 | 필수 대상 |
|---|---|---|---|
| Slack | slack_user_id | DM 알림 불가 → 채널 멘션으로 폴백(전원에게 노출) | 전원 |
| Zoom | zoom_email | 그 사람 미팅이 unmatched 큐로 빠짐 · 담당 자동 배정 불가 | 상담 진행자(영업·유입) |
| Gmail | gmail_address + gmail_sync | 그 계정의 브랜드 메일이 타임라인에 안 쌓임 → 무응답 감시 누락 | 브랜드 커뮤니케이션 담당 |
| Scheduler | zoom_scheduler_url | 팔로업 메일의 재예약 링크가 공용 링크로 폴백 | 상담 진행자 |

- Gmail 수집은 **회사 도메인 계정만** + 도메인 위임 스코프 내. 개인 메일 금지. 수집 범위는 09 규칙(브랜드 매칭 스레드만) 그대로.
- Zoom: 모든 상담 계정이 같은 Zoom 조직(S2S 앱 계정) 소속이어야 웹훅이 잡힌다(08 §1-5). 조직 밖 계정은 등록 시 경고.
- 부재 처리: ooo_until 설정 시 신규 배정 차단 + T0/T1 알림이 ooo_delegate에게 전달(T2+는 원래 사다리 유지). 복귀 시 자동 해제.
- 퇴사(active=false): 세션 무효 + Gmail sync 해제 + zoom_email 매핑 제거 + 담당 브랜드 재배치 위저드 — §4와 동일 원스톱.

## 4. 접근 로그·회수

```sql
CREATE TABLE access_log ( id bigserial PRIMARY KEY, user_id text, action text,
  resource text, brand_id uuid, at timestamptz DEFAULT now() );  -- 민감 조회(정산·계약·연락처 export)만 기록
```
- 퇴사/이동: admin_users.active=false → 즉시 세션 무효 + 담당 브랜드 일괄 재배치 위저드(09 B-3) 자동 오픈 + 파일/Gmail sync 해제.

## 5. 화면 반영
- 모든 목록·360은 scope 필터 자동 적용(권한 밖 브랜드는 검색에도 안 나옴 — 존재 자체 비노출).
- /settings/org: 팀 CRUD·구성원 배치·권한 플래그·승인선 설정(파트장만).
- 승인함 /approvals: 내가 승인할 것 + 내가 요청한 것.

## 6. 완료 기준
- [ ] can() 단일 경유 — 우회 쿼리 없음(코드 리뷰 체크)
- [ ] 영업 A가 다른 팀 협상 금액 비노출 확인
- [ ] 드랍 승인 흐름: 요청→Slack 승인→자동 실행→이력
- [ ] 퇴사 처리 시 세션·권한·배정 원스톱
