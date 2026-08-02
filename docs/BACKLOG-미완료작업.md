# GloveK 어드민 · 미완료 작업 (2부 구성)

> **1부 = 기능·이슈 백로그(110)** · **2부 = UI 미완료 전수(35)**.
> 표기: 🔴치명/높음 · 🟡중간 · ⚪낮음 · ✅완료. 우선순위는 위에서 아래로.

---

# 1부 · 기능·이슈 백로그 (110)

> 요청하신 것 중 아직 안 된 작업 전부. 출처: 역할별 QA 감사 53건(Round1 3건 완료) + 프로토타입 UI 갭 + 외부연동 미활성 + 설계는 있으나 미구현 기능 + 운영·데이터.

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
**1부 요약**: 총 110개 · 🔴높음 ~13 · 🟡중간 ~45 · ⚪낮음 ~52 (Round1 3건 완료).

---

# 2부 · UI 미완료 전수 (35)

> 프로토타입 v2.5의 화면 33개·컴포넌트 전체를 실제 구현과 1:1 대조한 결과. (프로토타입 있음/앱 없음, 부분구현, 미적용 컴포넌트 순)

## 2-A. 미구현 화면 (프로토타입엔 있으나 앱에 없음)
U1. 🔴 **오늘(홈) 대시보드** `home` — 프로토타입 첫 화면(스탯 타일+오늘 미팅+할 일+알림 요약). 현재 `/`는 칸반뿐.
U2. 🟡 **서류·물류 통합 화면** `docs` — 온보딩 서류+물류 계약 크로스-브랜드 화면. 현재 브랜드360 탭에만 존재.
U3. 🟡 **Slack 알림 관리** `slack` — 채널 매핑·알림 규칙·발송 로그 화면. 미구현.
U4. ⚪ **사용 가이드** `guide` — 19 스태프 가이드 인앱 렌더 화면. 미구현.
U5. ⚪ **스텝플로우 검토 7종** `f-gate/f-lead/f-csv/f-zoom/f-prop/f-drop/f-invite` — 플로우 다이어그램(검토용). 미구현(문서용이라 후순위).

## 2-B. 부분 구현 화면 (있으나 프로토타입과 다름)
U6. 🔴 **미팅 캘린더 그리드** `meetings` — 현재 **표**. 프로토타입 `.cal` 주간 그리드(시간×요일, `.mtg` 색블록)로 교체.
U7. 🔴 **메일함 3분할 인터랙션** `mail` — 스레드 클릭 불가·첫 스레드 고정. `.mail3` 선택상태 + [답장 초안] 버튼.
U8. 🟡 **발송 센터 3탭** `send` — 현재 단일 목록. ✉️메일 / 📱문자 / 발송관리·채널정책 3탭 구조.
U9. 🟡 **캠페인 발송 액션** `campaign` — 세그먼트 [발송]/[초안 생성]/[+세그먼트] 버튼 미동작(정적).
U10. 🟡 **결재함 승인/반려 버튼** `approvals` — pending만 표시, 승인/반려 UI 없음.
U11. 🟡 **포털 하위 3화면** `portal` — `/portal/onboarding`(서류 업로드)·`/reports`(월간 리포트)·`/products`(인증 현황) 누락. 현재 홈·정산·문의만.
U12. 🟡 **브랜드360 게이트 체크리스트** `b360` — `.gate` 스타일 다음스텝 체크리스트 + 미충족 항목 딥링크 버튼 미적용.

## 2-C. 미적용 프로토타입 컴포넌트 (globals.css엔 있으나 화면 미사용)
U13. 🔴 캘린더 그리드 `.cal` — 미팅 화면용(U6과 연동).
U14. 🔴 메일 3분할 `.mail3` — 메일함용(U7과 연동).
U15. 🟡 게이트 체크리스트 `.gate` — 360·상태변경 카드 공통(U12).
U16. 🟡 인증 매트릭스 셀칩 `.cellchip`/`.matrix` — CardTabs 제품·인증 탭(현재 인라인 색상).
U17. 🟡 토글 스위치 `.tgl` — 설정 on/off(담당자 sync·필수항목 활성 등).
U18. 🟡 위저드 `.wiz` — 계정 초대·CSV 가져오기 단계 표시.
U19. ⚪ 라디오/체크 스타일 `.radio`/`.chk` — 폼 선택 UI 통일.
U20. ⚪ 변경 미리보기 diff 행 `.dfrow` — 병합·수정 전후 비교.
U21. ⚪ 드롭존 `.drop` — 파일 업로드(서류·자산·인증서).
U22. ⚪ Slack 카드 스타일 `.slk` — Slack 미리보기.
U23. ⚪ hover 툴팁 `data-tip` — 설명 시스템(용어·버튼 도움말).
U24. ⚪ 공통 모달/토스트 `#ovl`/`#toast` — 프로토타입 스타일 통일(현재 개별 구현).

## 2-D. 공통·전역 UI
U25. 🟡 상단 **전역 검색 실동작** — 헤더 검색창이 현재 안내문구만(결과 라우팅 없음).
U26. 🟡 **역할별 기본 진입** — 로그인 후 role별 /queue·/monitor 리다이렉트.
U27. 🟡 **반응형(모바일)** — 사이드바 접힘·테이블 가로 스크롤·포털 모바일 점검.
U28. ⚪ **빈 상태(empty state)** 문구·아이콘 일관화(제안 탭 등).
U29. ⚪ **레이아웃 폭 일관성** — 화면별 max-width 기준 통일.
U30. ✅ 파비콘 — **완료**(app/icon.svg).

## 2-E. 화면별 세부 정합 (프로토타입 디테일)
U31. 🟡 `/ops` — ScreenHeader·`.t` 테이블·색토큰·한글 상태라벨 적용.
U32. 🟡 결제 배지 라벨 전역(PAY_STATUS_LABELS: 미결제/구독중/연체…).
U33. ⚪ CardTabs 탭바 `.tabs` 스타일 + 인증 `.cellchip` 적용.
U34. ⚪ 정산 화면 4타일 정렬·행 실행버튼.
U35. ⚪ 고객 원장 plan/owner 필터 셀렉트 + SLA 위반 토글칩.

---
**2부 요약**: UI 35개 · 미구현 화면 5 · 부분구현 7 · 미적용 컴포넌트 12 · 전역 6 · 세부정합 5.
**최우선(🔴)**: U1 홈 대시보드 · U6/U13 미팅 캘린더 그리드 · U7/U14 메일함 3분할.

---

# 3부 · AI 기능·키(env) 적용 미완료 (26)

> AI 관련 기능과 그 동작에 필요한 키(env) 적용 상태. 코드는 있으나 키 미적용으로 "비활성"인 것과, 코드 자체가 미구현인 것을 구분.

## 3-A. AI 키·모델 설정 (env) — 🔴 이걸 넣어야 AI가 켜짐
K1. 🔴 **ANTHROPIC_API_KEY 미적용** — `/ask`·회의록 요약·메일 초안·사전분석 브리프 **전부 이 키 필요**. 없으면 "키 미설정" 반환하며 전부 비활성.
K2. 🔴 **OPENAI_API_KEY 또는 GROQ_API_KEY 미적용** — Whisper 한국어 전사(STT)용. 없으면 미팅 전사 자체 불가.
K3. 🟡 **모델 ID 하드코딩 3곳**(`claude-sonnet-5` — ask.ts·meeting-process.ts·email-compose.ts) → `ANTHROPIC_MODEL` env 로 중앙화(QA #15).
K4. 🟡 **MCP_TOKEN 미적용** — MCP 서버 인증. 미설정 시 fail-open(QA #29) → 필수화.
K5. ⚪ **AI 비용/레이트리밋 가드 없음** — max_tokens·재시도·월 상한 정책 미설정.

## 3-B. AI 기능 — 코드 완료, 키만 적용하면 동작 ✅→🔑
A1. 🔑 **AI 오퍼레이터 `/ask`**(Slack) — lib/ask.ts. ANTHROPIC 키만 넣으면 동작.
A2. 🔑 **AI 회의록 요약** — lib/meeting-process. ANTHROPIC 키 + transcript 필요.
A3. 🔑 **대화맥락 AI 메일 초안** — lib/email-compose + ComposeEmailButton(브랜드360). ANTHROPIC 키만.
A4. 🔑 **사전분석 브리프**(diagnose_brand) — mcp-tools. 신호 + ANTHROPIC 키.
A5. ✅ 이탈위험(score_churn_risk) — 규칙기반(AI 불필요), 이미 동작.

## 3-C. AI 기능 — 코드 미구현 (설계만 있음)
B1. 🔴 **Whisper STT 실연동** — M4A 다운로드→전사. 현재 transcript 있을 때만 요약(STT 자체 미구현, meeting-process.ts:30).
B2. 🟡 **수신 메일 → AI 답장 초안 자동** — direction=in 수집 시 reply 초안 자동 생성 트리거(09 A-5).
B3. 🟡 **QnA AI 매칭·재사용 사이클(14-E)** — 메일/회의록 질문 추출→qna 검색·재사용·후보등록.
B4. 🟡 **제안서 AI 커스텀 문구** — createProposal은 견적만. 브리프·회의록 기반 제안 문구 생성 미적용.
B5. 🟡 **인증 AI 가이드** — 필요 서류 목록(product_cert_docs 기대행) 자동 생성 미구현.
B6. 🟡 **사이클 종료 AI 결과 리포트 초안** — GMV·전월비교 리포트 미구현.
B7. 🟡 **AI 인수인계 요약**(담당 변경) — generate_handover 미구현.
B8. ⚪ **RFP 요약**(mkt_projects.rfp_summary AI) — 미구현.
B9. 🟡 **주간 자가학습 인사이트** — upsert_insight 툴은 있으나 에이전트 미등록(자동 생성 안 됨).
B10. 🟡 **캠페인·윈백 AI 대량 초안** — composeEmailAction 있으나 캠페인 화면 미연결.
B11. 🟡 **AI 패널(화면 컨텍스트)** — 대시보드 임베드 미구현(현재 Slack `/ask`만).

## 3-D. AI 인프라 (MCP·에이전트)
C1. 🔴 **MCP 서버 배포·연결** — mcp/server.ts 존재. HTTP 배포 + MCP_TOKEN + Claude 연결 필요.
C2. 🟡 **MCP fail-open 수정** — MCP_TOKEN 미설정 시 요청 거부(QA #29).
C3. 🟡 **스케줄 에이전트 5종 등록** — AGENTS-REGISTER.md 프롬프트를 실제 스케줄 작업으로(일일점검·서류리마인더·결제감시·주간학습·사전분석).
C4. ⚪ **에이전트 실행 로그·모니터링** — 실행 결과 기록/대시보드.
C5. ✅ 초안함(Drafts Inbox) — 이미 구현(참고).

---
**3부 요약**: AI 26개 · 키설정 5(K1·K2 최우선) · 키만넣으면동작 5 · 미구현 11 · 인프라 5.
**핵심**: `ANTHROPIC_API_KEY` 하나만 넣어도 **A1~A4(질의·회의록요약·메일초안·브리프)가 즉시 켜진다.** STT(B1)는 OpenAI/Groq 키 + 구현 추가 필요.

---

# 4부 · 필요 에이전트 목록 (나중에 개발) (18)

> 서비스 운영에 필요한 AI/자동화 에이전트 카탈로그. 모두 **쓰기는 /api/ops(게이트) 경유·상태변경은 제안만·사람 승인**(06 §4 안전규칙). 툴은 lib/mcp-tools.ts.
> 상태: 🟢프롬프트 준비됨(등록만) · 🟡코드일부(워커/함수 존재, 에이전트화 필요) · 🔴신규.

## 4-A. 스케줄(정기) 에이전트 5종 — docs/AGENTS-REGISTER.md 원문 있음
G1. 🟢 **일일 운영 점검** (매일 09:00) — find_sla_breaches·find_gate_violations·find_missing_docs → 파트별 Slack 요약. 툴: find_*, list_brands, send_alert.
G2. 🟢 **미제출·서류 리마인더** (매일 14:00) — find_missing_docs → draft_reminder → 온보딩 채널, 3일+ high 에스컬레이션. 툴: find_missing_docs, draft_reminder, score_churn_risk.
G3. 🟢 **결제·정산 감시** (매일 10:00) — past_due/실패/미결제 표 → 정산 채널, 안내 초안. 툴: list_brands, get_brand_360, draft_reminder.
G4. 🟢 **주간 자가학습** (월 09:00) — compute_funnel_metrics 4/8주 비교 → upsert_insight + SLA/게이트 개선 제안. 툴: compute_funnel_metrics, upsert_insight.
G5. 🟢 **사전분석** (신규유입 + 매일 11:00) — brief_md 없는 brands → enrich_brand→diagnose_brand→유입 채널 카드. 툴: enrich_brand, diagnose_brand.

## 4-B. 이벤트/트리거 에이전트
G6. 🟡 **미팅 후처리** (Zoom recording.completed) — 전사→회의록 요약→contact_logged→팔로업 초안(+설문·QnA). 코드: lib/meeting-process(STT 미완). 툴: list_meetings, draft_followup.
G7. 🟡 **이메일 수집·응대** (Gmail sync) — 브랜드 매칭 저장→무응답 감지→수신메일 AI 답장 초안. 코드: lib/gmail-client·email-sync(자동 reply 초안 미완). 툴: summarize_thread, draft_reply, list_no_reply.
G8. 🔴 **담당 배정 추천** (미배정 발생 시) — suggest_assignee 후보3+부하 → 파트장 Slack 배정 카드. 코드: lib/assign(화면 미연결). 툴: list_unassigned, suggest_assignee.
G9. 🔴 **CS 분류·답변초안** (티켓 유입) — cs_tickets 우선순위·QnA 재사용 답변초안. 툴: (신규) list_tickets, draft_reply.
G10. 🔴 **인증 만료 감시** (매일) — find_cert_risks 만료30일전/미비→담당+포털 알림, 운영중 미비=판매리스크. 툴: find_cert_risks.

## 4-C. 배치/거버넌스 에이전트
G11. 🟡 **운영 사이클 감시** (매일/말일) — 이행률 미달·시딩 게시확인(크롤러 매칭)·리포트/정산 draft. 코드: lib/operations(cron 있음, 시딩 자동확인 미완).
G12. 🔴 **데이터 대사 RECONCILE** (매일) — 사이트↔원장 정합 대사, 누락/불일치 리포트(v3 §4-5). 신규.
G13. 🔴 **중복 병합 후보** (주간) — dedup 놓친 후보 그룹 탐지→병합 제안 큐. 코드: findDuplicateGroups 있음, 에이전트화.
G14. 🔴 **갱신·업셀 감지** (주간) — 계약 만료30일·이행률90%+·문의적음 → 갱신/업셀 후보 카드(17 §3).
G15. 🔴 **재활성화·윈백** (분기) — 세미나 미전환 90일+·해지 90일후 → AI 재접촉 초안(수신동의자만). 툴: composeEmail(대량).
G16. 🔴 **정산 이상치 검토** (월초) — settlements anomaly 우선 검토·재계산 제안, 2단계 승인 연결.
G17. 🔴 **에스컬레이션 라우터** (SLA cron 연동) — T0~T3 사다리·백업담당(owner_backup) 라우팅. 코드: lib/escalation 있음, 정책 보강.
G18. 🔴 **인수인계 요약** (담당 변경 시) — 타임라인·메일·미팅 1페이지 요약→신규담당 DM. = 3부 B7.

---
**4부 요약**: 에이전트 18종 · 🟢등록만 5(G1~G5) · 🟡코드일부 4 · 🔴신규 9.
**선행조건**: `ANTHROPIC_API_KEY` + MCP 서버 배포(3부 C1) + `MCP_TOKEN`. → 그 후 G1~G5 즉시 등록 가능, 나머지는 코드 개발 후.
