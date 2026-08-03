# API 키 발급 가이드

> 각 키 입력 → Vercel Redeploy → /api/health 의 integrations 에서 true 확인.

## 1. ANTHROPIC_API_KEY (AI 요약·회신·에이전트)
console.anthropic.com → API Keys → Create Key → Vercel `ANTHROPIC_API_KEY` + Billing 등록.

## 2. OPENAI_API_KEY 또는 GROQ_API_KEY (미팅 전사)
platform.openai.com → API keys → 생성(+크레딧). 무료 대안: console.groq.com → `GROQ_API_KEY`.

## 3. ZOOM_* (녹화 자동 처리 — 유료 Zoom)
marketplace.zoom.us → Develop → Server-to-Server OAuth 앱 →
`ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET` + Scopes(recording:read·meeting:read·user:read) +
Event Subscriptions(Recording Completed, URL /api/zoom/webhook, Secret→`ZOOM_WEBHOOK_SECRET`) → Activate.
Zoom 설정 Cloud Recording ON.

## 4. SLACK_* (알림·/ask)
api.slack.com/apps → From scratch → OAuth Scopes(chat:write·commands·users:read·im:write) →
Install → `SLACK_BOT_TOKEN`(xoxb) · Basic Info→`SLACK_SIGNING_SECRET` ·
Slash Commands(/ask·/brand·/queue → /api/slack/commands) · Interactivity(/api/slack/actions) ·
채널 ID → `SLACK_CH_INTAKE/ONBOARD/ADS/PAY/LEADS/DAILY` · 채널에 봇 초대.

## 5. META_* (리드 광고 직접 유입)
developers.facebook.com 앱 생성 → `META_VERIFY_TOKEN`(직접 정한 문자열) →
Webhooks→Page→leadgen 구독(콜백 /api/meta/leadgen) →
페이지 토큰(leads_retrieval)→`META_PAGE_ACCESS_TOKEN` · 앱 시크릿→`META_APP_SECRET`.

## 6. GOOGLE_SA_KEY_JSON (Gmail 수집)
GCP 프로젝트 → Gmail API 사용 → 서비스계정 생성 → JSON 키 다운로드(내용 전체를 env 로) →
Workspace admin.google.com → API 제어 → 도메인 전체 위임 → 클라이언트 ID + scope
`https://www.googleapis.com/auth/gmail.readonly` 승인(메일함 도메인별). /settings 공용 메일함 등록.

## 7. Neon pooled DATABASE_URL (로딩 속도 ★)
console.neon.tech → Connection Details → Pooled connection(-pooler 호스트) →
Vercel `DATABASE_URL` 교체(+`?sslmode=require`) + Vercel 리전=Neon 리전.

## 8. 직접 생성 값
`INGEST_SECRET`(사이트 공유) · `CRON_SECRET` · `ADMIN_BOOTSTRAP_PASSWORD`(6자+) ·
`SHORTLINK_BASE`(=Vercel 도메인 file.glovek.space 연결 후 https://file.glovek.space/f).

## 완료됨
ALIGO_*(+FIXIE_URL 자동 인식) · RESEND_API_KEY/RESEND_FROM.
