# Glovek 운영 어드민 (glovek-admin)

마케팅 → 영업(결제) → 멀티몰/온보딩 분기 → 서류 수급 → 정기 운영 → 정산까지,
**모든 브랜드가 단 하나의 원장에서, 누락이 물리적으로 불가능하게, 최소 인원 + AI로** 관리되는 운영 시스템.

> 근거: 3개 사이트 HANDOVER 실물(glovek.space / apply.tpartners.live / tpartners.live) + 마스터 설계서 v2.
> 이 레포는 그중 **분리 어드민 앱 + 공유 Postgres 원장**을 구현한다. 3개 사이트는 별도 레포이며,
> 이 어드민의 Ingest API 로 단방향 전송한다([`docs/07-SITE-INTEGRATION.md`](docs/07-SITE-INTEGRATION.md)).

## 핵심 원칙 6
1. **1 브랜드 = `brands` 1행.** 입력구(사이트 3 + 영업)는 여럿, 원장은 하나.
2. **상태값 하나로 전 퍼널.** 마케팅부터 정산까지 단일 state 머신.
3. **들어오면 즉시 분석.** 최소정보 강제 + 사전분석(크롤러·셀프진단) → 등급·트랙 자동.
4. **안 챙기면 시스템이 때린다.** 게이트(서버 강제) · SLA · 에스컬레이션.
5. **매주 스스로 정밀해진다.** 이벤트 이력 기반 자가학습.
6. **AI가 운전한다.** 전용 MCP + Slack 양방향 — 사람도 AI도 같은 게이트를 통과.

## 아키텍처

```
[glovek.space]──┐  (읽기전용 참조 + 실시간 ingest)
[apply.tpartners]─┼──▶ POST /api/ingest/<event> ──▶ ┌──────────────────────┐
[tpartners.live]──┘  (X-Ingest-Secret, 멱등)          │  공유 Postgres (원장) │◀─ read-only(glovek)
                                                      │  · glovek 기존 테이블 │
                                                      │  · 어드민 CRM 테이블  │◀─ 어드민만 쓰기
                                                      └──────────┬───────────┘
                        게이트 검증 ops API / MCP ◀───────────────┤
      ┌───────────────────┬────────────────────────┬─────────────┘
 [어드민 대시보드]   [Slack App(양방향)]     [Claude 에이전트/MCP]
```

- **원장**: glovek.space Postgres 공유. 어드민은 신규 CRM 테이블만 쓰기, glovek 테이블은 읽기전용(`lib/db.ts` 가드).
- **스택**: Next.js(App Router) + TypeScript + `pg` raw SQL(ORM 없음, 마이그레이션은 파일). Tailwind UI.
- 시간: DB 저장 UTC(timestamptz), 표시·SLA 계산 KST(UTC+9).

## 디렉터리

```
app/
  (dash)/            # 대시보드: 보드 · 360 · 워크큐 · 모니터 · 결제 · 인사이트 · 설정
  login/             # 내부 화이트리스트 로그인
  api/ingest/[event] # 02 · 사이트 → 어드민 이벤트 수신
  api/ops/*          # 03 · transition·assign·doc-check·remind·manual-payment·log-contact·drop·snooze (게이트 검증)
  api/cron/*         # 03 · sla-check(매시) · escalate(09/14시)
  api/slack/*        # 05 · events · actions · commands
  actions.ts         # 대시보드 서버액션(ops 경유)
lib/
  db · env · auth · types                # 인프라·enum·세션
  dedup · states · gates · sla · grade · time   # 도메인 코어(순수·테스트됨)
  ingest · transition · ops · docs · brief      # 이벤트/상태/서류/브리프
  slack · blocks · slack-views · escalation     # Slack 양방향
  mcp-tools · ask                        # 06 · 도메인 툴 + /ask
  repo/*                                 # 데이터 접근
mcp/server.ts        # 06 · 도메인 MCP 서버(HTTP streamable)
migrations/          # 01 · DDL 순번 파일
scripts/             # migrate · seed
tests/               # 도메인 단위테스트(vitest)
docs/                # 07 사이트 연동 · AGENTS(에이전트 5종)
```

## 상태 머신 (canonical — 임의 변경 금지)

```
lead_new → seminar → meeting → contact → contract_review → contract_done
→ docs → setup → live_mall|live_onboarding → settling
종료: dropped(사유 필수) | churned(live*/settling에서만)
```

- 계약형태 `mall`|`onboarding` · 플랜 `live_focus_490k`(정기)·`guarantee_1m`(수기)·`onboarding_onetime`(일회)·`pro_89k`
- 등급 `S|A|B|C` = glovek `gradeFromChecks`(5→S,4→A,2~3→B,0~1→C), 추천 S/A→onboarding, B/C→live.
- **결제 실체**: 정기결제는 Live Focus 49만(+Pro)뿐. Guarantee 100만=수기(`payments_manual`), 온보딩 3~12M=일회.

## 셋업

```bash
npm install
cp .env.example .env.local            # 값 채우기 (DATABASE_URL 등)

# 스키마 생성
DATABASE_URL=postgres://... npm run migrate

# (로컬) 샘플 데이터
DATABASE_URL=postgres://... npm run seed

npm run dev                           # http://localhost:3000
```

로그인: `ADMIN_ALLOWED_EMAILS` 화이트리스트 이메일 입력(경량 세션, 외부 SSO 도입 전 임시).

### 주요 명령
| 명령 | 설명 |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest (도메인 코어 22 케이스) |
| `npm run migrate` | `migrations/*.sql` 순차 적용 |
| `npm run seed` | 로컬 샘플 데이터 |
| `npm run mcp` | 도메인 MCP 서버(`:8787/mcp`) |

## Ingest (사이트 → 어드민)

```
POST /api/ingest/{lead|diagnosis|payment|doc_progress|contact_logged}
Headers: X-Ingest-Secret, X-Idempotency-Key
Body: { site, occurred_at, email|phone|biz_no(최소1), brand_name, ... }
```

- dedup 순서: email → phone → biz_no → brand_name+brand_url(호스트). 매칭 시 기존 행 갱신(빈 필드만), state는 전진만.
- 멱등: `X-Idempotency-Key` 재수신 시 `{dedup:true}`. 원본은 `ingest_events` 에 저장(재처리 가능).
- 로컬 테스트:
  ```bash
  curl -X POST localhost:3000/api/ingest/lead \
    -H "X-Ingest-Secret: $INGEST_SECRET" -H "X-Idempotency-Key: consult:1" \
    -H "Content-Type: application/json" \
    -d '{"site":"glovek","occurred_at":"2026-07-27T02:00:00Z","email":"a@b.com","brand_name":"테스트","source":"glovek_consult","contact_name":"홍길동"}'
  ```

## 게이트 · SLA

- 모든 상태 쓰기는 `lib/transition.ts` → `evaluateGate` 를 통과해야 반영(대시보드·Slack·MCP 공통). 실패 시 422 + 한국어 라벨.
- `sla-check`(매시): SLA 초과·서류 미완·방치·past_due 감지 → `alerts` upsert. `escalate`(09/14시): T0→T3 사다리 + 일일 다이제스트.
- Vercel Cron 은 `vercel.json` 참조. cron 라우트는 `CRON_SECRET` (Authorization: Bearer) 보호.

## Slack App (05)

- 매니페스트: scopes `chat:write, commands, users:read, im:write, channels:read`,
  슬래시 `/brand /today /sla /ask`, interactivity `/api/slack/actions`, events `/api/slack/events`.
- 모든 인바운드는 `x-slack-signature` HMAC 검증 + 3초 ack.
- 버튼 6종(이동/담당/리마인더/서류✓/스누즈/드랍)이 게이트 검증 ops 를 호출 → 실패는 모달에 표시, 성공은 카드 갱신.
- `admin_users.slack_user_id` 매핑이 있어야 액터 권한이 확인된다.

## MCP + 에이전트 (06)

- `npm run mcp` → 도메인 MCP(`list_brands`·`transition_stage`·`find_sla_breaches`·`diagnose_brand`·`send_alert` 등 15종).
  읽기=직접 SELECT, 쓰기=ops 경유, actor=`mcp:{agent}`.
- Claude 스케줄 에이전트 5종 프롬프트: [`docs/AGENTS.md`](docs/AGENTS.md).

## 보안
- 시크릿 전부 env. ingest=서명+멱등, Slack=signing secret, cron=bearer, MCP=토큰.
- 카드번호·신분증 등 민감정보는 어드민으로 가져오지 않는다(요약 + 원본 링크).
- 감사로그: `stage_history`(누가·언제·무엇) · `alerts` · `ingest_events`.

## 로드맵
- **M0** 스키마 ✅ · **M1** ingest + ops/게이트/SLA ✅ · **M2** 대시보드 ✅ · **M3** Slack + MCP/에이전트 ✅
- 다음: 3개 사이트 연동 착수(07) · 초기 backfill(`scripts/backfill` — 소스 CSV 입력) · 사전분석 AI 정식화 · 주간 자가학습 리포트 자동화.
