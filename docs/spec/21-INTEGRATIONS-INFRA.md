# 21 — 외부 연동 투두 · 서버 인프라 (기능정의서 v1.0 §7~§9 요약)

> 정본은 「GloveK_기능정의서_v1.docx」 §7(연동)·§8(인프라)·§9(로드맵). 이 문서는 개발문서 세트용 요약본.

## 1. 외부 연동 10종 — 방식·투두 요약

| # | 연동 | 방식 | 핵심 투두 | 기간 |
|---|---|---|---|---|
| 7.1 | Zoom | S2S OAuth 내부 앱 + Webhooks | 토큰 모듈 · 미팅 CRUD(제안/캘린더 DnD PATCH) · 웹훅(meeting.\*, recording.completed) 서명 검증 · 호스트→담당 매핑 · 녹취→요약→팔로업 잡 · 예약 링크 플로우 | 4~6일 |
| 7.2 | Google Drive + Calendar | Drive API v3(서비스 계정·공유 드라이브) changes 동기화 | 동기화 워커(5분 폴링/푸시) · 폴더↔파트 매핑+파일명 브랜드 매칭 · 업로드→드라이브 저장 · 자산 선택기 백엔드 · 민감서류 필터 · Calendar upsert | 5~7일 |
| 7.3 | Meta Lead Ads | Webhooks(leadgen) + Graph API | 웹훅 검증·수신 · 리드 상세 조회·필드 매핑 · dedup→원장 등록→STEP 0 · 토큰 갱신 · 백필 | 3~4일 (+심사 1~2주) |
| 7.4 | glovek.space | read-only DB + 결제 웹훅 + 딥링크 | 진단·회원·구독 읽기 · payment.completed→상태 연쇄 전진 · 서명·멱등 · 결제 딥링크 · 5대 지표 동기화(보정값 우선) | 3~5일 |
| 7.5 | 이메일 (Gmail) | Gmail API 도메인 위임 + watch/PubSub | 계정별 수신 파이프라인 · 원장 매칭→카드 연결 · 발송 모듈(개별·대량 공용, 회사 계정 강제) · 대량 큐 rate limit · 오픈/클릭 추적 · contact fan-out | 6~8일 |
| 7.6 | 문자 SMS/LMS | 국내 발송사 API(발신번호 사전등록) | 발송 모듈(지정 번호 고정) · 결과 웹훅→로그+카드 기록 · (광고) 표기·080 수신거부·동의 필터 | 2~3일 |
| 7.7 | Slack | Bot + Events + Interactivity | 라우팅 테이블(어드민 화면 연동) · Block Kit 카드 · 버튼→어드민 API 양방향 · on/off 설정 | 3~4일 |
| 7.8 | AI (Claude API) | 용도별 프롬프트 + 잡 큐 | 템플릿 10종·컨텍스트 빌더(민감정보 제외) · 브리프/팔로업/재진단/심층분석 잡 · draft→승인 UI · 비용·품질 로깅 | 5~7일 |
| 7.9 | Remake Studio | 내부 API/공유 DB | 성과 콘텐츠 임계값 필터 → asset_refs 자동 등록 → 루틴 캠페인 연결 | 2일 |
| 7.10 | 기타 | 국세청 사업자 상태조회 · Sentry | 진위·휴폐업 확인 래퍼 · 오류 추적·웹훅 실패 알람 | 1일 |

**우선순위**: ① 이메일+Slack(기반) → ② Meta+glovek(원장 파이프라인) → ③ Zoom → ④ Drive → ⑤ AI 고도화 → ⑥ SMS·Remake·기타(병렬 가능).

## 2. 서버·인프라

- **스택**: Next.js(웹) · NestJS/Node(API — 게이트 검증 서버 강제) · PostgreSQL · Redis+BullMQ(워커: Drive 동기화·발송 큐·AI 잡·SLA 크론) · 웹훅 게이트웨이(/webhooks/* — 검증 후 큐 투입만)
- **스토리지**: 자산 원본 = Google Drive(P7) · 시스템 생성물(녹취·리포트) = S3 호환
- **인증**: Google Workspace OAuth(도메인 제한) + RBAC는 DB(파트×T0~T3×브랜드 담당)
- **환경**: dev → staging(별도 웹훅 URL·테스트 계정) → production. admin.glovek.space / hooks.glovek.space, HTTPS 필수
- **보안·운영**: 전 웹훅 서명 검증+멱등+재시도+실패 알람 · 감사 로그 전량(삭제 불가) · 시크릿은 환경변수만(P10) · DB 일 백업+PITR · Sentry+업타임+큐 적체 알람 · SLO: 가용성 99.5%, 웹훅 유실 0, 발송 지연 5분 이내
- **월 비용 개략(초기)**: 호스팅 $40~100 · DB/Redis $30~80 · Claude API $50~300 · 문자 건당(SMS 9~15원) · Zoom/Workspace 기존 플랜

## 3. 로드맵 (18 문서 Phase와 정합)

1. **코어 원장** (+이메일 최소·Slack) — 리드 등록→상태 전진→알림 완주
2. **유입·SLA** (+Meta·glovek 읽기) — 광고 리드 자동 등록·방치 차단
3. **영업 자동화** (+Zoom·AI 초안) — 미팅→팔로업→제안 반자동
4. **계약·결제** (+glovek 결제 웹훅) — 결제 확인이 상태를 민다
5. **커뮤니케이션·자산** (+Gmail watch·SMS·Drive) — P5·P7 철칙의 시스템 강제
6. **운영·확장** (+AI 고도화·Remake) — 운영·정산·포털·심층분석
