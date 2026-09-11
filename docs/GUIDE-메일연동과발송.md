# 메일 연동·발송 가이드 (Google Workspace)

우리 어드민이 회사 메일함을 읽고(수집) 보내는(발송·임시저장·대량발송) 방식 그대로를 정리한 문서입니다.
다른 팀/다른 서비스에서 같은 구조를 만들 때 이 순서대로 진행하면 됩니다.

> 1~7장: 연동(수집·인증) · **8장: 발송 구조** · 9장: 체크리스트

---

## 0. 한 줄 요약

**사용자 OAuth 동의 화면을 쓰지 않습니다.** Google Workspace의
**서비스 계정 + 도메인 전체 위임(Domain-Wide Delegation)** 으로, 서버가 회사 계정을
대신(impersonate)해 Gmail API를 호출합니다.

| | 우리 방식 | 일반 OAuth |
|---|---|---|
| 사용자 로그인 | **불필요** | 계정마다 동의 필요 |
| 리프레시 토큰 | **없음**(매번 JWT로 발급) | 저장·갱신 필요 |
| 계정 추가 | 어드민 화면에서 주소만 등록 | 그 계정 소유자가 직접 동의 |
| 전제 조건 | **Workspace 관리자 권한 필요** | 개인 Gmail도 가능 |

개인 Gmail(@gmail.com)에는 쓸 수 없습니다. 회사 도메인(Workspace)이어야 합니다.

---

## 1. 왜 이 방식인가

- 팀원이 늘어도 **각자 동의를 받을 필요가 없다** — 관리자가 도메인에서 한 번 허용하면 끝.
- 퇴사·비밀번호 변경에도 **토큰이 깨지지 않는다**(리프레시 토큰 자체가 없음).
- `sales@`, `support@` 같은 **공용 메일함**을 사람 계정과 똑같이 다룰 수 있다.
- 대신 **권한이 세다** — 도메인 내 지정 스코프 범위에서 모든 계정을 열 수 있으므로
  키 관리가 곧 보안의 전부다(§6).

---

## 2. Google Cloud 설정 (약 10분)

1. **GCP 프로젝트 생성** — console.cloud.google.com
2. **Gmail API 사용 설정** — API 및 서비스 → 라이브러리 → "Gmail API" → 사용
3. **서비스 계정 생성** — IAM 및 관리자 → 서비스 계정 → 만들기
   - 역할 부여 **불필요**(GCP 리소스 권한이 아니라 Workspace 위임으로 동작)
4. **키 발급** — 만든 서비스 계정 → 키 → 키 추가 → 새 키 만들기 → **JSON** → 다운로드
5. 받은 JSON에서 **`client_id`** 값을 메모(다음 단계에서 사용).
   서버가 실제로 쓰는 값은 `client_email` 과 `private_key` 두 개입니다.

---

## 3. Workspace 도메인 전체 위임 (관리자만 가능)

**admin.google.com** → 보안 → 액세스 및 데이터 제어 → **API 제어** →
**도메인 전체 위임** → 새로 추가

- **클라이언트 ID**: 2단계에서 메모한 서비스 계정 `client_id`
- **OAuth 범위**(쉼표로 구분, 우리가 쓰는 것 그대로):

```
https://www.googleapis.com/auth/gmail.readonly,
https://www.googleapis.com/auth/gmail.compose
```

| 스코프 | 쓰임 |
|---|---|
| `gmail.readonly` | 메일 수집(목록·본문·첨부 읽기) |
| `gmail.compose` | 임시보관함(초안) 생성, 메일 발송 |

> **주의**: 스코프는 **딱 필요한 것만** 넣습니다. `gmail.modify` 나 `mail.google.com`
> (전체 권한)은 넣지 마세요 — 읽기·작성만으로 충분하고, 사고 시 피해 범위가 달라집니다.
> 위임 설정은 반영에 **수 분** 걸릴 수 있습니다.

---

## 4. 서버 환경변수

```bash
# 서비스 계정 키 JSON "전체"를 한 줄로 넣습니다(작은따옴표로 감싸기).
GOOGLE_SA_KEY_JSON='{"type":"service_account","client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n", ...}'
```

- `private_key` 안의 **`\n` 은 이스케이프된 상태 그대로** 두면 됩니다(`JSON.parse` 가 실제 줄바꿈으로 복원).
- Vercel 등에 넣을 때 줄바꿈이 실제 개행으로 들어가면 서명이 깨집니다 — **한 줄 유지**.
- 이 값이 **없으면 연동 전체가 자동으로 꺼집니다**(수집 스킵, 나머지 기능은 정상 동작).

---

## 5. 서버 구현 (핵심 로직)

외부 SDK(googleapis) 없이 **JWT 서명 + REST 호출** 두 단계뿐입니다.

### 5-1. 액세스 토큰 발급 (계정 대신하기)

```ts
// 1) JWT 조립 — sub 가 "대신할 계정"
const claim = {
  iss: sa.client_email,   // 서비스 계정
  sub: "sales@회사도메인",  // ★ 이 계정으로 행세한다
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  aud: "https://oauth2.googleapis.com/token",
  iat: now, exp: now + 3600,
};
// 2) RS256 서명 (private_key)
const jwt = `${b64url(header)}.${b64url(claim)}.${b64url(sign)}`;
// 3) 토큰 교환
POST https://oauth2.googleapis.com/token
  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>
// → { access_token }  (1시간 유효, 저장하지 않고 그때그때 발급)
```

핵심은 **`sub` 에 넣는 주소를 바꾸면 그 계정이 된다**는 점입니다. 계정별 토큰 저장이 없습니다.

### 5-2. Gmail REST 호출

토큰을 `Authorization: Bearer` 로 실어 `users/me`(= sub 계정)에 호출합니다.

| 기능 | 엔드포인트 |
|---|---|
| 목록 | `GET /gmail/v1/users/me/messages?q=newer_than:30d -in:spam -in:trash` |
| 본문 | `GET /gmail/v1/users/me/messages/{id}?format=full` |
| 첨부 | `GET /gmail/v1/users/me/messages/{id}/attachments/{attId}` |
| 발송 | `POST /gmail/v1/users/me/messages/send` (raw = base64url MIME) |
| 초안 | `POST /gmail/v1/users/me/drafts` |

발송·초안은 **`gmail.compose` 스코프로 토큰을 다시 발급**해서 호출합니다(읽기 토큰으로는 안 됨).

### 5-3. 수집 주기

- 크론(`/api/cron/gmail-sync`)이 주기적으로 **등록된 메일함을 순회**하며 최근 30일 메일을 가져옵니다.
- 가져온 메일은 발신·수신 주소로 **고객(브랜드)과 자동 매칭**해 적재하고, 이후
  무응답 감지·담당자 자동 전달·회신 초안 생성으로 이어집니다.
- 실시간이 필요하면 Gmail **watch + Pub/Sub 푸시**로 바꿀 수 있습니다(우리는 폴링으로 충분해 폴링 사용).

### 5-4. 메일함 등록

DB 테이블(`shared_mailboxes`)에 주소를 넣고 어드민 화면에서 켜고 끕니다.

```sql
email             text primary key  -- sales@회사도메인
label             text              -- 표시명
enabled           boolean           -- 수집 on/off
forward_to_owner  boolean           -- 수신 시 담당자 자동 전달
is_default        boolean           -- 아웃바운드 기본 발신함
```

**계정을 추가할 때 Google 쪽에서 할 일은 없습니다** — 도메인 위임이 이미 되어 있으므로
주소만 등록하면 즉시 동작합니다(단, 그 주소가 같은 Workspace 도메인이어야 함).

---

## 6. 보안 — 반드시 지킬 것

1. **서비스 계정 키 JSON = 도메인 마스터키.** 유출되면 지정 스코프 범위에서 회사 전 계정의
   메일을 읽을 수 있습니다. 절대 코드·깃·채팅에 넣지 말고 환경변수(시크릿)로만 관리하세요.
2. **스코프 최소화** — 읽기(readonly) + 작성(compose)까지만. `mail.google.com` 금지.
3. **키 로테이션** — 유출 의심 시 GCP에서 키 삭제 → 새 키 발급 → env 교체.
   (도메인 위임 설정은 `client_id` 기준이라 키만 바꾸면 그대로 동작합니다.)
4. **대신할 계정 제한** — `sub` 에 아무 주소나 넣을 수 있으므로, 코드에서 반드시
   **등록된 메일함 목록 안에서만** impersonate 하세요(임의 입력값을 그대로 넣지 말 것).
5. 감사 로그는 Workspace 관리 콘솔에서 서비스 계정 접근 기록으로 확인 가능합니다.

---

## 7. 점검 순서 (안 될 때)

| 증상 | 확인할 것 |
|---|---|
| 토큰 발급 실패 `unauthorized_client` | 도메인 위임 미반영(수 분 대기) · 클라이언트 ID 오타 · 스코프 문자열 불일치 |
| `invalid_grant` | `sub` 주소가 그 Workspace에 없음 · 서버 시계 오차 · `private_key` 줄바꿈 깨짐 |
| 토큰은 나오는데 403 | 위임 스코프에 해당 권한 없음(읽기만 넣고 발송 시도 등) |
| 수집 0건 | 메일함 `enabled=false` · 최근 30일 메일 없음 · 검색 쿼리 조건 |
| 발송만 실패 | `gmail.compose` 스코프 누락 |

가장 흔한 두 가지는 **① 스코프 문자열이 위임 설정과 한 글자라도 다른 경우**와
**② env에 넣은 private_key 줄바꿈이 깨진 경우**입니다.

---

## 8. 발송 구조

수집과 같은 서비스 계정·위임을 그대로 쓰고, 스코프만 `gmail.compose` 를 추가로 사용합니다.

### 8-1. 이중 경로 (Gmail 우선 → Resend 폴백)

```
sendEmail()
  ├─ ① Gmail 위임 발송 (기본)   → 회사 공용 메일함 명의로 나감
  │     실패 시 ↓
  └─ ② Resend API 폴백          → RESEND_API_KEY 있을 때만
```

**Gmail 을 1순위로 두는 이유**: 별도 도메인 인증(SPF/DKIM 설정) 없이도 `cs@회사도메인`
같은 **실제 메일함 명의**로 나가고, 보낸편지함에 그대로 남아 담당자가 웹 Gmail 에서
이어서 대응할 수 있습니다. Resend 는 Gmail 이 죽었을 때를 위한 보조 경로입니다.

```bash
# 폴백을 쓸 경우만 설정(선택)
RESEND_API_KEY=...
RESEND_FROM='회사명 <onboarding@회사도메인>'
```

둘 다 없으면 발송은 조용히 **skipped** 처리되고 기능은 죽지 않습니다.

### 8-2. 발신 주소 결정 순서

1. 호출부가 `from` 을 지정한 경우 → 그 메일함 (예: **받은 메일에 회신할 땐 받은 그 메일함**)
2. 미지정 → DB `shared_mailboxes` 의 **기본 발신 메일함**(`is_default=true`)
3. 결정된 주소가 곧 JWT 의 `sub` → 그 계정으로 발송

핵심: **발신 주소 = impersonate 대상**입니다. 그래서 등록된 메일함 목록 밖의 주소가
`from` 으로 들어가지 않도록 코드에서 막아야 합니다(§6-4).

### 8-3. 스레드 이어붙이기 (회신)

Gmail 발송 시 원문의 `threadId` 를 함께 넘기면 고객 메일함에서 **같은 대화로 묶입니다.**
회신 품질에 큰 차이가 나므로, 수집 때 `threadId` 를 반드시 저장해두세요.

```ts
POST /gmail/v1/users/me/messages/send
{ raw: <base64url MIME>, threadId: <원문 threadId> }
```

MIME 은 직접 조립합니다(SDK 없이): `From/To/Cc/Subject/In-Reply-To` 헤더 + 본문 →
base64url. 한글 제목은 반드시 **RFC 2047 인코딩**(`=?UTF-8?B?...?=`)하세요 — 안 하면 깨집니다.

### 8-4. 발송 전 공통 처리

| 처리 | 내용 |
|---|---|
| 공용 푸터 | 회사 서명 자동 부착(멱등 — 기존 서명은 제거 후 재부착) |
| 링크 치환 | 드라이브 링크 → 자체 쇼트링크(`/f/<token>`)로 바꿔 **클릭 추적** |
| 개인화 | 템플릿 `{브랜드명}`·`{담당자명}`·`{설문링크}` 치환 |

### 8-5. 초안 승인 → 발송 (이중 발송 방지)

사람이 승인해야 나가는 구조라, 동시 클릭으로 두 번 발송되는 사고를 DB 수준에서 막습니다.

```sql
-- draft → sending 을 한 번에 선점(원자적 클레임). 못 잡으면 이미 처리 중.
UPDATE email_drafts SET status='sending' WHERE id=$1 AND status='draft' RETURNING id
```

발송 실패 시 `draft` 로 되돌려 재시도할 수 있게 하고, 성공해야 `sent` 로 확정합니다.
**이 패턴은 꼭 가져가세요** — 승인 버튼 연타/새로고침으로 인한 중복 발송이 실제로 납니다.

### 8-6. 대량 발송

즉시 루프로 돌리지 않고 **큐 + 크론 워커**로 소비합니다.

```
bulk_sends(큐) ──크론──> processBulkSends() ──> 대상별 sendEmail / sendSms
                                                  ↓
                              bulk_send_targets.status/sent_at/error 기록
```

한 번에 처리할 건수 상한을 두고 나눠 보내며, 대상별 성공·실패를 개별 기록해
실패분만 재발송할 수 있게 합니다. 큐만 있고 소비자가 없으면 영구 미발송이 되니
**워커 크론 등록을 빠뜨리지 마세요**(우리가 실제로 겪은 사고입니다).

### 8-7. 발송 관련 점검

| 증상 | 확인할 것 |
|---|---|
| 발송 자체가 안 됨(에러도 없음) | 발신 메일함 미등록 · `GOOGLE_SA_KEY_JSON`·`RESEND_API_KEY` 둘 다 없음 |
| `403` 발송만 실패 | 위임 스코프에 `gmail.compose` 누락 |
| 한글 제목 깨짐 | 제목 RFC 2047 인코딩 누락 |
| 회신이 새 대화로 감 | `threadId` 미전달 |
| 같은 메일 2번 발송 | 원자적 클레임(§8-5) 미적용 |
| 큐에 쌓이기만 함 | 대량발송 워커 크론 미등록 |

---

## 9. 체크리스트

- [ ] GCP 프로젝트 + Gmail API 사용 설정
- [ ] 서비스 계정 생성 + JSON 키 발급, `client_id` 확보
- [ ] Workspace 관리 콘솔에서 도메인 전체 위임(클라이언트 ID + 스코프 2개)
- [ ] 서버 env `GOOGLE_SA_KEY_JSON` 한 줄로 설정
- [ ] 메일함 주소 등록 + 기본 발신 메일함 지정
- [ ] 수집 1회 실행 → 건수 확인
- [ ] 발송 테스트(초안 생성 → 승인 → 발송) + 회신 스레드 묶임 확인
- [ ] 대량 발송을 쓸 경우 워커 크론 등록 확인
