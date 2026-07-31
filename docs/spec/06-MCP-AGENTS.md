# 06 · MCP 서버 + Claude 스케줄 에이전트

> Claude Code 지시: TypeScript MCP SDK로 도메인 MCP 서버를 구현해줘(어드민 레포 내 `/mcp` 또는 사이드카). 모든 쓰기 툴은 03 ops API를 경유한다(직접 UPDATE 금지). 이후 에이전트 5종은 스케줄 작업으로 등록한다.

## 1. MCP 서버

- 전송: HTTP(streamable) + 헤더 토큰 인증(`MCP_TOKEN`). actor는 항상 `mcp:{agent_name}`으로 기록.
- 읽기 툴은 공유 Postgres 직접 SELECT(읽기전용), 쓰기 툴은 ops API 호출.

### 툴 카탈로그 (입출력 스키마)

```ts
list_brands({state?, owner?, plan?, grade?, churn_risk?, overdue_only?, q?, limit=50})
  → {brands:[{id, brand_name, state, grade, plan, pay_status, owners, days_in_stage, next_action, due_date}]}

get_brand_360({brand_id}) → {brand, signals[], doc_progress:{done,total,items}, payments:{subs?, orders[], manual[]},
  history[последние 20], active_alerts[]}

find_sla_breaches({tier_min=0}) → {alerts:[{brand_id, brand_name, kind, tier, days_over, owner, suggested_action}]}
find_gate_violations({since_days=7}) → {violations:[...]}
find_missing_docs() → {brands:[{brand_id, missing_items[], days_in_docs, owner_onboard}]}

transition_stage({brand_id, to_state, reason?}) → ops/transition 결과 그대로 {ok} | {failed:[rules]}
assign_owner({brand_id, role, admin_user_id}) → ops/assign
log_contact({brand_id, channel, note}) → ops/log-contact
draft_reminder({brand_id, channel:'email'|'sms'})
  → {subject?, body}  # 브랜드명·미제출 항목·기한·링크를 채운 정중한 한국어 초안. 매번 새로 생성
send_alert({channel_key, blocks|text}) → Slack 발송(05 라우팅)

compute_funnel_metrics({from, to}) → {stages:[{state, entered, converted, avg_days}], by_source[], by_grade[]}
score_churn_risk({brand_id}) → {risk:'low|mid|high', factors:[...]}  # 규칙 기반 v1: 미제출일수·past_due·접촉공백·등급
enrich_brand({brand_id}) → 크롤러(glovek brand_stats/brand_shop_stats 조인) + 국내 공개신호 수집 → brand_signals INSERT
diagnose_brand({brand_id}) → checks/신호 종합 → grade 재계산(gradeFromChecks 로직 동일) + brief_md 생성·저장
upsert_insight({week, metric, value, finding, proposed_action}) → insights INSERT
```

### 툴 확장 (후속 문서에서 추가 — 합산이 최종 카탈로그)
- 09-B: list_unassigned·suggest_assignee·bulk_reassign·generate_handover·list_no_reply·summarize_thread·draft_reply
- 10-G: get_customer_card·list_products·upsert_cert·find_cert_risks·create_proposal·register_contract·list_assets
- 08 §4: list_meetings·get_meeting·match_meeting·draft_followup
- 15: suggest_creators·list_cycles·run_settlement(초안 생성만 — 확정은 사람)

## 2. 사전분석 브리프 생성 규칙 (`diagnose_brand` 내부)

브리프(brief_md) 형식 — 반드시 아래 6줄 구조, 추정치는 신뢰도 병기:
```
카테고리/목표국 | 국내 규모(신호+선언, 신뢰도) | 디지털 존재감(SNS·틱톡)
해외 준비(인증·물류·경험) | 5대 지표 판정 → 등급 | 추천 트랙·플랜 + 영업 포인트 1줄 + 리스크 1줄
```
등급은 glovek `gradeFromChecks`와 동일: yes 5→S, 4→A, 2~3→B, 0~1→C. 추천: S/A→onboarding, B/C→live.

## 3. Claude 스케줄 에이전트 5종 (등록용 프롬프트 전문)

각각 스케줄 작업으로 등록(새 세션·MCP 연결 전제). 시간 KST.

### ① 일일 운영 점검 — 매일 09:00
```
Glovek 운영 MCP로 다음을 수행하라.
1) find_sla_breaches, find_gate_violations, find_missing_docs 실행.
2) list_brands로 담당 공백·다음액션 공백·접촉 14일 초과를 추가 확인.
3) 파트별로 묶어 send_alert: 각 브랜드당 "[브랜드] · 문제 · 경과 · 담당 · 지금 할 한 가지" 한 줄.
   tier2+는 파트장 채널, 전체 요약은 데일리 채널 + 대표 이메일.
4) 조치 불가/판단 필요 항목은 질문 형태로 파트장 채널에 별도 표기.
새로 생성하지 말 것: 알림 카드 버튼은 시스템이 붙인다. 존재하는 브랜드만 다뤄라.
```

### ② 미제출·서류 리마인더 — 매일 14:00
```
find_missing_docs 실행. 각 브랜드에 대해:
- draft_reminder(email)로 브랜드 발송용 초안 생성 → 온보딩 채널에 카드(담당 승인 발송용) 게시.
- 3일 이상 미제출이면 score_churn_risk 갱신 후 high면 파트장 채널 에스컬레이션.
- 해소된 건(체크리스트 100%)은 완료 코멘트로 스레드 마감.
```

### ③ 결제·정산 감시 — 매일 10:00
```
공유 DB에서 mall_subscriptions past_due/failures>0, next_charge_at 경과, apply 미결제 주문(pending 3일+)을 조회(list/360 툴).
정산 채널에 표로 게시: 브랜드·플랜·금액·상태·경과·권장 조치.
past_due 브랜드는 draft_reminder(결제 안내 버전) 초안 첨부. 세그먼트별 유지율 요약 1줄 포함.
```

### ④ 주간 자가학습 — 매주 월 09:00
```
compute_funnel_metrics(지난 4주, 8주 비교) 실행. 분석:
병목 단계(체류일 상위), 유입경로별 전환, 등급별 전환, 드랍 사유 분포, SLA 준수율 추이.
upsert_insight로 저장(주차별). 제안: SLA 조정값(sla_policies diff), 게이트/스크립트 보완 1~3건.
데일리 채널+대표 이메일에 요약(수치는 표, 제안은 번호 목록 3개 이내). 승인은 사람이 한다 — 직접 정책을 바꾸지 말 것.
```

### ⑤ 사전분석 — 신규 유입 시(ingest가 큐잉) + 매일 11:00 보충
```
brief_md 없는 brands를 찾아 enrich_brand → diagnose_brand 실행.
결과 브리프를 유입 채널에 카드로 게시(담당 멘션). 신뢰도 low 신호만 있으면 "미팅 검증 필요" 태그.
실패(신호 없음)한 브랜드는 선언값 기반 잠정 등급 + "정보 부족" 표기.
```

## 4. 안전 규칙 (전 에이전트 공통)
- 상태 변경(transition/drop)은 에이전트가 **직접 실행하지 않는다** — 제안까지만, 실행은 사람(Slack 버튼/대시보드). 예외: 없음(v1).
- 개인정보(카드·신분증)는 어떤 출력에도 포함 금지. 브랜드 연락처는 초안 내부에만.
- 같은 알림 중복 게시 금지(alerts.slack_ts 확인).

## 5. 완료 기준
- [ ] MCP 툴 전체가 스키마 검증과 함께 동작(읽기 직결·쓰기 ops 경유)
- [ ] diagnose_brand가 glovek 등급 로직과 동일 결과(테스트 케이스 5개)
- [ ] 에이전트 5종 스케줄 등록 + 첫 실행 로그 확인
- [ ] /ask(05)가 이 MCP를 경유해 답변
