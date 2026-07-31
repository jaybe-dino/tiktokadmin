# 03 · 게이트 · SLA · 에스컬레이션 엔진

> Claude Code 지시: `lib/gates.ts`, `lib/sla.ts`, `/app/api/ops/*`, `/app/api/cron/*`를 이 스펙대로 구현해줘. **모든 상태 쓰기는 여기를 거친다** — 대시보드·Slack·MCP가 같은 API를 호출한다.

## 1. 상태 머신

허용 전이(전진):
```
lead_new → seminar|meeting|contact          seminar → meeting|contact
meeting → contact                            contact → contract_review|contract_done
contract_review → contract_done              contract_done → docs
docs → setup                                 setup → live_mall|live_onboarding
live_mall|live_onboarding → settling
어디서든 → dropped (사유 필수) / live*·settling → churned (사유 필수)
후퇴: lead측 방향 전이는 role=lead|exec 만 가능(사유 필수, stage_history 기록)
```

## 2. 게이트 규칙 (GATES 테이블 — 코드로 그대로)

```ts
// lib/gates.ts — 각 전이의 통과조건. 하나라도 false면 422 + 실패 항목 반환
const GATES: Record<string, Rule[]> = {
  'lead_new→meeting': [hasContact, hasEmailOrPhone, has('source'), assigned('owner_intake')],
  'seminar→meeting':  [hasContact, assigned('owner_intake')],
  'meeting→contact':  [hasMeetingNote /*brand_sources.event=contact_logged(meeting)*/,
                       assigned('owner_sales'), hasDiagnosis /*grade IS NOT NULL*/],
  'contact→contract_review': [has('contract_type'), has('plan')],
  'contact→contract_done':   [has('contract_type'), has('plan'), paymentConfirmed],
  'contract_review→contract_done': [paymentConfirmed],
  'contract_done→docs': [assigned('owner_onboard'), docTemplateCreated],
  'docs→setup':       [allDocsDone /*doc_items done 100%*/, has('biz_no')],
  'setup→live_mall':  [eq('contract_type','mall'), assigned('owner_ads')],
  'setup→live_onboarding': [eq('contract_type','onboarding'), assigned('owner_ads')],
  'live_mall→settling': [eq('pay_status','subscribed'), hasFirstPerformance],
  'live_onboarding→settling': [hasFirstPerformance],
}
// paymentConfirmed: pay_status IN ('once_paid','subscribed')
//   OR payments_manual 존재(Guarantee 100만 수기 대응)
// hasFirstPerformance: brand_signals metric='first_gmv' 존재 (수기 입력 가능)
```

## 3. Ops API

```
POST /api/ops/transition   {brand_id, to_state, actor, reason?}
  → 게이트 검증 → 실패: 422 {failed:[{rule,label}]}
  → 성공: brands.state/stage_entered_at 갱신, stage_history INSERT,
          담당 자동 이관(아래), 관련 alerts 해제, Slack 카드 갱신
POST /api/ops/assign       {brand_id, role(owner_*), admin_user_id, actor}
POST /api/ops/doc-check    {brand_id, item_key, done, actor}   # apply 동기 항목(source=apply_step)은 수동변경 금지
POST /api/ops/remind       {brand_id, channel(email|sms), actor}  # 브랜드 리마인더 발송(초안→발송, 06 draft 사용)
POST /api/ops/manual-payment {brand_id, plan, amount, paid_at, next_due?, note, actor}
POST /api/ops/log-contact  {brand_id, channel, note, actor}    # last_contact_at 갱신
POST /api/ops/drop         {brand_id, reason, actor}           # state=dropped
스누즈: POST /api/ops/snooze {alert_id, until, actor}
모든 API: 어드민 세션 또는 내부 서명(Slack/MCP) 필수. 전부 stage_history/alerts에 감사 기록.
```

담당 자동 이관: transition 성공 시 to_state 구간의 owner_* 가 비어 있으면 422가 아니라 **모달 요구**(게이트에 assigned 조건이 있는 전이만 하드 차단). 이관 시 이전 담당에게 Slack "핸드오프" 알림.

## 4. SLA 타이머 — `/api/cron/sla-check` (vercel.json: 매시 정각)

```
for brand in (state NOT IN ('dropped','churned')):
  policy = sla_policies[brand.state]; 없으면 skip
  경과 = KST영업일(now - stage_entered_at)      # live_*는 last_contact_at 기준(접촉 공백)
  if 경과 > policy.max_days → upsertAlert(kind='sla_breach', tier 계산)
결제: glovek mall_subscriptions.status='past_due' OR next_charge_at+2일 미결제
  → upsertAlert(kind='pay_overdue')
서류: state='docs' AND doc_items 미완 존재 AND 경과>=1일 → kind='doc_missing'
방치: last_contact_at 7일 초과(진행 상태) → kind='stale'
게이트 위반: stage_history.gate_passed=false 신규 발생 → kind='gate_violation' (즉시 tier 2)
```

## 5. 에스컬레이션 사다리 — `/api/cron/escalate` (매일 09:00, 14:00 KST)

```
tier 0: 발생 당일     → 담당 Slack DM (+카드 버튼)
tier 1: 매일 반복     → 담당 DM 재발송 (snoozed_until 지나면 재개)
tier 2: 초과 +2일     → 파트장 채널(#glovek-파트장) + Email
tier 3: 초과 +5일     → 대표 Email 일일요약 적색 목록 + exec DM
해제: 조건 해소 시 resolved_at 기록 + Slack 카드 ✅ 갱신 (alerts UNIQUE로 재발 시 새 사이클)
개인별 묶음: 같은 담당의 다수 알림은 1개 다이제스트 메시지로 묶어 발송(스팸 방지)
```

## 6. 완료 기준
- [ ] 게이트 실패 시 422 + 실패 규칙 목록(한국어 라벨) 반환, 성공 시 이력·담당·알림 연쇄 처리
- [ ] 규칙 단위테스트: 전이표 전체(성공/실패 각 1케이스 이상)
- [ ] sla-check 아이들럼포턴트(1시간 내 재실행해도 중복 알림 없음)
- [ ] 에스컬레이션 tier 상승·해제·스누즈 시나리오 테스트
- [ ] KST 영업일 계산(주말 제외) 유틸 + 테스트


---
## 7. v3 교차 반영 노트 (구현·후속 문서와의 정합)
- SLA 초기값은 실측 캘리브레이션 적용: meeting 7일 · docs 10일 (v3 §2-2, 코드 002 마이그레이션 반영됨).
- `contact→contract_*`의 "제안서 발송 기록"은 proposals.status='sent'로 판정 교체(10-C). 
- `docs→setup`에 contracts.status='signed' 조건 추가 권장(10-D — Phase 2에서 게이트 업데이트).
- drop은 12 문서 결재선 경유(비승인자는 approval_requests 생성) — v0.2 코드 구현됨.
- 물류 항목 판정은 logistics_contracts.status(14-D)와 동기.
