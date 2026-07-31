# 04 · 대시보드 UI — 화면별 상세 스펙

> ⚠️ **우선순위 노트**: 화면 스펙은 이후 「어드민 코어 기능 기획서」(M1~M7)가 이 문서를 심화·대체한다 — 충돌 시 기획서 우선. 이 문서는 IA·공통 규약·/queue·/monitor·/pay·/settings 기준으로 유효.
> Claude Code 지시: Next.js App Router + Tailwind + shadcn/ui + TanStack로 아래 화면을 구현해줘. 모든 쓰기는 03의 ops API 호출(직접 UPDATE 금지). 내부 전용: `ADMIN_ALLOWED_EMAILS` 화이트리스트 로그인.

## 0. IA / 네비게이션

```
/            파이프라인 보드(기본)
/queue       내 워크큐(로그인 사용자 역할 기준)
/brand/[id]  브랜드 360
/monitor     SLA·게이트·알림 모니터
/pay         결제·정산
/insights    사전분석·자가학습 리포트
/settings    SLA 정책·담당자·템플릿 관리 (role=lead|exec)
```
역할별 기본 진입: intake/sales/onboard/ads/settle → /queue, lead/exec → /monitor.

## 1. 파이프라인 보드 `/`
- 칸반 컬럼 = state(종료 상태는 접힌 컬럼). 카드: 브랜드명·등급 배지(S/A/B/C)·플랜·담당 아바타·경과일(SLA 초과 시 빨간 배지)·다음 액션.
- **드래그&드롭 = ops/transition 호출.** 422면 카드가 원위치로 튕기고 실패 규칙 목록 토스트("회의록 없음 · 영업담당 미지정").
- 필터: 계약형태/플랜/국가/담당/등급/유입경로. 검색: 브랜드명·이메일·전화.
- 컬럼 헤더에 개수 + SLA 위반 수(빨강).

## 2. 브랜드 360 `/brand/[id]`
한 화면에 전부. 섹션:
1. **헤더**: 이름·등급·state 스테퍼(전이 버튼 → transition, 게이트 미충족 시 비활성+사유 툴팁)·담당 3종·이탈위험.
2. **사전분석 브리프**: brief_md 렌더 + brand_signals 표(출처·값·신뢰도) + "재분석" 버튼(06 diagnose 호출).
3. **서류 체크리스트**: doc_items 진행률 바 + 항목 토글(apply 동기 항목은 잠금 표시 + apply 어드민 딥링크).
4. **결제**: glovek orders/payments/mall_subscriptions(읽기전용 조인) + payments_manual 목록 + [수기 결제 입력] 모달.
5. **타임라인**: stage_history + brand_sources + alerts 통합 시간순(누가·언제·무엇을).
6. **액션 바**: 접촉 기록 / 리마인더 발송(초안 미리보기 모달) / 담당 변경 / 드랍(사유 모달) / 메모.

## 3. 내 워크큐 `/queue`
- "오늘 움직여야 할 브랜드" — 정렬: ①SLA 위반(오래된 순) ②오늘 마감 due_date ③다음 액션 없음.
- 행 인라인 액션: 완료 체크(log-contact), 다음 액션+기한 입력, 360 이동.
- 상단 요약칩: 위반 n · 오늘마감 n · 액션없음 n.

## 4. 모니터 `/monitor`
- 활성 alerts 테이블(kind·tier·경과·담당·스누즈/해제 버튼). tier3 상단 고정 적색.
- 게이트 위반 로그(gate_passed=false 이력).
- 파트별 SLA 준수율 주간 추이(Recharts 라인).

## 5. 결제·정산 `/pay`
- 상단 KPI: 정기 MRR(mall_subscriptions active×amount + Pro) · 활성 구독 n · past_due n · 이번달 일회결제 합(apply+manual).
- 표1 구독(glovek 조인): 브랜드·플랜·금액·next_charge_at·failures·상태. past_due 행 강조 + [리마인더] 버튼.
- 표2 일회·수기: apply onboarding_orders(paid) + payments_manual. Guarantee는 배지 "수기".
- 월별 매출 스택 차트(정기/일회/수기).

## 6. 인사이트 `/insights`
- 주간 퍼널: 단계별 전환율·평균 체류일(stage_history 집계). 병목 단계 하이라이트.
- 유입경로×전환 매트릭스(brands.source × 도달 state).
- insights 테이블: 주차·발견·제안 액션·[승인] 버튼(승인 시 sla_policies 반영 제안이면 diff 표시).
- 이탈위험 목록: churn_risk=high + 근거(신호).

## 7. 설정 `/settings`
- sla_policies 편집(숫자만, 이력 기록). admin_users CRUD(+슬랙 ID 매핑). doc 템플릿(mall/onboarding 항목 정의) 편집.
- 리마인더 이메일/문자 템플릿 편집(변수: {brand}, {missing_items}, {link}).

## 8. 공통
- 모든 목록 서버 페이지네이션·CSV export. 다크모드 불필요(내부툴, 라이트 고정). 모바일 반응형은 /queue와 360만 우선.
- 에러 규약: ops 422는 사용자 언어로 토스트, 5xx는 재시도 버튼.

## 9. 완료 기준
- [ ] 보드 드래그 → 게이트 422 반려 UX 동작
- [ ] 360에서 수기 결제 입력 → paymentConfirmed 게이트 통과 확인
- [ ] 워크큐가 역할별로 올바른 브랜드만 노출
- [ ] /pay MRR 숫자가 glovek 테이블 실데이터와 일치(검증 스크립트)
- [ ] settings에서 SLA 수정 시 다음 cron부터 반영
