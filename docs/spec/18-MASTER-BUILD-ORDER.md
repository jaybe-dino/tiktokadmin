# 18 · 마스터 빌드 오더 — Claude Code 작업 지시서 (전체 감사 + 단계별 착수 프롬프트)

> **이 문서 하나로 어느 Claude Code 세션에서든 빠짐없이 일을 시킬 수 있다.**
> §1 감사 매트릭스 = 무엇이 어디에 설계돼 있고 어디까지 구현됐는지. §2 = 단계별 복붙 착수 프롬프트. §3 = 공통 지시 헤더.

---

## 1. 설계 완결 감사 매트릭스 (요구 → 문서 → 구현 상태)

| # | 영역 | 설계 문서 | 코드(v0.2) |
|---|---|---|---|
| 1 | 원장·스키마(v3: 별칭·sync_state·is_test) | 01 + v3설계서 §2 | ✅ migrations 001·002 |
| 2 | Ingest PUSH(이벤트 6종·멱등·필터) | 02 + v3 §4-1 | ✅ |
| 3 | 게이트·상태머신·ops API | 03 | ✅ |
| 4 | SLA cron·에스컬레이션 사다리 | 03 + v3 실측값 | ✅ |
| 5 | PULL sync(glovek)·sync_state | v3 §4-2 | ✅ (apply·tp·notion pull ⬜) |
| 6 | 파일 교류 API(사이트측) | 11(export키트) §D | ⬜ 사이트 작업 |
| 7 | RECONCILE 일일 대사 | v3 §4-5 | ⬜ |
| 8 | 화면: 보드·360·워크큐·모니터·고객목록(완결성)·승인함 | 04 + 코어기획 M1 | ✅ 기본 |
| 9 | 권한·조직 RBAC·승인 워크플로 | 12 | ✅ 스키마+기본 (scope 쿼리·org 설정화면 ⬜) |
| 10 | 협업(코멘트·멘션·presence·잠금) | 13 | ✅ 스키마+코멘트 기본 (멘션DM·presence UI·409 ⬜) |
| 11 | Slack App(명령·액션) | 05 | ✅ 기본 3명령+4액션 (모달·chat.update ⬜) |
| 12 | 줌 회의록→팔로업 자동화 | 08 | ⬜ |
| 13 | Gmail 수집·무응답·답장초안 | 09-A | ⬜ |
| 14 | 담당 배정 엔진(후보·부하·일괄) | 09-B | ✅ 수동배정 (후보추천·부하·일괄 ⬜) |
| 15 | 고객카드 심화: 회사·제품·인증·제안·계약·자산 | 10 + 코어기획 M2~M6 | ⬜ |
| 16 | 카드 갭: 설문·브랜드측 인물·재고·물류계약·QnA | 14 | ⬜ |
| 17 | 사전분석·MCP·에이전트 5종 | 06 | ⬜ |
| 18 | 운영대행: 사이클·시딩·라이브·CS·정산 런 | 15 | ⬜ |
| 19 | 브랜드 포털 | 16 | ⬜ |
| 20 | 해지·환불·갱신·업셀·재활성화·컴플라이언스·DR·SLO | 17 | ⬜ |
| 21 | 사이트 연동(3사이트 ingest 발신) | 07(+02) | ⬜ 사이트 작업 |
| 22 | 초기 적재(backfill 631) | v3 §6 + 스크립트 | ✅ 스크립트 (실행은 배포 후) |

**설계 공백: 없음.** (1~22 전 영역이 문서로 커버 — 남은 것은 구현뿐)

## 2. 빌드 단계 & 착수 프롬프트 (각 단계를 새 Claude Code 세션에 복붙)

> 모든 세션 공통: **§3 공통 지시 헤더를 먼저 붙이고**, 해당 단계의 문서 파일들을 레포 `docs/`에 넣어둔 뒤 시작.

### Phase 1 · 배포·연동 개통 (지금)
```
[공통 헤더 + docs/07, docs/02 첨부]
glovek-admin v0.2를 기준으로:
1) Vercel 배포 점검(빌드 에러 있으면 수정), 2) 07 문서의 프롬프트를 참고해
사이트 3곳의 ingest 발신 코드가 이 어드민의 /api/ingest 규격과 정확히 맞는지 검증하는
계약 테스트(스크립트)를 작성, 3) 07 §D의 E2E 시나리오 8단계를 자동화 테스트로.
```

### Phase 2 · 고객카드 완성 (M2~M6 + 14 갭)
```
[공통 헤더 + docs/10, docs/14, 코어기획서 첨부]
migrations/003_card_gaps(14 문서: surveys·brand_contacts·inventory_intakes·logistics_contracts·qna_entries).
※ 마이그레이션 정규 번호: 003=카드갭(14) · 004=커뮤니케이션(08·09) · 005=운영(15) · 006=포털(16) · 007=라이프사이클(17). 360을 14-G 탭 구성으로 확장:
연락처(인물CRUD)·설문(발송/응답 공개페이지 /s/{token})·제품·인증 매트릭스·재고·물류·계약(terms 빌더).
제안 생성기(M4: computeQuote 이식 — docs/logic_source.md의 원문 사용)까지.
완료 기준은 각 문서 하단 체크리스트.
```

### Phase 3 · 커뮤니케이션 자동화 (줌·Gmail·Slack 심화)
```
[공통 헤더 + docs/08, docs/09, docs/05 첨부]
1) 08: Zoom 웹훅→Whisper 전사→회의록→contact_logged 자동→팔로업 초안(+14-A 설문 링크 포함).
0) migrations/004_communications(08·09 스키마).
2) 09-A: Gmail 도메인 위임 sync(브랜드 매칭만)·무응답 감지·답장 초안(QnA 재사용 14-E).
3) 05 심화: 버튼 모달(transition 선택·담당 select)·chat.update 카드 갱신·개인 다이제스트.
민감정보 규칙(각 문서 명시) 준수.
```

### Phase 4 · AI 레이어 (MCP·에이전트)
```
[공통 헤더 + docs/06, 코어기획 M7 첨부]
MCP 서버(툴 카탈로그 전체) — 읽기는 DB 직결, 쓰기는 반드시 /api/ops 경유.
Claude 스케줄 에이전트 5종 프롬프트는 06 §3 원문 그대로 등록 가능하게 README에 정리.
AI 패널(화면 컨텍스트)·초안함(Drafts Inbox) UI.
```

### Phase 5 · 운영 엔진 (15)
```
[공통 헤더 + docs/15, docs/12(승인) 첨부]
migrations/005_operations(ops_cycles·work_items·seedings·lives·cs_tickets·settlements).
사이클 cron 4종 · 시딩 파이프라인(/seeding, glovek creators 추천·videos 자동 게시확인) ·
정산 런(+2단계 승인) · 리포트/명세는 큐 워커(Inngest)로. 화면: /ops·/seeding·/lives·/cs.
```

### Phase 6 · 포털·거버넌스 (16·17)
```
[공통 헤더 + docs/16, docs/17 첨부]
migrations/006_portal + 007_lifecycle 포함.
브랜드 포털(/portal: 매직링크·brand_id 강제 격리·6화면·비노출 원칙) +
17 전체: 해지 연쇄·환불 승인·갱신/업셀/국가추가·재활성화 캠페인·수신동의 차단·
replay 스크립트·/api/health·staging 시드. 완료 기준 체크리스트로 검수.
```

## 3. 공통 지시 헤더 (모든 세션 맨 앞에 복붙)

```
너는 Glovek 운영 어드민(glovek-admin 레포)을 개발한다. 절대 규칙:
1. 설계 문서(docs/)가 스펙이다. 충돌 시 우선순위: 최종설계 v3 > 01(스키마) > 03(게이트) > 각 문서.
2. glovek 기존 테이블(users·orders·payments·mall_subscriptions·onboarding_applications·
   consult_requests·inquiries·referrers·utm_events·brand_stats 등)은 절대 쓰기 금지(읽기전용).
   lib/db.ts의 assertNotGlovekWrite 가드를 우회하지 말 것.
3. 모든 상태 변경·발송·정산 쓰기는 /api/ops(게이트)를 경유한다 — 화면·Slack·MCP 공통.
4. 상태값·enum은 lib/states.ts canonical 그대로(임의 추가·변경 금지).
5. dedup은 lib/dedup.ts 경유(email→phone→biz_no→name+url→aliases). 무조건 INSERT 금지.
6. 민감정보: 카드·신분증·비밀번호는 저장/로그/AI컨텍스트 금지. 시크릿은 env만.
7. 마이그레이션은 migrations/ 순번 파일 + scripts/migrate.ts. 기존 파일 수정 금지(새 번호 추가).
8. 완료 기준: 해당 문서 하단 체크리스트를 하나씩 검증하고 결과를 보고할 것.
9. 시간: DB는 UTC, 표시·SLA는 KST. 테스트 데이터는 is_test=true 격리(삭제 금지).
```

## 4. 사람이 하는 일 (Claude Code 밖 — 체크리스트)

- [ ] GitHub 레포 생성·zip 푸시 / Vercel+공유 Postgres 연결 / env 세팅
- [ ] migrate + backfill(brands_master_v0.csv) 실행 → 631건 확인
- [ ] admin_users·teams 시드(담당자 30~40명 명단) + Slack ID 매핑
- [ ] Slack App 생성(05 매니페스트)·Zoom S2S 앱(08)·Gmail 도메인 위임(09) 각 1회 설정
- [ ] 기존 계약 16건 terms 입력(M3 화면 완성 후)
- [ ] 사업 결정 2건(Guarantee 직접결제화 / 온보딩 정기화) — 15 정산 런에 반영
- [ ] brands_master 검수(계약·서류 22건) + 이름충돌 261건 대표명 승인(M1 큐에서)
