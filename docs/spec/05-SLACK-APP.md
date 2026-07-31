# 05 · Slack App — 양방향 운영 (알림 + 실행)

> Claude Code 지시: 어드민 앱에 `/app/api/slack/{events,actions,commands}/route.ts`와 `lib/slack.ts`를 이 스펙대로 구현해줘. 기존 사이트들의 Incoming Webhook은 유지하되, 어드민 발신은 전부 이 App(봇 토큰)으로 통일한다.

## 1. Slack App 설정 (매니페스트 요지)

```yaml
name: Glovek Ops
scopes(bot): chat:write, chat:write.public, commands, users:read, im:write, channels:read
slash_commands: /brand /today /sla /ask
interactivity: request_url: {ADMIN_URL}/api/slack/actions
event_subscriptions: request_url: {ADMIN_URL}/api/slack/events   # app_mention
```
env: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CH_INTAKE`, `SLACK_CH_ONBOARD`(기존 #틱톡-온보딩-알림=C0B753MKLV9 재사용 가능), `SLACK_CH_ADS`, `SLACK_CH_PAY`, `SLACK_CH_LEADS`(파트장), `SLACK_CH_DAILY`.
모든 인바운드는 `x-slack-signature` HMAC 검증 + 3초 내 ack(즉시 200, 처리는 비동기 후 `response_url`/`chat.update`).

## 2. 채널 라우팅

| 이벤트 | 채널 |
|---|---|
| lead/diagnosis(브리프) | CH_INTAKE (+owner_intake DM 멘션) |
| doc_missing/doc_progress | CH_ONBOARD |
| 운영·이탈징후 | CH_ADS |
| payment/pay_overdue | CH_PAY |
| tier2 에스컬레이션 | CH_LEADS |
| 일일 다이제스트·주간 리포트 | CH_DAILY (대표는 Email 병행) |

## 3. 알림 카드 (Block Kit)

브랜드 알림 카드 공통 구조 — `action_id`에 의도, `value`에 `{brand_id, alert_id?}` JSON:
```json
{ "blocks": [
  {"type":"section","text":{"type":"mrkdwn","text":"🔴 *[브랜드A]* 서류수급 7일 경과 · 담당 <@U123>\n미제출: 물류계약서, 트레이드마크 · 다음 액션: 재요청"}},
  {"type":"actions","elements":[
    {"type":"button","action_id":"transition","text":{"type":"plain_text","text":"이동 승인 ▸"},"style":"primary","value":"{\"brand_id\":\"..\"}"},
    {"type":"button","action_id":"assign","text":{"type":"plain_text","text":"담당 변경"},"value":"{..}"},
    {"type":"button","action_id":"remind","text":{"type":"plain_text","text":"리마인더 발송"},"value":"{..}"},
    {"type":"button","action_id":"doc_check","text":{"type":"plain_text","text":"서류 수령 ✓"},"value":"{..}"},
    {"type":"button","action_id":"snooze","text":{"type":"plain_text","text":"1일 스누즈"},"value":"{..}"},
    {"type":"button","action_id":"drop","text":{"type":"plain_text","text":"드랍"},"style":"danger","value":"{..}"},
    {"type":"button","action_id":"open360","text":{"type":"plain_text","text":"360 ↗"},"url":"{ADMIN_URL}/brand/.."}
  ]}]}
```

## 4. 버튼 액션 → ops API 매핑 (`/api/slack/actions`)

| action_id | 동작 |
|---|---|
| transition | 다음 허용 전이 select 모달 → `POST /api/ops/transition`. 422면 모달에 실패 규칙 표시("이동 불가: 회의록 없음") |
| assign | admin_users select 모달 → ops/assign |
| remind | 06 `draft_reminder`로 초안 생성 → 모달 미리보기(수정 가능) → 확인 시 ops/remind 발송 |
| doc_check | 미완 doc_items 체크박스 모달 → ops/doc-check (apply 동기 항목은 비활성) |
| snooze | ops/snooze(+1일) |
| drop | 사유 입력 모달 필수 → ops/drop |
액터 기록: `actor = slack:{slack_user_id}` → admin_users.slack_user_id로 역할 확인(권한 없으면 에페메랄 거부 메시지).
처리 후 원 카드 `chat.update`로 상태 반영(✅ 처리됨 · by @user).

## 5. 슬래시 명령 (`/api/slack/commands`)

```
/brand <이름|이메일>  → 360 요약 카드(state·담당·다음액션·서류율·결제·등급·이탈위험 + 버튼)
/today               → 호출자 역할의 워크큐 상위 10(위반 우선) 에페메랄
/sla                 → 활성 sla_breach/stale 목록(파트 필터 인자 지원: /sla onboard)
/ask <질문>          → 06 MCP 경유 Claude 질의. 즉시 "🤔 확인 중" ack 후 결과 스레드 게시
```

## 6. 일일 다이제스트 (cron 09:00 KST → CH_DAILY)
- 섹션: ⚠️ tier2+ n건(목록) / 오늘 마감 n / 신규 리드 n(등급 분포) / 결제 past_due n / 어제 처리 완료 n.
- 담당별 개인 DM 다이제스트(자기 것만) 동시 발송 — 03의 묶음 규칙.

## 7. 완료 기준
- [ ] 서명 검증 실패 401, 3초 ack 준수(비동기 처리)
- [ ] 버튼 6종이 실제 ops API를 호출하고 게이트 422가 모달에 표시됨
- [ ] chat.update로 카드가 처리 상태로 갱신
- [ ] /brand /today /sla /ask 동작 + 권한 없는 사용자 거부
- [ ] 다이제스트가 채널·개인 DM으로 발송되고 알림 폭주 없음(묶음)
