# Claude 스케줄 에이전트 5종 (06-MCP-AGENTS §3)

각 에이전트는 **새 Claude 세션 + Glovek Ops MCP 연결**을 전제로 스케줄 작업으로 등록한다.
MCP 서버: `tsx mcp/server.ts` (HTTP `/mcp`, 헤더 `Authorization: Bearer $MCP_TOKEN`).

MCP 등록 예 (Claude Code / Desktop):

```json
{
  "mcpServers": {
    "glovek-ops": {
      "url": "https://admin.glovek.space/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

## 안전 규칙 (전 에이전트 공통)
- 상태 변경(transition/drop)은 에이전트가 **직접 실행하지 않는다** — 제안까지만, 실행은 사람(Slack 버튼/대시보드).
- 개인정보(카드·신분증)는 어떤 출력에도 포함 금지. 브랜드 연락처는 초안 내부에만.
- 같은 알림 중복 게시 금지(`alerts.slack_ts` 확인).

---

## ① 일일 운영 점검 — 매일 09:00 KST

```
Glovek 운영 MCP로 다음을 수행하라.
1) find_sla_breaches, find_gate_violations, find_missing_docs 실행.
2) list_brands로 담당 공백·다음액션 공백·접촉 14일 초과를 추가 확인.
3) 파트별로 묶어 send_alert: 각 브랜드당 "[브랜드] · 문제 · 경과 · 담당 · 지금 할 한 가지" 한 줄.
   tier2+는 파트장 채널(leads), 전체 요약은 데일리 채널(daily) + 대표 이메일.
4) 조치 불가/판단 필요 항목은 질문 형태로 파트장 채널에 별도 표기.
새로 생성하지 말 것: 알림 카드 버튼은 시스템이 붙인다. 존재하는 브랜드만 다뤄라.
```

## ② 미제출·서류 리마인더 — 매일 14:00 KST

```
find_missing_docs 실행. 각 브랜드에 대해:
- draft_reminder(email)로 브랜드 발송용 초안 생성 → 온보딩 채널(onboard)에 카드(담당 승인 발송용) 게시.
- 3일 이상 미제출이면 score_churn_risk 갱신 후 high면 파트장 채널 에스컬레이션.
- 해소된 건(체크리스트 100%)은 완료 코멘트로 스레드 마감.
```

## ③ 결제·정산 감시 — 매일 10:00 KST

```
공유 DB에서 mall_subscriptions past_due/failures>0, next_charge_at 경과, apply 미결제(pending 3일+)을
list_brands/get_brand_360 로 조회. 정산 채널(pay)에 표로 게시: 브랜드·플랜·금액·상태·경과·권장 조치.
past_due 브랜드는 draft_reminder(결제 안내) 초안 첨부. 세그먼트별 유지율 요약 1줄 포함.
```

## ④ 주간 자가학습 — 매주 월 09:00 KST

```
compute_funnel_metrics 실행. 병목 단계(체류일 상위)·유입경로별 전환·등급별 전환·드랍 사유·SLA 준수율 추이 분석.
upsert_insight로 주차별 저장. 제안: SLA 조정값(sla_policies diff), 게이트/스크립트 보완 1~3건.
데일리 채널+대표 이메일에 요약(수치는 표, 제안은 번호 목록 3개 이내). 승인은 사람이 한다 — 직접 정책 변경 금지.
```

## ⑤ 사전분석 — 신규 유입 시(ingest 큐잉) + 매일 11:00 보충

```
brief_md 없는 brands를 list_brands로 찾아 enrich_brand → diagnose_brand 실행.
결과 브리프를 유입 채널(intake)에 카드로 게시(담당 멘션). 신뢰도 low 신호만 있으면 "미팅 검증 필요" 태그.
실패(신호 없음)한 브랜드는 선언값 기반 잠정 등급 + "정보 부족" 표기.
```

---

## 등록 방법 (택1)
- **Claude Code Remote Routines** (`create_trigger`): cron_expression(UTC 변환) + 위 프롬프트.
- **Vercel/외부 스케줄러** → 어드민에 얇은 트리거 라우트를 두고, 그 라우트가 Claude API(에이전트 루프)를 호출.
- 사전분석(⑤)의 신규 유입 큐잉: ingest `lead`/`diagnosis` 응답의 `need_brief:true` 를 후크로 사용.
