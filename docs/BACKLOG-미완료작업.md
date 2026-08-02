# GloveK 어드민 · 미완료 작업 백로그 (요청 대비)

> 지금까지 요청하신 것 중 **아직 안 된 작업**을 전부 뽑았다. 출처: 역할별 QA 감사 53건(Round1 3건 완료) + 프로토타입 v2.5 UI 갭 + 외부연동 미활성 + 설계는 있으나 미구현 기능 + 운영·데이터.
> 표기: 🔴치명/높음 · 🟡중간 · ⚪낮음 · ✅완료. 우선순위는 위에서 아래로.

## A. QA 감사 — 버그·이슈 (53건 중 50건 미해결)

### A-1. 높음 (12건 · Round1에서 9·10·11 완료)
1. 🔴 **결재함 dead-end** — approval_requests 승인/반려 API·버튼 전무. `/api/ops/approve` + 승인 시 원액션(드랍/환불/정산) 실행 연결.
2. 🔴 **드랍 결재선 우회** — opsDrop이 비승인자도 즉시 드랍. 권한 없으면 approval_requests(kind=drop) 생성 후 승인 시에만 전이.
3. 🔴 **Ingest 멱등 유실** — 처리 실패(error) 이벤트 재전송 시 dedup으로 조용히 버려짐. status='processing'→'ok' 2단계로.
4. 🔴 **사이클 이행률 0%·알림폭주** — work_items.qty_done 갱신 경로 없음 + cycle-watch 날짜가드 없음. 시딩/라이브 집계→qty_done, 15일 이후 판정.
5. 🔴 **인증 매트릭스 국가 한글/코드 불일치** — apply·demo 인증이 카드에서 항상 '없음', 중복행 생성. 국가표기 코드로 통일/정규화.
6. 🔴 **canSend 우회(AI 메일)** — reply/followup은 마케팅 kind 아니라 광고성인데 동의검사 안 됨. 거래성 화이트리스트로 반전.
7. 🔴 **수신동의 소스 단절** — brand_contacts.marketing_consent에 쓰는 코드 없음(설문은 jsonb만). 항상 차단됨. 설문→brand_contacts upsert.
8. 🔴 **수신동의 수신자단위 미검증** — 브랜드 any-consent라 거부한 수신자에게도 발송. 수신자별 동의 판정·제외.
9. ✅ 포털 세션 쿠키 path /portal→/ (정산이의·문의 401) — **완료(Round1)**
10. ✅ assign.ts SQL 인젝션 — owner 컬럼 화이트리스트 — **완료(Round1)**
11. ✅ cron-auth fail-open→fail-closed(프로덕션) — **완료(Round1)**
12. 🔴 **메일함 스레드 클릭 불가** — 항상 첫 스레드만. 클라이언트 선택상태 또는 ?thread= 링크로.

### A-2. 중간 (19건)
13. 🟡 **상태전이 RBAC 스코프** — 담당 아닌 사람도 전이 가능. owner_* 담당/lead/exec만 허용, Board dragend 권한 체크.
14. 🟡 **제안 온보딩 티어 미선택** — onboarding_onetime 3M/5M/12M 셀렉트 노출 + createProposalAction에 tier 전달.
15. 🟡 **요약 워커 모델 ID** — claude-sonnet-5 등 유효 모델 ID/ENV 주입(3곳).
16. 🟡 **제안 sent_at/decided_at 미기록** — setProposalStatus에서 시각 기록.
17. 🟡 **정산 draft GMV/anomaly 미산출** — lives.gmv 합·est_gmv 반영해 fee·anomaly 계산.
18. 🟡 **시딩 추천 미연결** — suggestCreators 호출 화면/API + 채택→seedings 적재 흐름.
19. 🟡 **Backfill state 역전 방지** — 앞선 state 덮어쓰기 방지(advanceStateIfAhead 패턴).
20. 🟡 **인증 완료율에 만료 포함** — 만료 인증 제외하고 롤업.
21. 🟡 **국가별 다중 인증 표시** — (product,country) 배열 롤업, 팝오버 다중 cert_type 편집.
22. 🟡 **발송 게이트 커버리지** — brand_id 없는 마케팅 발송도 차단.
23. 🟡 **캠페인 발송/초안 버튼 미동작** — 클라이언트+서버액션 연결.
24. 🟡 **설문 재제출 방지** — responded_at 있으면 거부(멱등).
25. 🟡 **pq() 격리 정규식 약함** — brand_id=$1 강제만 통과(폴백 $1 분기 삭제).
26. 🟡 **포털 devLink 노출 게이트** — NODE_ENV!=='production'에서만 반환.
27. 🟡 **낙관적 잠금 미사용** — brands.version 기반 UPDATE...AND version=$ + 409 처리.
28. 🟡 **RBAC inactive 구분** — inactive 사용자 명시 거부.
29. 🟡 **MCP 서버 fail-open** — MCP_TOKEN 미설정 시 거부(프로덕션).
30. 🟡 **/ops 디자인 정합** — ScreenHeader·.t·색토큰·한글라벨.
31. 🟡 **결제 배지 전역 라벨** — PAY_STATUS_LABELS 맵 적용(customers·360·mail).

### A-3. 낮음 (22건)
32. ⚪ 역할별 기본 진입 리다이렉트(intake→/queue 등)
33. ⚪ 공통 헤더 전역 검색(프로토타입 top bar) 실동작
34. ⚪ /settings 하위 Slack 매핑·인앱 가이드(19) 화면
35. ⚪ 견적 할인상한 발송잠금/결재 연결
36. ⚪ 제안 version 채번 통일(두 경로)
37. ⚪ 제안 탭 빈상태 문구/발송 표기
38. ⚪ 회의록 소프트게이트 실제 summary 존재로 판정
39. ⚪ 미팅 다음스텝 가이드 데드삼항 제거+요건 합산
40. ⚪ 사이클 발행 tx 묶음 + ON CONFLICT
41. ⚪ ingest source 값 검증(SOURCES 화이트리스트)
42. ⚪ 물류 (brand_id,country) ON CONFLICT/편집·삭제
43. ⚪ docs→setup 물류 doc_item을 계약상태로 파생
44. ⚪ SMS 제목 44바이트 절단 헬퍼
45. ⚪ 발송 상태 라벨 공용 상수 통일
46. ⚪ DB TLS 기본 rejectUnauthorized:true + provider CA
47. ⚪ 포털 격리 가드 정규식 단일화
48. ⚪ assign N+1 → 단일 집계 쿼리
49. ⚪ CardTabs .cellchip/.tabs 프로토타입 클래스
50. ⚪ 정산 4타일 정렬·실행버튼
51. ⚪ 전역 레이아웃 폭 일관성
52. ⚪ 캠페인 아이콘 배경 모디파이어
53. ⚪ 고객 원장 plan/owner 필터·SLA 토글칩

## B. 프로토타입 v2.5 UI 100% 정합 갭
54. 🔴 **미팅 캘린더 그리드** — 현재 표. 프로토타입 `.cal` 주간 그리드(시간×요일, `.mtg` 색블록)로.
55. 🟡 **오늘(홈) 대시보드** — 프로토타입 첫 화면(스탯 타일+오늘 할일+미팅). 현재 `/`=보드만.
56. 🟡 **발송 센터 3탭** — ✉️메일/📱문자/발송관리·채널정책 탭 구조.
57. 🟡 **메일함 3분할 인터랙션** — 스레드 선택·답장 초안 버튼 동작.
58. 🟡 **브랜드 360 우측 컬럼** — 게이트 체크리스트 `.gate`·다음스텝 딥링크 버튼 프로토타입 세부.
59. ⚪ 스텝 플로우 검토 화면 7종(f-gate·f-lead·f-csv·f-zoom·f-prop·f-drop·f-invite) — 문서용, 앱 미반영
60. ⚪ 계정 초대 위저드(f-invite) UI
61. ⚪ 전역 검색 top bar 실동작(B33 중복)
62. ⚪ hover 툴팁(data-tip 설명 시스템)
63. ⚪ 모달/토스트 공통 컴포넌트(#ovl·#toast) 프로토타입 스타일
64. ⚪ 반응형(모바일) 점검 — 사이드바 접힘·테이블 스크롤

## C. 외부 연동 활성화 (env·앱 생성 필요)
65. 🔴 **3사이트 ingest 발신** — glovek.space/apply.tpartners.live/tpartners.live 개발자에 프롬프트 전달·구현(docs/HANDOFF).
66. 🔴 **실데이터 41건 backfill** — brands_master_v0.csv 적재(현재 데모 12건만).
67. 🟡 **Slack App** — 매니페스트·토큰·채널ID·담당자 slack_user_id 매핑.
68. 🟡 **스케줄 에이전트 5종 등록** — docs/AGENTS-REGISTER.md 프롬프트를 스케줄 작업으로.
69. 🟡 **Zoom S2S 앱·웹훅** — recording.completed 등 + admin_users.zoom_email 매핑.
70. 🟡 **Whisper STT 실연동** — OPENAI/GROQ 키 + M4A 다운로드→전사(현재 transcript 있을 때만 요약).
71. 🟡 **Gmail 도메인위임 승인** — Workspace 관리콘솔 + GOOGLE_SA_KEY_JSON(코드는 준비됨).
72. 🟡 **Resend 도메인 인증** — SPF/DKIM + RESEND_FROM.
73. 🟡 **Aligo 발신번호·발송IP** — 발신번호 등록 + IP 비우기/프록시(ALIGO_PROXY_URL).
74. 🟡 **MCP 서버 배포** — HTTP 전송+MCP_TOKEN, Claude 연결.
75. ⚪ Vercel Cron 스케줄 등록(sla-check·escalate·gmail-sync·meeting-process·cycle-*).
76. ⚪ Sentry·Analytics·업타임(/api/health) 관측 연결.

## D. 설계는 있으나 미구현 기능 (문서 스펙 대비)
77. 🔴 **PULL sync — apply/tpartners/notion** — glovek만 있음(sync_state). 나머지 3소스 증분 수집.
78. 🔴 **RECONCILE 일일 대사** — 사이트↔원장 정합 대사(v3 §4-5) 미구현.
79. 🟡 **product_sync 이벤트** — apply STEP4 제품·국가 인증 요약 수신(02 카탈로그 확장).
80. 🟡 **줌 예약 연동(meeting.created)** — D-1 리마인더·노쇼 감지·담당 자동배정 카드.
81. 🟡 **AI 인수인계 요약** — 담당 변경 시 1페이지 요약 자동 생성(09-B-3).
82. 🟡 **일괄 재배치** — from→to 벌크 이동 + 백업담당 승격(09-B-3).
83. 🟡 **부하 대시보드** — 담당자별 커버·위반·무응답(loadDashboard 있음, 화면 미연결).
84. 🟡 **정산 2단계 승인** — confirmed→명세 PDF→포털 게시·메일→paid(결재선).
85. 🟡 **리포트/명세 워커(Inngest/QStash)** — 200부 리포트·정산 명세 큐 처리.
86. 🟡 **포털 나머지 화면** — /portal/onboarding·/reports·/products(현재 홈·정산·문의만).
87. 🟡 **해지 윈백 큐(90일)** — 성과 있던 해지 브랜드 재제안 초안 자동.
88. 🟡 **재활성화 캠페인 실행** — 세미나 미전환 ~400건 분기 캠페인(세그먼트→발송).
89. 🟡 **국가 추가 액션** — 360 [국가추가]→재견적→인증케이스·물류·워크아이템 연쇄(17 §3).
90. 🟡 **수신거부 원클릭** — 광고메일 하단 링크→consent=false 기록 엔드포인트.
91. 🟡 **QnA 자산화 사이클** — 답장/회의록 질문 추출→qna 후보 등록→승인.
92. ⚪ 인증 만료 30일 전 cron 알림(cert_risk) — 화면엔 있으나 알림 발화 미구현.
93. ⚪ 재고 shipped 14일 미도착 알림.
94. ⚪ 계약 end_date-30일 갱신 알림.
95. ⚪ replay 스크립트(ingest_events 오류 재처리).
96. ⚪ DR 복구 리허설·staging 시드 절차.
97. ⚪ 보존기간 파기 cron(assets retention·종료브랜드 1년).
98. ⚪ presence(동시 열람)·코멘트 멘션 DM·409 잠금(13 협업 심화).

## E. 운영·데이터 세팅 (사람 작업)
99. 🔴 admin_users(담당 30~40명)·teams 시드 + Slack/zoom/gmail 매핑.
100. 🟡 기존 계약 16건 terms(수수료·약정) 입력.
101. 🟡 이름충돌 261건 대표명 승인(중복정리 큐).
102. 🟡 brands_master 검수(계약·서류 22건).
103. 🟡 사업 결정 2건 반영(Guarantee 직접결제화 / 온보딩 정기화) → 정산 런.
104. ⚪ 설문 문항 settings 편집 UI.
105. ⚪ SLA 정책 실측 캘리브레이션 지속 조정.

## F. 테스트·품질
106. 🟡 통합/E2E 자동화 — 07 §D E2E 8단계 시나리오 스크립트.
107. 🟡 게이트·정산·견적 외 도메인 로직 테스트 확대(현재 50개).
108. ⚪ 계약 테스트 — 3사이트 ingest 규격 검증 스크립트.
109. ⚪ 접근성(a11y)·키보드 내비 점검.
110. ⚪ 부하/성능 SLO 측정(p95 목록<1.5s·ops<500ms).

---
**요약**: 총 110개 · 🔴높음 ~13 · 🟡중간 ~45 · ⚪낮음 ~52 (Round1 3건 완료). QA 5라운드로 A그룹(특히 A-1 높음)부터 순차 수정 중.
