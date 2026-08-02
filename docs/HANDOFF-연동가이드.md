# GloveK 운영 어드민 · 외부 연동 핸드오프 (운영자용 + 사이트 개발자 프롬프트)

> 이 문서 하나로 **내(운영자)가 할 일** + **각 사이트 개발자에게 줄 프롬프트**를 모두 처리한다.
> 어드민 배포 URL: `https://tiktokadmin.vercel.app` · 원장은 어드민이 소유(사이트는 이벤트를 "보내기만").

---

## PART A — 내가(운영자) 할 일 체크리스트

### A-1. 어드민 자체 (필수, 1회)
- [ ] **Vercel 환경변수 세팅** (Settings → Environment Variables) — 아래 표 참고
- [ ] 배포 후 **부트스트랩 1회**: `https://tiktokadmin.vercel.app/api/admin/bootstrap?token=<CRON_SECRET>` (마이그레이션+더미데이터)
- [ ] 실데이터 적재: `brands_master_v0.csv` → `/import` 또는 backfill (631건)
- [ ] 담당자·팀 시드: `admin_users`(30~40명) + `teams` + Slack ID 매핑

### A-2. 필수 환경변수 (Vercel)
| 변수 | 용도 | 누가 발급 |
|---|---|---|
| `DATABASE_URL` (또는 `POSTGRES_URL`) | Neon 공유 Postgres (glovek와 동일 DB) | Neon |
| `INGEST_SECRET` | 사이트→어드민 수신 인증(공유 시크릿) | **내가 생성해 3사이트에 전달** |
| `ADMIN_SESSION_SECRET` | 어드민 로그인 세션 서명 | 내가 아무 문자열 |
| `ADMIN_ALLOWED_EMAILS` | 로그인 허용 이메일(콤마) | 내가 |
| `CRON_SECRET` | 크론·migrate·seed·bootstrap 보호 | 내가 아무 문자열 |
| `ADMIN_URL` | 매직링크·설문 링크 절대주소 | `https://tiktokadmin.vercel.app` |

### A-3. 선택 환경변수 (기능별 — 넣으면 자동 활성화)
| 변수 | 기능 | 발급처 |
|---|---|---|
| `SLACK_BOT_TOKEN` `SLACK_SIGNING_SECRET` `SLACK_CH_*` | Slack 알림·명령·액션 | Slack App (PART C) |
| `ANTHROPIC_API_KEY` | AI 회의록 요약·메일 초안·`/ask` | Anthropic |
| `ZOOM_ACCOUNT_ID` `ZOOM_CLIENT_ID` `ZOOM_CLIENT_SECRET` `ZOOM_WEBHOOK_SECRET` | 줌 미팅 자동화 | Zoom S2S App |
| `OPENAI_API_KEY`(또는 `GROQ_API_KEY`) | Whisper 전사(한국어) | OpenAI/Groq |
| `GOOGLE_SA_KEY_JSON` | Gmail 도메인위임 수집 | Google Cloud + Workspace |
| `RESEND_API_KEY` `RESEND_FROM` | 메일 발송 | Resend |
| `ALIGO_API_KEY` `ALIGO_USER_ID` `ALIGO_SENDER` `ALIGO_TEST_MODE` `ALIGO_PROXY_URL` | 문자(SMS/LMS) 발송 | Aligo |

### A-4. 외부 앱 생성(각 1회) — 상세는 PART C·D
- [ ] Slack App 생성(매니페스트) + 토큰·채널 세팅
- [ ] Zoom Server-to-Server OAuth 앱 + 웹훅 등록
- [ ] Google Cloud 서비스계정 + Workspace 도메인 위임 승인
- [ ] Resend 도메인 인증(SPF/DKIM)
- [ ] Aligo 발신번호 등록 + (Vercel 무고정IP 대응) 발송IP 비우기 또는 고정IP 프록시
- [ ] 사이트 3곳에 `INGEST_SECRET` + 어드민 URL 전달 → PART B 프롬프트로 개발 요청

---

## PART B — 사이트 개발자에게 줄 프롬프트 (복붙)

> 📌 **아래는 빠른 요약본입니다. 개발자에게 실제로 전달할 정본은 `docs/integration/{site}.md`** (payload 전문·구현 예시·curl 테스트 포함). 값이 다르면 integration/ 문서를 따릅니다.
> 3사이트 공통: 서버사이드에서만 호출, 사용자 응답 막지 않는 **fire-and-forget**, 실패해도 사이트 UX엔 영향 없음.
> URL 정본: `https://tiktokadmin.vercel.app`(하드코딩 금지, env `ADMIN_INGEST_URL`).

### 공통 전송 규격 (모든 이벤트)
```
POST {ADMIN_INGEST_URL}/api/ingest/{event}
Headers:
  X-Ingest-Secret:   {INGEST_SECRET}        # 불일치 401
  X-Idempotency-Key: <원본PK 기반 고유키>     # 필수. 재전송 시 200 {dedup:true}
  Content-Type: application/json
Body 공통:
  site, occurred_at(UTC ISO), email, phone, biz_no, brand_name, brand_url,
  contact_name, category, source_ref(원본PK), source_url(딥링크)
event ∈ lead | diagnosis | payment | doc_progress | contact_logged | onboarding
```

### B-1. glovek.space 개발자 프롬프트
```
너는 glovek.space(Next.js/Postgres) 개발자다. 우리 운영 어드민의 Ingest API로
glovek의 리드·상담·자가진단·멀티몰 결제 이벤트를 서버사이드 fire-and-forget 로 전송하라.
- 수신 URL: https://tiktokadmin.vercel.app/api/ingest/{event}
- 헤더: X-Ingest-Secret: <전달받은 INGEST_SECRET>, X-Idempotency-Key: <원본PK>, Content-Type: application/json
- 전송 지점:
  1) 상담 신청 접수 → POST /lead  body{site:"glovek", source:"glovek_consult", email,phone,brand_name,contact_name,category,brand_url, occurred_at, source_ref:상담PK}
  2) 문의/뉴스레터 → POST /lead  source:"glovek_inquiry"
  3) 회원가입 → POST /lead  source:"glovek_signup", source_ref:users.id, 그리고 body 에 glovek_user_id 포함
  4) 셀프 자가진단 제출 → POST /diagnosis  body{...공통, grade:"S|A|B|C", rec_track:"onboarding|live", countries:["미국",...], glovek_onb_id?}  (등급은 glovek gradeFromChecks 결과 그대로)
  5) 멀티몰 결제 웹훅 → POST /payment  body{...공통, pay_kind:"subscribe_first|subscribe_renew|cancel", plan:"live_focus_490k|pro_89k|guarantee_1m", amount, result:"ok|fail", pg_ref, glovek_user_id}
  6) (선택) 담당자↔고객 접촉 로그 → POST /contact_logged body{channel:"call|email|meeting", note}
- 멱등키는 "이벤트종류:원본PK" 형식으로 안정적으로 생성. email 은 소문자, phone/biz_no 는 숫자만 보내도 됨(어드민이 정규화).
- glovek 기존 테이블은 어드민이 읽기전용으로 접근하므로 스키마 변경 불필요. 너는 "보내기"만 구현.
- 실패 시 1회 재시도(멱등키로 재전송 안전 — 필요 시 최대 3회 지수백오프) 후 로컬 로그, 사용자 응답은 절대 지연시키지 마라.
```

### B-2. apply.tpartners.live 개발자 프롬프트
```
너는 apply.tpartners.live(입점/온보딩 신청) 개발자다. 운영 어드민 Ingest 로 전송하라.
- URL/헤더는 공통 규격과 동일(site:"apply").
- 전송 지점:
  1) 입점/상담 신청 → POST /lead  source:"apply_consult"(즉시 상담)|"apply_seminar"|"apply_qna"|"apply_smr", email,phone,biz_no,brand_name,contact_name,category, source_ref:신청PK
  2) 온보딩 서류 진행(Step1~5 저장/승인/반려 시) → POST /doc_progress
     body{...공통, apply_app_id:신청서PK, step_no:1~5, step_status:"submitted|approved|rejected"}
  3) 온보딩 일회 결제 완료 → POST /payment  body{pay_kind:"once", plan:"onboarding_onetime", amount, pg_ref, apply_customer_id}
  4) (v3) Step4 제품·국가 인증 저장 시 → POST /doc_progress 에 제품·국가별 인증요약 포함(product_sync 확장) — 어드민 담당과 필드 협의
- 창고(warehouses) 정보가 있으면 doc_progress payload 에 요약 포함(어드민이 물류계약으로 반영).
- 멱등키: "doc:{apply_app_id}:{step_no}:{status}" 처럼 상태 전이마다 고유.
```

### B-3. tpartners.live 개발자 프롬프트
```
너는 tpartners.live(세미나·전자책 랜딩) 개발자다. 운영 어드민 Ingest 로 리드만 전송하라.
- URL/헤더 공통(site:"tpartners").
- 전송 지점:
  1) 세미나 신청 → POST /lead  source:"tp_seminar", email,phone,brand_name,contact_name, source_ref:신청PK
  2) 전자책 다운로드(리드폼) → POST /lead  source:"tp_ebook"
- 세미나 미전환 리드는 어드민이 재활성화 캠페인 대상으로 관리하므로, 신청 즉시 1건씩 보내기만 하면 된다.
```

---

## PART C — Slack 연동

1. **Slack App 생성** (api.slack.com/apps → From manifest). 스코프: `chat:write`, `commands`, `users:read`, `im:write`.
2. **Slash Commands**: `/ask`, `/brand`, `/queue` → Request URL `https://tiktokadmin.vercel.app/api/slack/commands`
3. **Interactivity & Events**: Request URL `https://tiktokadmin.vercel.app/api/slack/actions` (버튼), Event `https://tiktokadmin.vercel.app/api/slack/events` (app_mention)
4. **환경변수**: `SLACK_BOT_TOKEN`(xoxb-), `SLACK_SIGNING_SECRET`, 채널 ID: `SLACK_CH_INTAKE/ONBOARD/ADS/PAY/LEADS/DAILY`
5. **담당자 매핑**: `admin_users.slack_user_id` 에 각자 Slack ID 등록(멘션·DM 라우팅 키)
6. **스케줄 에이전트 5종**: `docs/AGENTS-REGISTER.md` 프롬프트를 스케줄 작업으로 등록(일일 점검·서류 리마인더·결제 감시·주간 자가학습·사전분석)

---

## PART D — 기타 외부 연동

### D-1. Zoom (미팅 자동화 · docs/spec/08)
- 유료계정 Cloud Recording(M4A) ON + 녹화 고지 배너.
- Server-to-Server OAuth 앱: scope `cloud_recording:read`,`meeting:read`,`user:read`.
- 웹훅 → `https://tiktokadmin.vercel.app/api/zoom/webhook`, 이벤트 `recording.completed`(필수)·`meeting.created/updated/deleted`. `ZOOM_WEBHOOK_SECRET` 로 서명 검증.
- 담당자 매핑: `admin_users.zoom_email` 등록(host_email→담당 자동 배정 키).
- 전사는 Whisper(OPENAI/GROQ), 요약·메일초안은 ANTHROPIC.

### D-2. Gmail 수집 (도메인 위임 · docs/spec/09)
- Google Cloud 프로젝트 → 서비스계정 생성 → JSON 키를 `GOOGLE_SA_KEY_JSON` 에.
- Workspace 관리콘솔에서 **도메인 전체 위임** 승인, scope `https://www.googleapis.com/auth/gmail.readonly`.
- 수집 대상: `admin_users.gmail_sync_enabled=true` 계정. 크론 `/api/cron/gmail-sync` 가 브랜드 매칭 메일만 저장(개인메일 폐기).
- 팀 공지·동의 필수(회사계정 브랜드 메일이 CRM에 기록됨).

### D-3. Resend (메일 발송)
- 도메인 인증(SPF/DKIM). `RESEND_API_KEY`, `RESEND_FROM="GloveK <onboarding@dinostudio.kr>"`.
- 초안함(/drafts)·AI 메일초안 승인 시 발송. 광고성은 수신동의 게이트 자동.

### D-4. Aligo (문자 발송)
- 발신번호 사전등록. `ALIGO_API_KEY`,`ALIGO_USER_ID=dinostudio`,`ALIGO_SENDER=발신번호`. 처음엔 `ALIGO_TEST_MODE=Y`.
- **발송 IP**: Vercel은 고정 출구IP 없음 → Aligo 발송IP를 **비워두기(전체허용)** 또는 고정IP 프록시(QuotaGuard/Fixie) URL을 `ALIGO_PROXY_URL` 에.
- ⚠️ 채팅에 노출된 키는 **재발급** 권장.

---

## 부록 — Ingest 응답 & 크론
- 응답: 신규 `{ok:true, brand_id, created:true}` · 멱등 `{ok:true, dedup:true}` · 매칭 `{created:false, brand_id}` · 검증실패 400 · 인증실패 401
- dedup 순서: email → phone → biz_no → brand_name+url → aliases
- 크론(Vercel Cron, Bearer `CRON_SECRET`): `/api/cron/sla-check` `/escalate` `/gmail-sync` `/meeting-process` `/cycle-open` `/cycle-watch` `/cycle-close`
- 상세 원문: `docs/integration/{glovek.space,apply.tpartners.live,tpartners.live}.md`, `docs/spec/07-SITE-INTEGRATION.md`
