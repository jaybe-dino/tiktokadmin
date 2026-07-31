# 09 · 이메일 자동 수집 + 담당자 배치 엔진

> 확정 결정: 팀 메일 = **Google Workspace(회사 도메인)** / 수집 범위 = **브랜드 매칭 메일만** / 배정 = **파트장 수동(시스템은 후보·부하 표시)**.
> Claude Code 지시: 어드민 앱에 아래 두 모듈을 구현해줘. 01(스키마)·03(게이트)·05(Slack)·08(email_drafts)과 연결된다.

---

## A. 이메일 자동 수집 (Gmail Sync)

### A-1. 목표
담당자가 브랜드와 주고받는 모든 이메일이 **자동으로 해당 brands 행의 타임라인에 기록**된다.
효과: ① 브랜드 360에 메일 스레드 통합(담당 교체 시 히스토리 승계) ② `last_contact_at` 자동 갱신(방치 감지 정확화) ③ **브랜드 무응답 감지**(보냈는데 N일 답 없음) ④ AI 요약·답장 초안.

### A-2. 아키텍처 (Google Workspace 전제)
1. Google Cloud 프로젝트 생성 → **서비스 계정** + **Domain-wide Delegation** 승인(Workspace 관리콘솔).
   - Scope: `https://www.googleapis.com/auth/gmail.readonly` (읽기 전용 — 발송은 기존 Resend/08 경로 유지)
2. 수집 대상 = `admin_users` 중 `gmail_sync_enabled=true`인 회사 계정만. 서비스 계정이 각 계정을 impersonate.
3. 동기화 방식:
   - 권장: Gmail **watch + Pub/Sub push** → `/api/gmail/notify` 수신 → `history.list`로 증분 수집.
   - 폴백(간단 시작): `/api/cron/gmail-sync` 5분 주기 폴링(`historyId` 저장 후 증분).
4. env: `GOOGLE_SA_KEY_JSON`(또는 Workload Identity), `GMAIL_PUBSUB_TOPIC`(watch 사용 시).

### A-3. 매칭 규칙 — "브랜드 매칭 메일만" (프라이버시 원칙)
```
메시지의 참여 주소(from + to + cc) 정규화 후:
1. brand_emails(브랜드 이메일 별칭 테이블) 정확 매칭   ← 1차
2. brands.email 정확 매칭                              ← 2차
3. 도메인 보조 매칭: 주소 도메인 == brand_url 호스트의 도메인 ← 3차(자동 별칭 등록 제안)
매칭 실패 → 저장하지 않고 폐기(개인 메일 절대 미보관). 로그도 메시지ID만.
```
- 한 브랜드에 담당자 여러 명 주소가 있을 수 있으므로 `brand_emails`로 별칭 관리(수동 추가 + 3차 매칭 시 자동 제안).

### A-4. 스키마 (migrations/004_communications.sql — 08과 공유)
```sql
CREATE TABLE brand_emails (          -- 브랜드측 이메일 별칭
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email text NOT NULL,
  added_by text, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (brand_id, email)
);

CREATE TABLE email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  gmail_msg_id text UNIQUE NOT NULL,        -- 멱등
  thread_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  owner_email text NOT NULL,                -- 수집된 담당자 계정
  from_addr text NOT NULL, to_addrs text[] DEFAULT '{}',
  subject text DEFAULT '', snippet text DEFAULT '',
  body_text text,                           -- 서명·인용 제거 정제본
  has_attachment boolean DEFAULT false,     -- 파일 자체는 저장 안 함(메타만)
  sent_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON email_messages (brand_id, sent_at);
CREATE INDEX ON email_messages (thread_id);

ALTER TABLE admin_users ADD COLUMN gmail_sync_enabled boolean DEFAULT false;
ALTER TABLE admin_users ADD COLUMN gmail_history_id text;
```

### A-5. 부수효과 (수집 시 자동)
| 조건 | 동작 |
|---|---|
| 매칭 저장 시 | `brand_sources` INSERT `event='contact_logged'` `{channel:'email', direction}` + `last_contact_at=sent_at`(in/out 모두) |
| direction=out 후 영업일 3일 내 in 없음 | `alerts kind='no_reply'` (담당 Slack: "무응답 — 재접촉 or 다음 액션 제안") |
| direction=in (브랜드가 보냄) | 담당 Slack 카드: AI 3줄 요약 + [답장 초안 보기] 버튼 → email_drafts(kind='reply') 생성·승인·발송(08 재사용) |
| 서류수급중 브랜드의 in 메일에 첨부 존재 | 온보딩 채널 알림 "서류 도착 가능성 — 체크리스트 확인" |
| 스레드가 미팅 조율 내용(AI 분류) | next_action 제안 "미팅 확정" |

### A-6. 프라이버시·보안 규칙 (강제)
- 매칭 메일만 저장(A-3). 미매칭은 즉시 폐기, 본문 로깅 금지.
- body_text는 서명/과거 인용 제거 정제본만. 첨부파일 저장 금지(has_attachment 플래그만).
- 열람 권한: 해당 브랜드 담당 + 파트장 + exec. 전체 검색은 exec만.
- 팀 공지 필수: "회사 계정의 브랜드 관련 메일이 CRM에 기록됩니다" 동의 후 sync 활성화.
- 브랜드 삭제 시 CASCADE 삭제. 보관기간 정책(예: 종료 브랜드 1년 후 파기) cron.

### A-7. UI
- 브랜드 360에 **"이메일" 탭**: 스레드 그룹핑, in/out 뱃지, 요약 보기, [답장 초안] 버튼.
- /queue에 무응답(no_reply) 항목 노출. /settings에 담당자별 sync on/off + brand_emails 관리.

---

## B. 담당자 배치 엔진 (파트장 수동 + 시스템 보조)

### B-1. 원칙
배정 **결정은 항상 사람(파트장)**. 시스템은 ① 배정 대기 큐를 만들고 ② 후보와 부하를 보여주고 ③ 결정을 기록·전파하고 ④ 미배정을 방치하지 못하게 재촉한다(게이트 assigned 조건은 그대로 유지 — 배정 없인 다음 단계 진행 불가).

### B-2. 배정 플로우
1. **배정 큐 발생**: 신규 브랜드 생성/단계 전환으로 owner_* 공백 발생 시 → `/assign` 화면 + 파트장 채널 Slack 카드.
2. **Slack 배정 카드**: 브랜드 요약(등급·카테고리·국가·플랜) + **후보 3명 자동 표시** — 산정 기준: 같은 카테고리 경험 브랜드 수, 담당 국가, **현재 부하(커버 브랜드 수·SLA 위반 수)**. 과부하 후보엔 ⚠️ 표시.
3. 파트장이 select로 선택 → `ops/assign` 호출 → 담당 DM "신규 배정" + 브랜드 360 링크 + (있으면) 사전분석 브리프 첨부.
4. **미배정 SLA**: 24시간 미배정 시 T1 재촉 → +1일 exec 에스컬레이션(03 사다리 재사용).

### B-3. 재배치·인수인계
- 담당 변경 시: `assignment_log` 기록 + **AI 인수인계 요약 자동 생성**(해당 브랜드 타임라인·메일·미팅 요약 1페이지) → 신규 담당 DM.
- **일괄 재배치**(퇴사·휴가): from→to 벌크 이동 화면(브랜드 다중선택) + 백업담당 자동 승격.
- `brands.owner_backup` 필드 추가: 담당 부재 시 알림이 백업에게 라우팅.

### B-4. 스키마 (migrations/004_communications.sql에 포함)
```sql
ALTER TABLE brands ADD COLUMN owner_backup text;   -- admin_users.id
CREATE TABLE assignment_log (
  id bigserial PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role text NOT NULL,            -- owner_intake|owner_sales|owner_onboard|owner_ads|owner_backup
  from_user text, to_user text NOT NULL,
  by_user text NOT NULL, reason text DEFAULT '',
  at timestamptz DEFAULT now()
);
```

### B-5. 부하 대시보드 (/settings 또는 /monitor 탭)
담당자별: 커버 브랜드 수(역할별) · 활성 SLA 위반 · 이번 달 사이클 이행률 · 무응답 건수. 파트장 배정 화면에서 항상 참조.

### B-6. MCP 툴 추가 (06 확장)
```ts
list_unassigned({role?}) → 배정 대기 브랜드 + 후보 3명(부하 포함)
suggest_assignee({brand_id, role}) → {candidates:[{user, score, load, reason}]}
assign_owner(...)                  → 기존(03 ops/assign 경유)
bulk_reassign({from_user, to_user, role, brand_ids[]})
generate_handover({brand_id})      → 인수인계 요약 md
list_no_reply({days=3})            → 무응답 브랜드 목록
summarize_thread({thread_id})      → 메일 스레드 요약
draft_reply({message_id, points?}) → 답장 초안(email_drafts)
```

---

## C. 구현 순서 & 완료 기준
1. 004 마이그레이션(08과 공동) → 2. Gmail 폴링 sync(폴백)부터 → 3. 매칭·contact_logged·무응답 알림 → 4. 360 이메일 탭 + 답장 초안 → 5. watch/Pub/Sub 전환 → 6. 배정 큐·Slack 카드·부하 대시보드 → 7. 일괄 재배치·인수인계.

- [ ] 브랜드 매칭 메일만 저장되고 미매칭은 폐기됨(테스트: 개인 메일 미저장 확인)
- [ ] in/out 모두 contact_logged + last_contact_at 갱신
- [ ] out 후 3영업일 무응답 → no_reply 알림 발화·응답 수신 시 해제
- [ ] 브랜드 in 메일 → Slack 요약 카드 + 답장 초안 승인 발송 동작
- [ ] 배정 카드에 후보 3명+부하 표시, 24h 미배정 에스컬레이션
- [ ] 일괄 재배치 + AI 인수인계 요약 생성

---
## 9-C. v3 보강 — 발송 센터 (대량·개별 메일/문자) + 리드 그룹

### 스키마 (migrations/004에 포함)
```sql
ALTER TABLE brands ADD COLUMN lead_group text;   -- 리드 등록 그룹: "2026-07-30 · 여름박람회" (등록일+소스 자동, 수정 가능)

CREATE TABLE bulk_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('lead_group','filter','manual')),  -- 그룹 지정 3방식
  target_def jsonb NOT NULL,          -- {group:"…"} | {state:[],grade:[],source:[],last_contact_gt:30} | {brand_ids:[]}
  channel text NOT NULL CHECK (channel IN ('email','sms','both')),  -- both: 메일 우선, 미열람 24h 후 문자
  template_key text, body_md text NOT NULL,      -- 개인화 변수 {브랜드명}{담당자명}{담당자예약링크}{설문링크}
  scheduled_at timestamptz, status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','queued','sending','done','canceled')),
  total int, sent int, excluded_optout int, excluded_nocontact int,
  created_by text, created_at timestamptz DEFAULT now()
);
CREATE TABLE bulk_send_targets (
  bulk_id uuid REFERENCES bulk_sends(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  channel text, status text DEFAULT 'pending'    -- pending|sent|delivered|opened|clicked|replied|failed|excluded
  , sent_at timestamptz, PRIMARY KEY (bulk_id, brand_id)
);
```

### 규칙
1. **리드 그룹**: 리드 가져오기 3경로(웹훅/CSV/수동) 등록 시 `lead_group` 자동 부여(등록일+소스, 예 "2026-07-30 · 여름박람회") — CSV·수동은 그룹명 수정 가능. 그룹은 발송 센터의 1급 대상.
2. **대상 3방식**: ① lead_group 선택 ② 필터 조합(상태·등급·유입경로·마지막 접촉 등) ③ 직접 선택. 어떤 방식이든 **수신동의 필터 자동 적용**(거부·연락처 없음 제외, 제외 수 표시).
3. **채널**: email(Resend, 담당자 개인 명의 발신) / sms(알림톡·SMS 게이트웨이, 90바이트 카운트) / both(메일 → 미열람 24h 후 문자 폴백).
4. **발송 후 자동 연쇄 (필수)**: 대상 전원에 `contact_logged(channel='bulk_email'|'bulk_sms', note=템플릿명)` 기록 → last_contact_at 갱신 → 방치 알림 리셋. 회신은 09 수집으로 카드에 연결, 오픈·클릭은 bulk_send_targets에 축적(재점화 감지).
5. 개별 발송(메일·문자)도 같은 엔진 — target_kind='manual' 1건. AI가 카드 맥락(단계·최근 미팅)으로 초안.
6. 캠페인·윈백(세그먼트)의 발송 실행도 이 발송 센터 큐를 사용 — 발송 경로 단일화.

### 9-C-2. 발신 채널 정책 (v3 확정 — 전 직원)
- **모든 메일은 회사 이메일(@dinostudio.kr)로만 발신** — 본인 회사 계정(jiho@…) 또는 부서 대표(sales@·marketing@). 개인 메일 사용 금지.
- **모든 문자는 회사 지정 번호로만 발신**(대표·부서 번호, 관리자만 변경). 직원 개인 휴대폰으로 고객 연락 금지.
- **해당 채널의 수·발신 전량을 시스템이 수집**: 회사 도메인 전 계정(도메인 위임) + 지정 번호 회신 웹훅 → 고객카드 타임라인 자동 연결. 개인 채널을 쓰면 기록이 누락되고 방치 감시가 오작동하므로 금지 — 기록 공백은 담당자 책임.
- 개별 발송(메일·문자)은 고객카드에서 모달로 실행(360 헤더 [✉️ 메일][📱 문자]) — 발신 계정/번호는 위 정책 내에서만 선택. 알림톡 템플릿은 사전 승인제.
- 발송 센터 UI는 3탭: ✉️ 메일 발송 / 📱 문자 발송 / 발송 관리·채널 정책(통합 이력 — 모든 행에 "카드 기록 ✓" 표시).
