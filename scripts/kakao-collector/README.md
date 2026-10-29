# Mac 카카오 수집기

Computer Use 플러그인과 카카오 API 없이, macOS 접근성 API를 사용하는 고정 Swift 프로그램으로 **이미 열린, 명시적으로 지정된 방**의 CSV 내보내기를 실행한다. CSV 원본을 보관하고 날짜·발언자·본문을 JSON으로 변환하여 인증된 기존 수신 API에 저장한다. 메시지 작성·전송, 연락처 변경, 계약·KPI 수정 코드는 없다.

## 현재 검증 범위

- 실제 Mac에서 메뉴 → 채팅방 설정 → 대화 내용 관리 → 텍스트 파일로 저장 → CSV 생성 확인.
- 이 버전은 `Date,User,Message` 형식만 파싱한다. 파일의 원문·줄바꿈을 보존한다.
- 삭제 안내처럼 날짜가 없는 행은 원본 및 `provenance.undated_events_held`에 남긴다. 날짜를 추정해서 서버에 저장하지 않는다.
- 내보내기는 **현재 Mac에 남아 있는 대화**만 보장한다. 로그인 이전 기록, 다운로드되지 않은 과거 대화, 첨부파일 원본의 완전성을 보장하지 않는다.
- 닫힌 방을 자동으로 검색해서 열거나 브랜드를 추측하여 연결하지 않는다. `expected_brand_id`가 없거나 서버 매핑과 다르면 메시지는 로컬 대기열에 남는다.
- 시스템 권한창, 잘못된 포커스, 변경된 UI, 저장 경로 불일치는 중단 사유다. 재시작 전 필요한 화면을 복구해야 한다. 잠금 화면에서의 무인 실행은 검증되지 않았다.
- 운영 수신 API의 `collector_not_configured`와 Vercel 인증 실패가 확인되어, 운영 업로드·Brand360 재조회·정기 실행 활성화는 아직 완료되지 않았다.

## 파일과 인증

런타임 폴더는 `~/Library/Application Support/GlovekKakaoCollector`이다. 폴더는 0700, 원문·DB·설정·비밀 파일은 0600으로 유지한다. 실제 자료는 Git에 넣지 않는다.

`config.json`은 다음 구조다. room_key는 처음 정한 뒤 방 이름이 바뀌어도 유지한다. `/kakao`에서 실제 대화와 브랜드 원장을 대조한 후에만 `expected_brand_id`를 채운다.

```json
{
  "endpoint": "https://admin.glovek.space/api/kakao/ingest",
  "rooms": [
    {
      "room_key": "stable-room-id",
      "room_name": "정확한 카카오 대화창 제목",
      "source": "/absolute/private/path/room.json",
      "expected_brand_id": null
    }
  ]
}
```

서버 `KAKAO_INGEST_SECRET`과 동일한 값을 런타임 폴더의 `ingest.secret`에 안전하게 공급해야 한다. 명령줄 인수·로그·채팅에 값을 출력하지 않는다. HTTP 클라이언트는 지정된 HTTPS 수신 주소만 사용하고 리다이렉트를 따라가지 않는다. 비밀 파일이 없거나 0600보다 넓은 권한이면 업로드를 중단한다.

## 실행

Python 3.9 이상과 macOS Swift 컴파일러를 사용한다. 추가 Python 패키지는 없다.

```sh
swiftc scripts/kakao-collector/mac_ax.swift -o /absolute/private/path/mac_ax
python3 scripts/kakao-collector/daily.py --binary /absolute/private/path/mac_ax --force-export --stage-only
```

`--stage-only`는 실제 CSV를 내보내고 로컬 DB에 보관만 한다. 운영 서버의 변경 배포·인증·매핑이 끝난 뒤 `--stage-only`를 제거하면 업로드한다. `--force-export`를 제거하면 한국 시각 오전 8시 이후 하루 한 번 내보내고 나머지 실행은 대기열 재시도만 처리한다.

CSV 변환만 하려면:

```sh
python3 scripts/kakao-collector/convert_export.py source.csv room.json \
  --room-key stable-room-id --room-name '정확한 대화창 제목' --timezone Asia/Seoul
```

Mac의 실제 타임존이 Asia/Seoul인지 확인한 뒤 현지 시각을 변환한다. 다른 타임존은 자동 추측하지 않는다.

## 중복·재시도·완료 기준

- 원본 CSV와 JSON 스냅샷을 보관한다. SQLite 대기열이 실행 종료 후에도 남는다.
- CSV에는 카카오 내부 메시지 ID가 없다. 방 키·시각(초)·발언자·원문·동일 메시지 발생 순번으로 ID를 만든다. 동일 시각의 동일 문장도 별개의 원문 행으로 보존한다. 전체 내보내기를 반복하는 전제이며, 임의로 잘라 만든 CSV를 입력하지 않는다.
- 시간 기준으로 오래된 행을 버리지 않고 전체 스냅샷을 재검사한다. 지연 도착한 과거 메시지도 대기열에 추가한다.
- SQLite 기본키와 서버 `brand_id + source_ref` 유니크 인덱스로 재전송을 처리한다. 같은 ID에 다른 원문이 나타나면 덮어쓰지 않고 보류한다.
- HTTP 200만으로 성공 처리하지 않는다. 서버의 `operation: verify`가 Brand360에서 사용하는 `pm_manual_comms`를 다시 읽어 계산한 해시와 원문 해시가 일치한 메시지만 `verified`로 전환한다. 이 영수증 검증과 실제 Brand360 화면 수락 검증은 별개다.
- 실패는 메시지별 지수 백오프(최대 하루)로 재시도한다. 대기열은 삭제하지 않는다. 파일 잠금으로 중복 실행을 막는다.
- 매일 08:00 실행과 15분 간격 복구 실행을 동일 명령으로 구성할 수 있다. `last_export_day`는 원문 추출 날짜이며 서버 저장 체크포인트가 아니다.
- 예약은 원문 추출의 반복 실행, 서버 인증, 실제 저장, Brand360 재조회가 확인된 뒤 한 개만 활성화한다. 기존 launchd·cron·Codex/OpenClaw 예약을 다시 확인하고 중복 수집기를 함께 활성화하지 않는다.

## 테스트

```sh
python3 -m unittest discover -s scripts/kakao-collector -p 'test_*.py' -v
npm run typecheck
```

`tests/kakao-ingest-postgres.test.ts`는 `KAKAO_TEST_DB_URL`의 테이블을 삭제해서 테스트한다. **반드시 새로 만든 폐기 가능한 로컬 테스트 DB만 지정한다. 운영 DB 사용 금지.** 실제 원문은 테스트 fixture에 넣지 않는다.
