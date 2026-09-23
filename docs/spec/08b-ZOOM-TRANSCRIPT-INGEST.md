# 08b · Zoom 클라우드 전사 자동 수집 (구현 메모 · 설정 안내)

08 스펙의 "녹화 → 회의록" 흐름 중 **Zoom이 만든 전사(VTT)를 그대로 가져오는 경로**를 구현한 것.
녹음만 있고 전사가 없는 경우를 숨기지 않고 화면에 표시한다.

## 흐름

```
Zoom 클라우드 녹화 종료
  → (웹훅) recording.completed            → 회의·녹화 파일 기록 · 전사 대기(pending)
  → (웹훅) recording.transcript_completed → VTT 내려받기 → 전사 저장(ready)
  → 전사가 끝내 안 오면 24시간 뒤 recording_only(녹음만 있음)로 표시
브랜드 매핑: 예약 연결 > 참석자 이메일 > 미매핑 검토함
```

- 웹훅은 **접수만** 하고 200을 즉시 반환한다(`zoom_webhook_events`).
  실제 처리는 응답 직후(`after`) 또는 크론 `/api/cron/zoom-ingest`(15분)에서 한다.
- 같은 이벤트가 다시 와도 `dedupe_key`(이벤트+회의 UUID+파일 id)로 한 번만 저장된다.
- 전사 실패는 지수 백오프(20분 → 최대 12시간)로 재시도하고, 6회를 넘기면 대기함에서 내린다.

## 브랜드 매핑 규칙 (lib/zoom-match.ts)

1. **예약 연결** — 시스템에서 잡은 미팅(브랜드 지정 + 줌 링크의 회의 ID)과
   **이번 회차 시작 시각이 ±12시간 이내**일 때만 연결한다.
   반복 회의는 숫자 회의 ID가 매 회차 같으므로 **ID만으로는 절대 합치지 않는다.**
2. **참석자 이메일**(보조) — 별칭·브랜드 이메일과 일치하고 후보가 하나일 때만.
3. 후보가 여러 브랜드로 갈리거나 근거가 없으면 **미매핑 검토함**에 두고 근거를 남긴다.
   제목·AI 추측만으로는 브랜드를 확정하지 않는다.
4. 담당자가 손으로 연결하면 `match_method='manual'`로 고정돼 이후 자동 매핑이 덮어쓰지 않는다.
   모든 연결·정정은 `meeting_brand_links`에 근거와 함께 남는다.

## 보안

- **다운로드 토큰이 붙은 URL은 저장하지 않는다.** 화면·DB에는 사람이 여는 `share_url`만 둔다.
- 토큰은 항상 `Authorization: Bearer` 헤더로만 보낸다(쿼리스트링 금지 — 로그·리퍼러 노출).
- 웹훅은 HMAC 서명 + **타임스탬프 5분 창**으로 재전송을 막는다.
- 회의록은 기존 브랜드 화면 권한을 그대로 따른다(별도 공개 경로 없음).
- 사람이 적은 회의록·전사는 자동 수집이 **덮어쓰지 않는다**.

## 운영 화면

`/meetings` 하단 **「🎥 Zoom 녹화·전사 수집」**
연동 상태 · 마지막 웹훅/전사 수집 시각 · 대기 · 녹음만 · 실패 · 미매핑 수,
실패 내역별 **재처리**, **과거 회의 가져오기(미리보기 → 건별 수집)**.
과거 가져오기는 자동 실행하지 않는다.

브랜드 화면 **회의록 탭**: 날짜 · 제목 · 참석자 · 수집 상태 · 전사 원문 · Zoom 녹화 열기.
AI 정리와 전사 원문은 구분해 표시한다.

## 설정 (계정 관리자 작업 — 코드 배포와 별개)

1. **Zoom 계정**: 클라우드 녹화 ON + **오디오 자동 전사(Audio transcript) ON**.
   전사는 요금제·지원 언어에 따라 생성되지 않을 수 있다. 한국어 품질은 08 스펙의 경고를 참고.
2. **Server-to-Server OAuth 앱**(이미 있으면 재사용) → env
   `ZOOM_ACCOUNT_ID` · `ZOOM_CLIENT_ID` · `ZOOM_CLIENT_SECRET`
   필요 스코프: 클라우드 녹화 읽기(`cloud_recording:read:list_account_recordings:admin`,
   구 표기 `recording:read:admin`) + 사용자/회의 읽기. **관리자 승인 필요.**
   ※ 스코프 이름은 Zoom 콘솔 화면에서 실제 항목명을 확인해 체크할 것.
3. **Event Subscription** → `{ADMIN_URL}/api/zoom/webhook`, `ZOOM_WEBHOOK_SECRET` 설정
   구독 이벤트: `recording.completed`, `recording.transcript_completed`
   (+ 기존 `meeting.created` / `meeting.updated` / `meeting.deleted`)
4. **마이그레이션 0097** 적용(설정 → DB 마이그레이션 상태).

토큰이 없으면 전사 파일을 내려받을 수 없다. 단, 웹훅이 준 `download_token`은 약 24시간
유효하므로 그 안에 들어온 건은 API 미설정 상태에서도 수집된다.
