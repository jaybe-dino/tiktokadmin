# 설계 · 파트별 이메일 연동 + AI 업무 백업 (추후 구현)

> 상태: **설계/로드맵** (구현 전). 현재 시스템(브랜드 원장 + 게이트/SLA + Slack + MCP + 에이전트 5종)
> 위에 얹는 확장이다. 코어 원칙(모든 쓰기는 게이트 검증 경유, 상태변경·발송은 사람 승인)을 그대로 따른다.

## 목표
1. **파트별 이메일 연동** — 각 파트(유입/영업/온보딩/광고/정산)가 전용 주소로 브랜드와 이메일을 주고받고,
   모든 메일이 **해당 브랜드 타임라인에 자동으로 묶인다**.
2. **AI 업무 백업** — 담당자가 부재하거나 밀릴 때, AI가 **초안 작성 → 사람 승인 → 발송**으로 각 파트 업무를 대행/보조한다.
   (상태변경·실제 발송은 항상 사람 승인. 기존 06 안전규칙 유지.)

---

## Part A. 파트별 이메일 연동

### A-1. 발신 (이미 기반 있음)
- 현재 `lib/ops.ts opsRemind` 가 Resend 로 리마인더를 보냄. 이를 **파트별 발신 주소·서명**으로 표준화.
- 파트별 From: `intake@`, `sales@`, `onboard@`, `ads@`, `settle@ (glovek.space 도메인)`.
- 템플릿: `/settings` 의 이메일 템플릿(변수 `{brand} {missing_items} {link}`) 을 파트별로 확장.

### A-2. 수신 (신규)
- **Resend Inbound** (또는 Google Workspace 라우팅 → 웹훅) 로 수신 메일을 어드민 엔드포인트로 인입:
  `POST /api/email/inbound` (서명검증).
- 처리: `from` 이메일 → **brands dedup 매칭** → 없으면 신규 리드 생성(source=email) →
  `email_messages` 저장 + `brand_sources(event=email_in)` + 타임라인 반영 + 담당 Slack 알림.
- 스레드 이어붙임: `Message-Id` / `In-Reply-To` 로 `email_threads` 묶음.

### A-3. 데이터 모델 (추가 예정)
```sql
CREATE TABLE email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  part text,                     -- intake|sales|onboard|ads|settle
  subject text, last_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  direction text CHECK (direction IN ('in','out')),
  from_addr text, to_addr text, subject text, body_text text,
  message_id text UNIQUE, in_reply_to text,
  sent_by text,                  -- out: admin:{id}|ai(approved by {id})
  at timestamptz NOT NULL DEFAULT now()
);
-- (선택) 파트별 별칭 라우팅
CREATE TABLE email_routes (alias text PRIMARY KEY, part text NOT NULL);
```

### A-4. UI
- 브랜드 360 에 **이메일 스레드 섹션**(수·발신 시간순) + **답장 작성**(AI 초안 버튼 → 편집 → 발송, opsRemind 확장).

### A-5. 보안/컴플라이언스
- 개인정보 최소 저장(본문은 운영 필요한 만큼, 첨부는 링크/미저장 원칙).
- 발신 도메인 SPF/DKIM(Resend). 모든 발신은 `email_messages` 감사기록.

---

## Part B. AI 업무 백업 (파트별 에이전트)

기존 MCP + 에이전트 5종을 **파트별 백업 에이전트**로 확장. 새 툴은 대부분 초안 생성이며 발송은 승인 경유.

| 파트 | AI 백업 업무(초안) | 승인/발송 |
|---|---|---|
| 유입(intake) | 신규 리드 첫 응대·FAQ 답변 초안, 미팅 일정 제안 | Slack 버튼 승인 → 발송 |
| 영업(sales) | 제안서/견적 요약, 미응답 리드 팔로업 초안 | 승인 발송 |
| 온보딩(onboard) | 서류 리마인더(구현됨)·반려 사유 안내 초안 | 승인 발송 |
| 광고(ads) | 성과 요약·킥오프 안내 초안 | 승인 발송 |
| 정산(settle) | past_due 결제 안내 초안·정산 요약 | 승인 발송 |

### B-1. 인입 이메일 → AI 흐름
```
수신 메일 → 분류(어느 파트·브랜드·의도) → 담당 배정/에스컬레이션
        → AI 답장 초안 생성(draft_reply 툴) → Slack 카드 "이 답장 발송?" (승인/수정/거절)
        → 승인 시 발송(opsRemind 확장) + email_messages 기록
```

### B-2. 백업 자동화 레벨 (단계적)
- **v1 (초안만)**: AI 는 초안만, 발송은 100% 사람. (기본값·안전)
- **v2 (저위험 자동)**: 리마인더·단순 안내 등 **승인 임계가 낮은 액션**은 규칙에 따라 자동 발송(감사기록 필수).
- **v3 (부재 백업)**: 담당 부재(휴가/야간) 시 특정 파트의 1차 응대를 자동, 담당 복귀 시 인계 요약.

### B-3. 안전 규칙 (유지)
- 상태변경(transition/drop)은 AI 직접 실행 금지 — 제안까지만.
- 개인정보(카드·신분증)는 어떤 출력에도 포함 금지.
- 자동 발송은 레벨(v2·v3)에서만, **파트·액션별 화이트리스트 + 감사기록** 하에.

---

## 새 MCP 툴 (추가 예정, 06 카탈로그 확장)
```
list_email_threads({brand_id})            # 브랜드 이메일 스레드
draft_reply({thread_id, intent})          # 수신 메일에 대한 답장 초안(발송 아님)
classify_inbound({message})               # 파트·브랜드·의도 분류
send_email({brand_id, part, subject, body})  # ops 경유 발송(승인 후에만 호출)
```

## 필요한 결정 (구현 착수 전)
1. **이메일 provider**: Resend Inbound vs Google Workspace 라우팅(기존 메일함 유지).
2. **저장 범위**: 본문 전체 저장 vs 요약+원본 링크(개인정보 최소화).
3. **자동 발송 허용 수준**: v1(초안만) 로 시작 → 운영 안정 후 v2 확대 여부.
4. **파트별 주소 체계**: 새 별칭(intake@ 등) 생성 vs 기존 대표메일 라우팅.

## 로드맵
- **E1** 발신 표준화(파트별 주소·서명·템플릿) — Resend 기반, 소규모.
- **E2** 수신 인입(`/api/email/inbound`) → 브랜드 스레드 매칭 → 360 표시.
- **E3** AI 답장 초안 → Slack 승인 발송(v1).
- **E4** 파트별 백업 에이전트 + 저위험 자동화(v2), 부재 백업(v3).

> 착수 시 이 문서 기준으로 마이그레이션(email_threads/messages) → 인입 라우트 → 360 UI → MCP 툴 → 에이전트 순으로 구현.
