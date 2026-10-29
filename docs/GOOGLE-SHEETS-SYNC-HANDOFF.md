# Glovek 요청 시 시트 갱신과 처리 이력

## 확정 정책

2026-10-30 사용자 확정: 요청할 때 GPT가 Glovek 원장을 기존 구글 시트에 갱신하고 처리 이력을 관리자 API에 기록한다. 매일 예약 실행은 취소됐다. Vercel의 `/api/cron/sheets-ledger` 예약은 제거됐고 Codex heartbeat `glovek`은 PAUSED다. 나머지 기존 16개 Vercel 작업은 변경하지 않았다. 예약을 다시 등록하지 않는다.

별도 Google Cloud 로그인, Sheets API 활성화, 서비스계정·키·도메인 위임은 이 흐름에 필요하지 않다. 취소한 자동화용 서비스계정의 이 시트 편집 권한은 제거하고 소유자만 접근하는 상태를 확인했다. 기존 Gmail용 키와 다른 연동은 변경하지 않았다.

대상 시트 ID: `1I_0bgwuA6p_esSwQcKHesdSlGqR6Tgvx4fUmAf6FXYw`.
`유입·커뮤현황`과 `갱신기록`은 모두 헤더 5행이다. 신규 파일을 만들지 않는다.

## 갱신 순서

1. 기존 관리자 로그인으로 `GET /api/admin/sheets-ledger/snapshot`을 읽는다. 대표(exec)만 허용하며, 테스트를 제외하고 종료·드랍을 포함한 전체 원장과 승인된 시트 필드만 반환한다. 현재 원장 수와 고유 ID 수, 수집시각을 확인한다.
2. Google Sheets 연결 도구로 실제 헤더와 기존 데이터를 읽는다. 브랜드 ID로 행을 찾고 신규 ID는 추가한다. 정렬된 시트에서도 행 번호를 추정하지 않는다. 직접입력 메모와 사용자 추가 열, 기존 확인값은 보존한다. 삭제는 하지 않는다.
3. 날짜는 KST 날짜형, 전화번호는 문자열로 기록한다. 수신 기록을 고객 회신으로 단정하지 않는다. 링크는 원장에 있는 주소만 사용한다. 매출은 영업 대상 회사의 연매출이며 브랜드 자기신고·AI 추정·우리 수금액과 구분한다. 근거가 없으면 미확인으로 남긴다.
4. 저장 결과를 다시 읽어 대상 행·고유 ID·수집시각·신규/기존 건수와 메모 보존을 검증한다. 데이터 쓰기가 불확실하면 성공으로 기록하지 않는다. 갱신기록 탭에도 같은 작업 결과를 남긴다.
5. `/settings`의 대표 전용 **수동 시트 갱신 기록** 카드로 아래 API를 호출한다. 이 카드는 시트를 변경하는 버튼이 아니라, 완료한 작업의 처리 이력을 남기는 화면이다. 브라우저 세션 쿠키를 추출하지 않는다.
6. POST 응답 뒤 GET으로 저장된 이력을 다시 확인한다. 이력 저장에 실패한 경우 데이터를 다시 쓰지 않고 같은 작업 번호로 이력만 재시도한다.

## 처리 이력 API

`GET /api/admin/sheets-ledger/updates`: 해당 이벤트·대상 시트의 최근 20건을 반환한다.

`POST /api/admin/sheets-ledger/updates`: 로그인된 exec 세션, JSON, 같은 출처 요청만 허용한다. `CRON_SECRET`이나 쿼리 토큰을 통한 우회 경로는 없다. 응답은 `no-store`다.

| 필드 | 내용 |
|---|---|
| `runId` | 작업별 UUID. 같은 작업 재시도에 같은 값을 쓴다. |
| `sourceCollectedAt` | 시간대가 명시된 ISO 날짜. 화면 입력은 KST 분 단위다. |
| `sourceCount` | 1~100,000의 정수 |
| `updatedRows` | 기존 갱신 건수, 0 이상 |
| `appendedRows` | 신규 추가 건수, 0 이상 |
| `verifiedRows` | 시트를 다시 읽어 일치한 대상 건수 |

기존 갱신+신규 추가=대상 건수, 검증 건수=대상 건수여야 한다. 모르는 필드나 연락처·메일·금액·자유 메모·임의 시트 ID는 받지 않는다. 대상 시트는 서버의 `SHEETS_LEDGER_SPREADSHEET_ID`, 실행자는 로그인 세션에서 결정한다.

기존 `ingest_events`를 사용한다. `site=admin-manual`, `event=sheets_ledger_manual_update`, `idem_key=runId`이며 새 테이블이나 CRM 원본 변경은 없다. 검증 방식은 `gpt_sheet_readback`으로 기록한다. 이는 GPT가 시트를 다시 읽은 처리 보고이며, 서버가 Google 시트를 독립 검증했다는 뜻은 아니다.

동일 작업 번호·동일 내용은 같은 기록 ID를 반환한다(200). 다른 내용을 같은 번호로 보내면 충돌(409)이다. 신규 기록은 201을 반환한다. DB 실패는 500이며 빈 목록이나 성공으로 감추지 않는다.

## 확인된 데이터 기준점

2026-10-30 00:32 KST 수집 원장 1,298건을 시트에 반영했다. 기존 960건 갱신, 신규 338건 추가이며 native Sheets readback에서 1,298행·고유 ID 1,298개·동일 수집시각 1,298개와 메모 보존을 확인했다. 전화 1,246건, 이메일 1,283건, 카테고리 1,252건, URL 형식의 브랜드 링크 517건이다. 회사 연매출 수치는 원장에 없어 미확인이다. 다음 요청에서는 새 원장을 읽는다.

## 관련 코드와 검증 기준

- `app/api/admin/sheets-ledger/snapshot/route.ts`: 원장 조회.
- `lib/sheet-update-log.ts`: 엄격한 입력 검증과 멱등 이력 저장.
- `app/api/admin/sheets-ledger/updates/route.ts`: 대표 전용 조회/기록 API.
- `components/SheetUpdateLogCard.tsx`: 기존 설정 페이지의 작은 기록 카드.
- `tests/sheets-ledger-updates.test.ts`: 인증·CSRF·건수·중복/충돌·저장/조회 실패 경계.

운영 완료는 실제 관리자 화면에서 첫 처리 이력을 POST하고 GET으로 재조회한 뒤 판정한다. 빌드·단위 검사만으로 실제 저장 완료라고 하지 않는다.

기존 `lib/google-sheets.ts`, `syncLedgerToSheet`, cron 라우트와 `sheet_sync_runs`는 취소한 자동화의 코드/과거 실패 이력이다. 현재 운영 경로가 아니며 재실행하거나 예약에 연결하지 않는다. 다른 서비스의 기존 스케줄은 그대로 유지한다.

Claude Cloud의 Codex 브리지는 연결되지 않았다. 자동 채팅 재개가 설정됐다고 보고하지 않는다.
