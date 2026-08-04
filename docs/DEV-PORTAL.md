# GloveK 운영 어드민 — 개발 현황 & 연동 가이드

> TikTok Shop 대행사 CRM "원장(ledger)". Next.js 15 App Router · TypeScript · raw pg SQL · Tailwind · Vercel + Neon Postgres(glovek.space 공유).
> **이 문서는 매일 자정(KST) 자동 업데이트됩니다.** 변경 로그는 [DEV-CHANGELOG](./DEV-CHANGELOG.md) 참고.

---

## 1. 한눈에 보기

- **목적**: 리드 유입 → 세미나/미팅 → 계약 → 서류 → 셋업 → 운영/정산까지 한 원장에서 관리 + 자동화(문자·메일·Slack·AI).
- **배포**: Vercel (`tiktokadmin.vercel.app`), DB는 Neon Postgres(glovek.space와 공유).
- **원칙**:
  - glovek 기존 테이블(users·orders·payments·onboarding_* 등)은 **읽기 전용**. 쓰기는 `assertNotGlovekWrite` 가드로 차단.
  - 상태 전이는 **게이트 엔진**(`lib/gates.ts`) 통과해야 함(422 on fail).
  - enum 값은 `lib/types.ts`·`lib/states.ts` 정본만 사용.
  - 중복 방지는 `lib/dedup.ts`(email→별칭→phone→biz_no→name+url).
  - 민감정보(카드·신분증·비번)는 저장/로그/AI 컨텍스트 금지. 시크릿은 env 만.
  - 시간은 DB=UTC, 표시·SLA=KST. 테스트 데이터는 `is_test=true`로 격리.

## 2. 퍼널(상태 흐름)

```
lead_new → seminar → meeting → contact → contract_review → contract_done
        → docs → setup → (live_mall | live_onboarding) → settling
        + dropped / churned (종료)
```
- 계약 유형(`contract_type`): `mall` | `onboarding` | `marketing`
- 게이트 예: `docs→setup`(서류 전체완료+사업자번호), `setup→live_*`(계약유형 일치+광고담당+등급 5지표).

## 3. 아키텍처 맵

| 레이어 | 위치 |
|---|---|
| 도메인 코어 | `lib/types.ts` `lib/states.ts` `lib/gates.ts` `lib/transition.ts` |
| 유입(ingest) | `lib/ingest.ts` `app/api/ingest/[event]` `app/api/leadhook` `app/api/meta/leadgen` |
| 백필/동기화 | `lib/backfill.ts` `app/api/admin/backfill` `app/api/cron/glovek-sync` |
| 발송 | `lib/drafts.ts`(메일 초안·승인·발송) `lib/mailer.ts`(Gmail/Resend) `lib/sms.ts`(ALIGO) `lib/gmail-client.ts` |
| 유입 채널 | `lib/intake-channels.ts` `components/ChannelManager.tsx` |
| 자동안내 | `lib/welcome.ts`(전역) · 채널별은 `sendChannelWelcome` |
| 미팅(Zoom) | `lib/meetings.ts` `lib/meeting-invite.ts`(ICS) `app/api/zoom/webhook` |
| 이메일 수집 | `lib/gmail-client.ts`(도메인 위임) `lib/email-sync.ts` `lib/shared-mailboxes.ts` |
| Slack/AI | `lib/slack.ts` `app/api/slack/*` `docs/slack-manifest.yaml` · MCP/agents |
| 화면 | `app/(dash)/*/page.tsx` · 컴포넌트 `components/*.tsx` |

## 4. 외부 API 연동 현황

| 연동 | 용도 | 필요 env | 상태 |
|---|---|---|---|
| **ALIGO** | 문자(SMS/LMS) 발송 | `ALIGO_API_KEY` `ALIGO_USER_ID` `ALIGO_SENDER` `ALIGO_TEST_MODE` | 프록시 경유 필수 |
| **Fixie** | ALIGO 고정 IP 프록시 | `FIXIE_URL`(또는 `ALIGO_PROXY_URL`) | ALIGO에 IP 등록 |
| **Gmail** | 공용 메일함 수집 + 발송/임시저장 | `GOOGLE_SA_KEY_JSON` | 도메인 위임(readonly+compose) + Gmail API 사용설정 |
| **Resend** | 메일 폴백 발송 | `RESEND_API_KEY` `RESEND_FROM` | 도메인 인증 필요(Gmail 우선이라 선택) |
| **Zoom** | 미팅 링크·녹화·요약 | `ZOOM_ACCOUNT_ID` `ZOOM_CLIENT_ID` `ZOOM_CLIENT_SECRET` `ZOOM_WEBHOOK_SECRET` | S2S OAuth + admin 스코프 |
| **Meta Lead Ads** | 광고 리드 자동 유입 | `META_VERIFY_TOKEN` `META_PAGE_ACCESS_TOKEN` `META_APP_SECRET` | 직접 웹훅(개발자앱) |
| **Zapier/외부DB** | 커넥터 리드 유입(개발자앱 불필요) | `LEADHOOK_SECRET`(또는 채널키) | `/api/leadhook` POST |
| **Slack** | 유입·SLA·결재 알림, 자연어 질의 | `SLACK_BOT_TOKEN` `SLACK_SIGNING_SECRET` `SLACK_CH_*` | 매니페스트로 앱 생성 |
| **Anthropic** | AI 요약·회신 초안 | `ANTHROPIC_API_KEY` `ANTHROPIC_MODEL` | |
| **OpenAI/Groq** | STT·보조 | `OPENAI_API_KEY` 또는 `GROQ_API_KEY` | |

## 5. 유입(리드) 경로 3종

1. **메타 웹훅 직접** — `/api/meta/leadgen` (Meta 개발자앱 + `leadgen` 구독).
2. **커넥터(Zapier/Make/외부DB)** — `/api/leadhook?key=<시크릿|채널키>` POST. 개발자앱 불필요.
   - 필드 자동 매핑: `email` `phone` `name`(이름) `company`(회사명) `lead_id` `website`. 키는 대소문자·공백·언더스코어 무시.
   - Data 매핑이 어려운 커넥터는 URL 쿼리스트링(`&email=...&phone=...`)도 인식.
3. **유입 채널(주제별)** — 어드민 `/settings → 유입 채널`에서 채널 생성 → **채널 전용 POST URL** 발급.
   - 채널마다 **문자·메일 템플릿 + 실시간 on/off 토글**. 채널키로 들어오면 그 채널 내용으로 자동 발송.

→ 유입 즉시 자동 문자·메일: 전역은 `/settings → 신규 리드 자동 안내`(소스 화이트리스트), 채널은 채널 토글.

## 6. 발송 경로

- **인바운드 회신** → 고객이 보낸 그 공용 메일함 명의로 Gmail 발송(스레드 이어붙임).
- **아웃바운드(팔로업·자동안내·미팅초대)** → **기본 발신 메일함**(Gmail) → 실패 시 Resend 폴백.
- **문자** → ALIGO(Fixie 프록시 경유 고정 IP).
- **수신동의 게이트**: 개별 1:1(팔로업·회신·제안서·수동)은 통과, 광고성 대량(campaign·newsletter 등)만 동의 필요.

## 7. 주요 관리 엔드포인트 (토큰: `?token=<CRON_SECRET>`)

| 엔드포인트 | 용도 |
|---|---|
| `/api/health` | 연동 감지(boolean) + DB·지연 진단 |
| `/api/admin/migrate` | 마이그레이션 적용(`&force=1` 재적용, 진단 포함) |
| `/api/admin/bootstrap` | 마이그레이션 + 관리자 시드 + 초기 비번(`&seed=0` 더미 제외) |
| `/api/admin/backfill?source=glovek` | glovek DB → 원장 병합(1회) |
| `/api/admin/testdata?op=mark\|purge\|count` | 현재 데이터 더미표시 / 더미삭제 / 현황 |
| `/api/admin/leadcheck` | 메타/커넥터 리드 유입·자동발송 확인(마스킹) |

## 8. 로그인 / 관리자

- 비밀번호 로그인(scrypt). `/login`.
- 최초: `ADMIN_ALLOWED_EMAILS`(허용 이메일) + `ADMIN_BOOTSTRAP_PASSWORD`(초기 비번) env → `bootstrap` 실행 → 로그인 → `/settings`에서 비번 변경·팀원 추가.

## 9. 환경변수 총람

- **DB**: `DATABASE_URL`(또는 `POSTGRES_URL`), `GLOVEK_DB_URL_RO`(선택)
- **보안/세션**: `INGEST_SECRET` `LEADHOOK_SECRET` `ADMIN_SESSION_SECRET` `ADMIN_ALLOWED_EMAILS` `ADMIN_BOOTSTRAP_PASSWORD` `CRON_SECRET`
- **문자**: `ALIGO_API_KEY` `ALIGO_USER_ID` `ALIGO_SENDER` `ALIGO_TEST_MODE` `FIXIE_URL`/`ALIGO_PROXY_URL`
- **메일**: `GOOGLE_SA_KEY_JSON` `RESEND_API_KEY` `RESEND_FROM`
- **Zoom**: `ZOOM_ACCOUNT_ID` `ZOOM_CLIENT_ID` `ZOOM_CLIENT_SECRET` `ZOOM_WEBHOOK_SECRET`
- **메타**: `META_VERIFY_TOKEN` `META_PAGE_ACCESS_TOKEN` `META_APP_SECRET`
- **Slack**: `SLACK_BOT_TOKEN` `SLACK_SIGNING_SECRET` `SLACK_CH_INTAKE|ONBOARD|ADS|PAY|LEADS|DAILY`
- **AI**: `ANTHROPIC_API_KEY` `ANTHROPIC_MODEL` `OPENAI_API_KEY`/`GROQ_API_KEY`
- **기타**: `ADMIN_URL` `SHORTLINK_BASE` `MCP_TOKEN`

## 10. 배포/운영 절차

1. 코드 푸시 → Vercel 자동/수동 **Redeploy**.
2. 새 마이그레이션 있으면 `/api/admin/migrate?token=<CRON_SECRET>`.
3. env 추가/변경 시 반드시 Redeploy(런타임 반영).
4. cron(vercel.json): SLA·에스컬레이션·에이전트·미팅처리·gmail수집·glovek동기화·정산사이클.

## 11. 관련 문서

- 기획 확정: `docs/PLAN-기획확정.md`
- 키 발급 가이드: `docs/KEYS-발급가이드.md`
- 잔여 작업: `docs/BACKLOG-잔여작업.md`
- 성능: `docs/PERF-로딩속도.md`
- 에이전트 운영: `docs/AGENTS-운영가이드.md`
- 사이트 연동: `docs/integration/*.md`
- Slack 매니페스트: `docs/slack-manifest.yaml`
- **변경 로그: `docs/DEV-CHANGELOG.md`**


---

# GloveK 어드민 — 개발 변경 로그 (Changelog)

> 매일 자정(KST) 자동 갱신. 그날 커밋이 있으면 요약 항목을 추가하고, 없으면 "변경 없음"으로 기록합니다.
> 상세 개발 가이드는 [DEV-GUIDE](./DEV-GUIDE.md).

---

## 2026-08-04 (최초 작성)

이 문서 체계를 오늘 최초로 만들었습니다. 오늘까지의 최근 주요 작업:

### 🔌 유입/커넥터
- **주제별 유입 채널 관리 시스템** 신규 — 어드민에서 채널(주제)별 전용 POST URL 발급, 채널마다 문자·메일 템플릿 + 실시간 on/off 토글. (`intake_channels`, `/api/leadhook?key=<채널키>`)
- **커넥터 리드훅**(`/api/leadhook`) — 메타 개발자앱 없이 Zapier/Make/외부DB에서 리드 유입. 필드 키 정규화(대소문자·공백·언더스코어 무시), URL 쿼리스트링 매핑, `website→brand_url`, `occurred_at` 자동.
- **메타 Lead Ads 직접 웹훅**(`/api/meta/leadgen`) + 리드 유입 시 자동 문자·메일.
- **리드 유입 확인** 진단 엔드포인트(`/api/admin/leadcheck`, 마스킹).

### 📧 이메일
- **Gmail 지정 메일함 발송 + 임시저장**(gmail.compose 위임) — 인바운드 회신은 받은 메일함으로, 아웃바운드는 **기본 발신 메일함**으로 통일(Resend 없이). ICS 미팅초대 첨부 지원.

### 📱 문자
- **ALIGO 발송 프록시(Fixie) 경유 버그 수정** — 고정 IP로 실발송. `FIXIE_URL` 자동 폴백.

### 🧹 데이터/거버넌스
- **더미데이터 격리/삭제**(`/api/admin/testdata`) + 실데이터 소스 유입 시 자동 승격.
- **glovek 실시간 동기화 크론**(15분).
- **수신동의 게이트** 정비 — 개별 1:1(팔로업·회신·수동)은 통과, 광고성 대량만 동의 필요. 어드민 수신동의 토글.

### ✅ 품질(QA 하드닝)
- 6역할 다중 에이전트 QA로 27건 검증 → 26건 수정: 결재 전이 정합, 고객 필터 서버측, 마케팅 제안서 격리, 초안 이중발송 방지, 홈 쿼리 병렬화, 인덱스 추가, 캠페인 버튼 정합, import 서류템플릿 등.
- `email_drafts.status` 제약 확장(발송 예외 해결).

### 🔗 연동/문서
- Slack 앱 매니페스트, API 키 발급 가이드, 개발 가이드/변경 로그(본 문서) 신설.

---
<!-- 자동 갱신 지점: 새 날짜 항목은 이 줄 위에 추가됩니다. -->
