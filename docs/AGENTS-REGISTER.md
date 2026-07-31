# Claude 스케줄 에이전트 등록 가이드 (06 · Phase 4)

이 문서는 운영자가 **MCP 서버 연결 후 5종 에이전트를 스케줄 작업으로 등록**할 때 그대로 복붙하는 프롬프트 모음이다.
안전 규칙(§안전)은 전 에이전트 공통이며, 상태 변경·발송은 **항상 사람 승인**(Slack 버튼/대시보드/초안함)을 경유한다.

## MCP 연결
- 전송: HTTP(streamable) + 헤더 토큰 `MCP_TOKEN`. actor 는 항상 `mcp:{agent_name}`.
- 쓰기 툴은 전부 `/api/ops`(게이트) 경유 — 직접 UPDATE 금지.

## 툴 카탈로그 (lib/mcp-tools.ts)
**읽기**: `list_brands` · `get_brand_360` · `get_customer_card` · `list_products` ·
`find_cert_risks` · `find_sla_breaches` · `find_gate_violations` · `find_missing_docs` ·
`list_meetings` · `suggest_assignee` · `list_no_reply` · `compute_funnel_metrics` · `draft_reminder`
**쓰기(ops 경유)**: `transition_stage` · `assign_owner` · `log_contact` · `create_proposal` ·
`register_contract` · `send_alert` · `score_churn_risk` · `enrich_brand` · `diagnose_brand` · `upsert_insight`

---

## ① 일일 운영 점검 — 매일 09:00 KST
```
Glovek 운영 MCP로:
1) find_sla_breaches, find_gate_violations, find_missing_docs 실행.
2) list_brands로 담당 공백·다음액션 공백·접촉 14일 초과 확인.
3) 파트별로 묶어 send_alert: 브랜드당 "[브랜드]·문제·경과·담당·지금 할 한 가지" 한 줄.
   tier2+ 는 파트장 채널, 전체 요약은 데일리 채널 + 대표 이메일.
4) 판단 필요 항목은 질문 형태로 파트장 채널에 별도 표기.
새로 생성 금지. 존재하는 브랜드만.
```

## ② 미제출·서류 리마인더 — 매일 14:00 KST
```
find_missing_docs 실행. 각 브랜드:
- draft_reminder(email) 초안 생성 → 온보딩 채널 카드(담당 승인 발송).
- 3일 이상 미제출이면 score_churn_risk 갱신 후 high 면 파트장 채널 에스컬레이션.
- 체크리스트 100% 해소 건은 완료 코멘트로 마감.
```

## ③ 결제·정산 감시 — 매일 10:00 KST
```
공유 DB에서 mall_subscriptions past_due/failures>0, next_charge_at 경과,
apply 미결제(pending 3일+) 조회. 정산 채널에 표 게시(브랜드·플랜·금액·상태·경과·권장조치).
past_due 는 draft_reminder(결제 안내) 첨부. 세그먼트 유지율 1줄.
```

## ④ 주간 자가학습 — 매주 월 09:00 KST
```
compute_funnel_metrics(4주/8주 비교). 병목 단계·유입경로별 전환·등급별 전환·
드랍 사유·SLA 준수율 추이 분석. upsert_insight 저장.
제안: SLA 조정값·게이트/스크립트 보완 1~3건. 데일리+대표 이메일 요약.
직접 정책 변경 금지 — 승인은 사람.
```

## ⑤ 사전분석 — 신규 유입 시 + 매일 11:00 KST 보충
```
brief_md 없는 brands 를 enrich_brand → diagnose_brand.
브리프를 유입 채널 카드로 게시(담당 멘션). 신뢰도 low 만 있으면 "미팅 검증 필요".
신호 없으면 선언값 기반 잠정 등급 + "정보 부족".
```

## 안전 규칙 (전 에이전트 공통)
- 상태 변경·발송은 에이전트가 직접 실행하지 않는다 — 제안까지만.
- 개인정보(카드·신분증·비밀번호)는 어떤 출력에도 포함 금지.
- 같은 알림 중복 게시 금지(alerts 확인).
- 견적·정산·게이트·등급 판정은 결정론 엔진(quote/operations/gates/grade) — AI 재계산 금지.

## AI 패널·초안함 (UI)
- **초안함** `/drafts`: 미팅 팔로업·AI 답장 초안 승인·발송(광고성은 수신동의 게이트).
- 화면 컨텍스트 AI 패널은 Slack `/ask`(lib/ask.ts)로 동일 툴셋 질의 — 대시보드 임베드는 후속.
