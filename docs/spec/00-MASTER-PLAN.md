# 00 · Glovek 운영 어드민 — 통합 마스터 플랜

> 이 문서는 전체 개발의 지도다. 실제 개발은 01~07 문서를 파트별로 Claude Code에 붙여넣어 진행한다.
> 근거: 3개 사이트 HANDOVER 실물(glovek.space / apply.tpartners.live / tpartners.live) + 확정된 운영 설계(마스터 설계서 v2).

---

## 1. 목표

마케팅 → 영업(결제) → 멀티몰/온보딩 분기 → 서류 수급 → 정기 운영 → 정산까지,
**모든 브랜드가 단 하나의 원장에서, 누락이 물리적으로 불가능하게, 최소 인원 + AI로** 관리되는 운영 시스템.

핵심 원칙 6:
1. **1 브랜드 = brands 테이블 1행.** 입력구는 여럿(사이트 3 + 영업)이어도 원장은 하나.
2. **상태값 하나로 전 퍼널.** 마케팅부터 정산까지 단일 state 머신.
3. **들어오면 즉시 분석.** 최소정보 강제 + 사전분석(크롤러·셀프진단) → 등급·트랙 자동.
4. **안 챙기면 시스템이 때린다.** 게이트(서버 강제) · SLA · 에스컬레이션.
5. **매주 스스로 정밀해진다.** 이벤트 이력 기반 자가학습.
6. **AI가 운전한다.** 전용 MCP + Slack 양방향 — 사람도 AI도 같은 게이트를 통과.

## 2. 아키텍처 (확정)

```
[glovek.space]──┐  (읽기전용 참조 + 실시간 ingest)
[apply.tpartners]─┼──▶ POST /api/ingest/<event> ──▶ ┌──────────────────────┐
[tpartners.live]──┘   (X-Ingest-Secret, 멱등)        │  공유 Postgres (원장)  │
                                                     │  · glovek 기존 테이블  │◀─ read-only
                                                     │  · 어드민 CRM 테이블   │◀─ 어드민만 쓰기
                                                     └──────────┬───────────┘
                          게이트 검증 ops API / MCP ◀────────────┤
        ┌───────────────────┬────────────────────────┬──────────┘
   [어드민 대시보드]     [Slack App(양방향)]     [Claude 에이전트/MCP]
```

- **원장**: glovek.space의 Postgres를 공유(같은 DB 인스턴스). 어드민은 신규 CRM 테이블만 쓰기, glovek 테이블은 읽기전용.
- **어드민 앱**: 별도 레포·별도 배포(내부 전용). glovek과 같은 스택(Next.js + TS)으로 재사용 극대화.
- **Slack App**: 어드민 앱이 백엔드 호스팅. 알림(아웃) + 버튼/슬래시(인) 양방향.
- **MCP 서버**: 어드민 앱 내 라우트 또는 사이드카. Claude 에이전트가 도메인 툴로 운전.
- **노션**: 원장 아님. (선택) 읽기 뷰 미러만.

## 3. 문서 인덱스 (00~18 완결) & 개발 순서

| # | 문서 | 내용 | 상태 |
|---|------|------|------|
| 01 | DB-SCHEMA | 스키마 v1 원본 (**v3 확정판은 코드 migrations/001·002 — 01 하단 부록 참조**) | 구현됨 |
| 02 | INGEST-API | PUSH 이벤트 6종·멱등·v3 필터 | 구현됨 |
| 03 | GATES-SLA | 상태머신·게이트·SLA(v3 실측값)·에스컬레이션 | 구현됨 |
| 04 | DASHBOARD | 화면 IA·공통 규약 (**M1~M7은 코어 기능 기획서가 우선**) | 부분 구현 |
| 05 | SLACK-APP | 슬래시·버튼·카드 | 기본 구현 |
| 06 | MCP-AGENTS | MCP 툴 + 에이전트 5종 (+확장 툴 노트) | 미구현 |
| 07 | SITE-INTEGRATION | 3사이트 연동 프롬프트+E2E (product_sync·refund 포함) | 사이트 작업 |
| 08 | ZOOM-MEETINGS | 줌 녹화→회의록→팔로업(+설문 링크) | 미구현 |
| 09 | EMAIL-ASSIGNMENT | Gmail 수집·담당 배정 엔진 | 부분 구현 |
| 10 | DATA-ASSETS | 고객카드·제품·인증·제안·계약·자산 | 미구현 |
| 11 | DATA-EXPORT-REQUEST | 〔완료·아카이브〕 실데이터 수집 키트 | 완료 |
| 12 | RBAC-ORG | 권한 3축·팀·승인 워크플로 | 기본 구현 |
| 13 | COLLABORATION | 코멘트·멘션·presence·잠금 | 기본 구현 |
| 14 | CARD-GAPS | 설문·브랜드측 인물·재고·물류계약·QnA | 미구현 |
| 15 | OPERATIONS-MODULE | 사이클·시딩·라이브·CS·정산 런 | 미구현 |
| 16 | BRAND-PORTAL | 브랜드사 셀프서비스 포털 | 미구현 |
| 17 | LIFECYCLE-GOVERNANCE | 해지·환불·갱신·컴플라이언스·DR·SLO | 미구현 |
| 18 | **MASTER-BUILD-ORDER** | **감사 매트릭스 + Phase 1~6 착수 프롬프트 + 공통 헤더** | 지시서 |
| 19 | STAFF-GUIDE | 담당자 사용 체계 — AI 섹터 맵 · 역할별 매뉴얼 · 철칙 | 운영 규범 |
| 20 | UI-FUNCTIONAL-SPEC | UI 기능정의서 — 전 화면(26)·플로우(7)·전역 시스템의 액션 단위 정의 (v2.5) | 기록·기준 |
| 21 | INTEGRATIONS-INFRA | 외부 연동 10종 투두 · 서버 인프라 · 로드맵 (정본: 기능정의서 docx §7~9) | 기록·기준 |

**개발 순서는 18 문서의 Phase 1~6을 따른다.** 마이그레이션 정규 번호: 001 init·002 org_collab(적용됨) → 003 card_gaps → 004 communications → 005 operations → 006 portal → 007 lifecycle.
상위 설계: 「최종 설계모델 v3」(실데이터 확정판)이 전 문서에 우선한다.

## 4. 공통 규약 (모든 파트가 따른다)

### 4-1. 스택
- Next.js(App Router) + TypeScript + 공유 Postgres(`@vercel/postgres` 또는 `pg` raw SQL — glovek과 동일하게 ORM 없이, 단 마이그레이션은 파일로 관리).
- UI: Tailwind + shadcn/ui + TanStack Table/Query, 차트 Recharts.
- 배포: Vercel(어드민 전용 프로젝트). 무거운 작업은 route `maxDuration` 상향 또는 cron 분할.
- 시간: **DB 저장은 UTC(timestamptz), 표시·SLA 계산은 KST(UTC+9)**. tpartners MySQL도 UTC임에 주의.

### 4-2. 상태값 canonical enum (전 시스템 공통 — 임의 변경 금지)
```
lead_new(리드확보) → seminar(세미나신청) → meeting(1:1미팅) → contact(개별컨택중)
→ contract_review(계약서검토) → contract_done(계약완료)
→ docs(서류수급중) → setup(입점셋업)
→ live_mall(운영중_멀티몰) | live_onboarding(운영중_온보딩)
→ settling(정산중)
종료: dropped(드랍보류) | churned(해지)
```
- 계약형태 `contract_type`: `mall`(멀티몰/GloveK) | `onboarding`(온보딩)
- 플랜 `plan`: `live_focus_490k`(정기) | `guarantee_1m`(수기—결제코드 없음) | `onboarding_onetime`(3M/5M/12M 일회) | `pro_89k`
- 결제상태 `pay_status`: `none` | `once_paid` | `subscribed` | `past_due` | `canceled`
- 등급 `grade`: `S|A|B|C` — **glovek gradeFromChecks 로직 그대로**(5→S, 4→A, 2~3→B, 0~1→C)

### 4-3. dedup(통합 키) — 순서 고정
`email(소문자 정규화)` → `phone(숫자만)` → `biz_no(사업자번호, 숫자만)` → `brand_name+brand_url`. 매칭되면 **기존 brands 행 갱신**, 아니면 생성. 절대 무조건 생성하지 않는다.

### 4-4. env 네이밍 (어드민 앱)
```
DATABASE_URL                # 공유 Postgres (쓰기: 어드민 CRM 테이블 / 읽기: glovek 테이블)
GLOVEK_DB_URL_RO            # (옵션) glovek 읽기전용 롤 분리 시
INGEST_SECRET               # 사이트→어드민 ingest 인증 (X-Ingest-Secret)
ADMIN_SESSION_SECRET        # 어드민 세션
ADMIN_ALLOWED_EMAILS        # 내부 접근 화이트리스트(콤마)
SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET / SLACK_CHANNEL_*  # 05 참고
ANTHROPIC_API_KEY           # 에이전트/브리프 생성
RESEND_API_KEY / RESEND_FROM  # 브랜드 리마인더 메일
```

### 4-5. 보안 원칙
- 시크릿 하드코딩 금지(전부 env). ingest는 서명헤더+멱등키. Slack은 signing secret 검증.
- 카드번호·신분증 등 민감정보는 어드민으로 **가져오지 않는다**(요약 필드 + 원본 링크만).
- 어드민 접근: 이메일 화이트리스트 + (가능하면) IP 제한. 감사로그(stage_history·alerts)로 누가 뭘 바꿨는지 기록.
- **모든 쓰기(상태변경·체크·담당변경)는 ops API의 게이트 검증을 경유** — 대시보드·Slack·MCP 공통.

### 4-6. AI 엔진 구성 (무엇이 어떤 엔진인가 — 전 문서 공통)

| 기능 | 엔진 | env | 문서 |
|---|---|---|---|
| 사전분석 브리프(diagnose_brand) | Claude API | ANTHROPIC_API_KEY | 06 §2 |
| 회의록 요약·다음액션 추출 | Claude API | ANTHROPIC_API_KEY | 08 §3-4 |
| 팔로업·리마인더·답장 메일 초안 | Claude API | ANTHROPIC_API_KEY | 08 §3-6 · 09 |
| QnA 추출·매칭(우려 포인트→질문) | Claude API (v1 키워드+카테고리, v2 pgvector 임베딩) | ANTHROPIC_API_KEY | 14-E |
| 주간 자가학습 리포트 | Claude 스케줄 에이전트(MCP 경유) | — (에이전트 세션) | 06 §3-④ |
| 운영 에이전트 5종(점검·리마인더·감시·자가학습·사전분석) | Claude 스케줄 에이전트 + 어드민 MCP 서버 | MCP_TOKEN | 06 |
| 음성 전사(줌 녹화, 한국어) | Whisper STT (OpenAI audio API 또는 Groq whisper-large-v3) | OPENAI_API_KEY 또는 GROQ_API_KEY | 08 §3-2 |

**AI가 아닌 것(결정론 영역 — AI 개입 금지)**: 등급 판정(gradeFromChecks 규칙), 게이트 통과 판정(gates.ts), SLA 계산·에스컬레이션, dedup, 견적(computeQuote), 정산 수치. AI는 **요약·초안·제안**만 하고, **판정·실행은 규칙 엔진과 사람**이 한다. 상태변경·발송은 항상 사람 승인(Slack 버튼/대시보드) 경유.

### 4-7. 결제 실체 (설계 전제 — HANDOVER 확정 사실 + 사업 결정 반영)
- 정기결제는 **Live Focus 49만**(glovek `subscribe-mall`, mall_subscriptions)과 Pro 8.9만뿐.
- **온보딩 3M/5M/12M은 일회성**(apply onboarding_orders). 정기 아님.
- **〔결정 반영〕 온보딩·개런티 트랙 카드결제는 glovek.space가 직접 수납한다** (예: 온보딩 300만, 추가 결제 포함). 어드민의 역할은 **결제 안내 발송뿐**:
  1. 어드민에서 결제 요청 생성(브랜드·항목·금액) → **결제 안내 메일 발송**("glovek 로그인 → 결제" 딥링크 포함) → 브랜드 카드에 "결제 대기" 표시 + 링크 열람 추적 + 미결제 3일 리마인더.
  2. **자동 확인**: glovek 결제 완료 → payment 웹훅(ingest) → pay_status 갱신 → 게이트 충족 → 상태 전진 제안 카드(승인 클릭) — 상태값 자동 변경.
  3. **수동 확인**: 계약서·계좌이체 건은 어드민 수기 결제 입력(payments_manual) → 동일 연쇄 — 상태값 수동 변경.
- glovek 측 준비(07에 지시 포함): 온보딩/개런티 결제 페이지(로그인 후 항목·금액 표시), 결제 완료 시 어드민으로 payment 이벤트 전송(`pay:{tid}` 멱등).

## 5. 리포 구조 제안

```
glovek-admin/
├─ app/
│  ├─ (dashboard)/         # 04: 보드·360·워크큐·모니터·정산·인사이트
│  ├─ api/ingest/[event]/  # 02
│  ├─ api/ops/             # 03: transition·checklist·assign·remind (게이트 검증)
│  ├─ api/slack/           # 05: events·actions·commands
│  ├─ api/cron/            # 03: sla-check·escalate / 06: agents 보조
│  └─ api/mcp/             # 06 (또는 별도 사이드카)
├─ lib/
│  ├─ db.ts  gates.ts  sla.ts  dedup.ts  slack.ts  brief.ts
├─ migrations/             # 01 DDL 순번 파일
└─ scripts/backfill.ts     # 01: 기존 3개 소스 초기 적재
```

## 6. 완료 기준 (전체)

- [ ] 어떤 경로로 들어와도 브랜드가 brands에 1행으로 존재(중복 0)
- [ ] 게이트 미충족 상태 이동이 API에서 422로 거부됨(대시보드·Slack·MCP 공통)
- [ ] SLA 초과 시 T0→T1→T2→T3 에스컬레이션이 자동 발화·해제됨
- [ ] 신규 리드에 사전분석 브리프가 자동 생성되어 Slack 도착
- [ ] Slack 버튼으로 이동승인·담당변경·서류체크·리마인더가 실제 DB에 반영
- [ ] 주간 자가학습 리포트가 insights에 축적되고 대표 채널에 도착
