# 08 · Zoom 1:1 상담 자동화 — 녹화→회의록→후속메일

> Claude Code 지시: 어드민 앱에 Zoom 웹훅 수신·전사·회의록 요약·후속메일 초안 파이프라인을 이 스펙대로 구현해줘. 01(스키마)·03(게이트)·05(Slack)·06(MCP)과 연결된다.

## 0. 목표 흐름 (한 줄)

```
줌 미팅 종료 → (웹훅) 녹화 수신 → Whisper 전사(한국어) → Claude 회의록 요약
→ brands에 자동 기록(contact_logged: meeting → 게이트 자동 충족)
→ 후속 메일 초안 자동 생성 → Slack 카드로 담당 승인 → Resend 발송 → 기록
```
사람이 하는 일: **Slack에서 회의록 확인 + 메일 초안 승인(또는 수정) 버튼 클릭** 뿐.

## 1. Zoom 쪽 준비 (1회 설정)

1. Zoom 유료 계정에서 **Cloud Recording** 활성화 + "녹음 파일(M4A) 생성" 켬. 호스트(예: 김지호 이사 계정)가 1:1 상담을 항상 클라우드 녹화.
2. Zoom Marketplace에서 **Server-to-Server OAuth 앱** 생성.
   - Scopes: `cloud_recording:read`, `meeting:read`, `user:read` (+가능하면 AI Companion summary read)
   - env: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`
3. **Event Subscription(웹훅)** 등록 → `{ADMIN_URL}/api/zoom/webhook`
   - 이벤트: `recording.completed` (필수), `meeting.created`, `meeting.updated`, `meeting.deleted` (예약 단계 연동 — §3-0), `recording.transcript_completed`, `meeting.summary_completed`(플랜 지원 시)
   - env: `ZOOM_WEBHOOK_SECRET` (서명 검증용)
4. 상담 예약은 기존 **scheduler.zoom.us** 링크 유지 — 예약자 이메일이 미팅 참가자로 남아 브랜드 매칭 키가 된다.
5. **담당자(호스트) 매핑 등록 (30~40명 체제 필수)**: `admin_users.zoom_email` 컬럼에 각 담당자의 Zoom 계정 이메일을 등록. 웹훅의 host_email → admin_users 매핑이 담당 자동 배정의 키가 된다. 상담 담당자는 각자 자기 scheduler 링크를 쓰되, 모든 담당자 계정이 같은 Zoom 조직(S2S 앱 계정) 안에 있어야 웹훅이 잡힌다.

⚠️ 한국어 전사 주의: Zoom 내장 audio transcript는 한국어 품질이 낮다/미지원에 가깝다. **전사는 Zoom에 의존하지 않고 녹음 파일(M4A)을 받아 Whisper 계열 STT로 직접 수행**한다(아래 §3). Zoom transcript/AI Companion 요약이 오면 참고자료로만 병행 저장.

⚠️ 법·컴플라이언스: 녹화 사실을 상대에게 고지(Zoom 녹화 동의 배너 활성화 + 상담 시작 멘트). 녹취·전사엔 개인정보가 포함되므로 보관기간 정책(예: 1년) + 접근권한(담당/파트장만)을 설정한다.

## 2. 스키마 추가 (migrations/004_communications.sql — 09와 공유)

```sql
CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,   -- 매칭 실패 시 NULL(수동 매칭 큐)
  zoom_meeting_id text NOT NULL,
  zoom_uuid text UNIQUE NOT NULL,                           -- 멱등키
  topic text DEFAULT '', host_email text,
  participants jsonb DEFAULT '[]',                          -- [{name,email}]
  scheduled_at timestamptz,                                 -- 예약 시각(§3-0 meeting.created)
  host_admin_id uuid,                                       -- admin_users 매핑(zoom_email 기준)
  started_at timestamptz, duration_min int,
  recording_url text, recording_expires timestamptz,
  audio_file_path text,                                     -- 다운로드 보관 위치(스토리지)
  transcript text,                                          -- Whisper 전사 전문
  transcript_source text DEFAULT 'whisper',                 -- whisper|zoom_vtt|ai_companion
  summary_md text,                                          -- Claude 회의록(표준 포맷)
  followup_status text NOT NULL DEFAULT 'none'
    CHECK (followup_status IN ('none','drafted','approved','sent','skipped')),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('scheduled','received','transcribing','summarizing','ready','unmatched','no_show','canceled','error')),
  error text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'followup',                    -- followup|reminder|payment_notice
  to_email text NOT NULL, subject text NOT NULL, body_md text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','sent','discarded')),
  edited_by text, sent_at timestamptz, resend_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## 3. 파이프라인 구현 (`/app/api/zoom/webhook` + 워커)

### 3-0. 예약 단계 연동 — 미팅이 잡히는 순간부터 시스템이 안다 (v3 보강)

`meeting.created` 수신 시:
1. meetings INSERT: status='scheduled', scheduled_at, host_email → **host_admin_id 자동 매핑**(admin_users.zoom_email).
2. **브랜드 매칭**(§3-3과 동일 순서: 예약자 이메일 → topic 브랜드명). 매칭되면:
   - 담당 자동 배정 제안: 브랜드에 owner_sales 없으면 호스트를 담당으로 지정하는 Slack 카드([승인] 클릭 시 ops/assign). 이미 담당이 있는데 호스트가 다르면 "담당 불일치" 표시만(자동 변경 안 함).
   - state 전이 제안: 현재 state가 lead_new/seminar면 `meeting` 전이 카드(게이트 통과 시 원클릭).
   - 브랜드 360 "메일/미팅" 탭 + **팀 미팅 캘린더 뷰**(누가 언제 어떤 브랜드와)에 표시.
3. **D-1 리마인더**: 미팅 전날 브랜드에 확인 메일 초안(email_drafts, 승인 발송) + 당일 아침 담당 Slack DM("오늘 미팅 n건: 브랜드·시간·브리프 링크" — 사전분석 브리프 첨부).
4. `meeting.updated` → scheduled_at 갱신 / `meeting.deleted` → status='canceled' + 담당 Slack + 재예약 유도 메일 초안.
5. **노쇼 감지**: scheduled인데 시각+24h까지 recording.completed 미수신 → status='no_show' → 담당 Slack 카드(재예약 링크 포함 메일 초안 자동 첨부) + last_contact_at 미갱신 유지(stale 감시 계속).

⚠️ scheduler.zoom.us 예약이 `meeting.created` 웹훅을 발생시키는지 계정 플랜에서 1건 테스트 필수. 안 오면 대안: Scheduler API 폴링(30분 cron) 또는 예약 확정 메일을 09 Gmail 수집으로 파싱 — 어느 쪽이든 meetings(status='scheduled') 생성 경로만 확보하면 이후 로직은 동일.

### 3-1. 웹훅 수신
- Zoom URL validation challenge(`endpoint.url_validation`) 처리 + `x-zm-signature` HMAC 검증.
- `recording.completed` 수신 → meetings INSERT(zoom_uuid 멱등) → 처리 큐 등록 → 200 즉시 응답.

### 3-2. 녹화 다운로드 & 전사
- payload의 `download_token`으로 M4A 오디오 다운로드 → 스토리지 저장(Vercel Blob/S3).
- **Whisper STT** (OpenAI audio API 또는 groq whisper-large-v3, `language: ko`) → transcript 저장.
  - 60분 상담 기준 비용 수백 원 수준. 25MB 초과 시 청크 분할.
- Zoom VTT/AI Companion 요약이 별도 웹훅으로 오면 참고용으로 함께 저장(transcript_source 표시).

### 3-3. 브랜드 매칭 (순서)
1. 참가자 이메일(host 제외) → brands dedup 키 매칭
2. 미팅 topic에 브랜드명 포함 여부 (`[브랜드명] 1:1` 네이밍 규칙 권장)
3. 실패 → status='unmatched' → Slack 유입 채널에 "매칭 필요" 카드(브랜드 검색 select 모달로 수동 연결)

### 3-4. Claude 회의록 요약 (표준 포맷 고정)
transcript를 Claude API로 요약. 출력 포맷(고정 — summary_md):
```
## 상담 요약 · {브랜드} · {날짜}
**참석**: … / **길이**: n분
**핵심 니즈**: (1~3줄)
**논의 플랜/국가**: Live Focus|Guarantee|Onboarding · 국가
**우려/반대 포인트**: …
**합의/약속한 것**: …
**다음 액션**: [ ] … (기한)   ← brands.next_action 제안값
**등급 시그널**: 5대 지표 관련 새로 파악된 사실(진단 갱신 제안)
```

### 3-5. 시스템 자동 기록 (핵심 연결)
요약 완료 시 자동으로:
- `brand_sources` INSERT: `event='contact_logged'`, `payload={channel:'meeting', note:summary_md 링크}` → **03 게이트 `meeting→contact`의 hasMeetingNote가 자동 충족됨**
- `brands.last_contact_at = 미팅시각` 갱신 (stale 알림 자동 해제)
- 회의록의 "다음 액션"을 brands.next_action **제안**으로 Slack 카드에 표시(승인 시 반영)
- "등급 시그널"이 있으면 diagnose_brand 재실행 큐

**다음 스텝 가이드 자동 첨부 (v3 보강 — 담당자가 "이제 뭘 하지?"를 스스로 계산하지 않게)**
Slack 회의록 카드 하단에 시스템이 03 GATES를 조회해 **현재 state 기준 다음 전이의 게이트 체크리스트**를 자동 렌더:
```
▶ 다음 스텝: contact → contract_review
  ✅ 미팅 기록 (방금 자동 충족)
  ✅ 담당자 지정 (김OO)
  ⬜ 설문 응답 (발송됨 · D+0)     ← 팔로업 메일에 링크 포함됨
  ⬜ 제안서 발송 (proposals.status='sent')  [제안서 작성 →]
```
- 충족/미충족은 gates.ts의 동일한 rule 함수를 재사용(별도 로직 금지 — 카드와 실제 게이트 판정이 어긋나면 안 됨).
- 미충족 항목엔 해당 화면 딥링크 버튼(제안서 작성, 서류 체크 등)을 붙인다.
- 이 가이드는 회의록 카드뿐 아니라 **모든 상태변경 알림 카드에 공통 적용**(05 §카드 규약에 추가).

### 3-6. 후속 메일 초안 자동 생성
- 요약 직후 Claude가 회의록 기반 follow-up 메일 초안 생성 → email_drafts(kind=followup, status=draft).
  - 톤: 정중한 비즈니스 한국어. 구성: 감사 → 논의 요약 2~3줄 → 합의된 다음 스텝 → **마케팅 설문 링크(14-A: /s/{token} 자동 생성·포함)** → 관련 자료 링크(플랜별) → 미팅 재예약 링크.
  - 플랜별 자료 링크는 settings 템플릿에서 관리(04 §7).
  - **QnA 자동 매칭 (v3 보강 — 14-E 연동)**: 회의록의 "우려/반대 포인트"·질문성 발화를 추출해 `qna_entries`에서 유사 항목 검색(카테고리+키워드).
    - 매칭됨(approved=true) → 해당 답변을 메일 초안의 "문의 주신 내용" 섹션에 포함 + usage_count++.
    - 매칭 없음(새 질문) → 초안에 `[답변 필요: …]` 플레이스홀더로 표시(그대로는 발송 불가 — 담당이 채워야 승인 버튼 활성화) + qna_entries에 approved=false 후보로 자동 등록 → 담당이 답을 쓰고 발송하면 그 답이 QnA 후보 답변으로 저장, 파트장 승인 시 지식화.
    - 효과: 미팅에서 나온 질문이 메일에서 누락되지 않고, 반복 질문은 회를 거듭할수록 자동으로 채워진다.
- **Slack 카드**(담당 DM + 유입/영업 채널): 회의록 요약 + [메일 미리보기·수정] [승인·발송] [발송 안함] 버튼.
  - 승인 → Resend 발송(RESEND_FROM) → status=sent → `contact_logged(email)` 자동 기록.
  - 24시간 미처리 시 T1 리마인드(03 사다리 재사용).

## 4. MCP 툴 추가 (06 확장)

```ts
list_meetings({brand_id?, status?, unmatched_only?}) → {meetings[]}
get_meeting({meeting_id}) → {meeting, transcript?, summary_md}
match_meeting({meeting_id, brand_id}) → 수동 매칭
draft_followup({meeting_id, tone?, extra_points?}) → email_drafts 재생성
send_followup({draft_id}) → 승인·발송 (사람 승인 정책상 v1은 Slack 버튼만 허용 권장)
```

## 5. env 추가

```
ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET / ZOOM_WEBHOOK_SECRET
OPENAI_API_KEY (또는 GROQ_API_KEY)   # Whisper STT
ANTHROPIC_API_KEY                     # 요약·메일 초안
BLOB_READ_WRITE_TOKEN (또는 S3_*)     # 녹음 보관
```

## 6. 완료 기준
- [ ] meeting.created → scheduled 행 생성 + host_admin_id 매핑 + 캘린더 뷰 표시 + D-1 리마인더
- [ ] 노쇼(24h 녹화 미수신) 감지 → 재예약 카드
- [ ] Zoom URL validation + 서명 검증 통과, recording.completed 수신 시 멱등 저장
- [ ] 한국어 상담 녹화 1건이 전사→요약→brand 매칭→contact_logged까지 자동 처리
- [ ] meeting→contact 게이트가 회의록 자동 기록으로 충족됨(수동 입력 불필요)
- [ ] 후속 메일 초안이 Slack 카드로 도착, 승인 시 실제 발송 + 기록
- [ ] unmatched 미팅이 수동 매칭 큐에 나타나고 모달로 연결 가능
- [ ] 녹취 보관기간·접근권한 정책 적용
