# GloveK ↔ TikTok Admin 양방향 동기화 연동 요청서

> 대상: glovek.space 개발팀 · 작성: TikTok Shop Admin(admin.glovek.space)
> 목적: 두 시스템이 공유하는 **브랜드 프로필**을 항상 동일하게 유지. 어느 쪽이든 수정되면 상대에 반영(**변경분만**).

---

## 0. 현재 상태 (as-is)
- admin 은 glovek DB를 **읽기 전용**으로 15분마다 polling → 원장(brands)에 병합. (단방향: glovek → admin)
- admin 에서 브랜드 정보를 수정해도 **glovek 으로 되돌아가는 경로가 없음** → 두 값이 갈라짐.
- 임시 조치(적용됨): 동기화가 **사람이 수정한 필드는 덮어쓰지 않도록** 보호 중. (아래 6번에서 정식 방식으로 전환)

## 1. 목표 (to-be)
- 공유 필드는 **양방향**으로 동기화하여 **항상 같은 값**.
- **변경이 있을 때만** 상호 반영(전량 덮어쓰기 X). 충돌 시 **더 최근 수정이 승리(last-write-wins)**.

---

## 2. 레코드 매칭 키 (1:1 매핑)
우선순위: **① email(소문자) → ② biz_no(사업자번호) → ③ phone(숫자만)**
- 가능하면 glovek 측 **안정적 고유 ID**(예: `users.id`)를 함께 내려주세요. 이메일 변경 시에도 매핑 유지됨.

## 3. 필드 소유권 (누가 수정 권한을 갖나)
| 구분 | 필드(예시) | 동기화 방향 |
|---|---|---|
| **공유 (양방향)** | brand_name(브랜드/회사명), contact_name(담당자명), email, phone, biz_no, category(카테고리), brand_url | glovek ↔ admin |
| **glovek 소유 (glovek→admin 단방향)** | 결제상태, 구독플랜, 결제/주문내역, GMV 등 거래 사실 | glovek → admin (admin 읽기만) |
| **admin 소유 (동기화 대상 아님)** | 담당자 배정, 다음 액션, 마감일, 내부 메모, 영업 파이프라인 단계 | admin 전용 |

> 공유 필드 목록은 확정 전 협의 가능합니다(예: grade·추천트랙을 공유로 넣을지).

---

## 4. glovek → admin (변경 수신)
둘 중 하나를 제공해주세요.

**옵션 A — 변경 웹훅 (권장, 실시간)**
- 공유 레코드가 수정되면 아래로 POST:
  - `POST https://admin.glovek.space/api/partner/glovek-webhook`
  - 헤더: `X-GloveK-Signature: <HMAC-SHA256(body, 공유시크릿)>`
  - body(JSON):
    ```json
    { "id": "glovek-user-id", "email": "brand@x.com",
      "updated_at": "2026-08-08T16:40:00+09:00",
      "fields": { "brand_name": "...", "category": "...", "phone": "..." } }
    ```

**옵션 B — 폴링 유지 (최소 요구)**
- 지금처럼 admin 이 15분마다 조회하되, **각 공유 테이블에 `updated_at`(timestamptz) 컬럼**을 제공.
- admin 은 `updated_at > 마지막 동기화시각` 인 행만 가져감. (전량 스캔/덮어쓰기 방지)

> **옵션 A·B 공통 필수: 레코드별 `updated_at`(마지막 수정시각).** 이것이 "변경분만 동기화"의 핵심입니다.

## 5. admin → glovek (변경 전송) — **신규 API 요청**
glovek 이 아래 **쓰기 엔드포인트**를 만들어 주세요.
- `POST /api/partner/brand-upsert`
- 인증: `Authorization: Bearer <admin에게 발급한 토큰>`
- body(JSON):
  ```json
  { "match": { "email": "brand@x.com", "biz_no": "1234567890" },
    "updated_at": "2026-08-08T16:41:00+09:00",
    "fields": { "brand_name": "...", "contact_name": "...", "phone": "...",
                "category": "...", "brand_url": "..." } }
  ```
- 동작:
  1. `match` 로 레코드 찾기(없을 때 생성할지 여부는 협의 — 기본은 "매칭될 때만 갱신").
  2. **`updated_at` 비교** — 전달된 값이 glovek 저장값보다 최신일 때만 반영(**last-write-wins**). 오래된 값이면 skip.
  3. 반영 시 glovek 의 해당 레코드 `updated_at` 도 이 값으로 갱신(에코 루프 방지).
- 응답:
  ```json
  { "ok": true, "id": "glovek-user-id", "result": "applied" }   // 또는 "skipped_older" / "not_found"
  ```
- 멱등: 같은 `updated_at` 재전송 시 no-op.

## 6. 충돌 규칙 (동시 수정)
- 레코드(가능하면 필드) 단위 `updated_at` 비교 → **더 최근 수정이 승리**.
- 양쪽이 서로 반영할 때 **무한 에코 방지**: 반영 후 상대의 `updated_at` 을 원본 값으로 세팅하고, 값이 동일하면(diff 없음) 재전송하지 않음.

## 7. 보안
- 상호 인증: admin→glovek 는 **Bearer 토큰**, glovek→admin 웹훅은 **HMAC 서명**.
- HTTPS 필수(연락처 등 개인정보 포함) · 최소 필드만 전송 · 가능하면 상호 IP 화이트리스트.

## 8. 초기 정합(마이그레이션)
- 연동 개시 시 **1회 전량 대조**(email 기준)로 기존 불일치분을 한 번 정리한 뒤 증분 동기화로 전환.

---

## 9. 우리(admin) 쪽 준비 사항 — **구현 완료(대기 상태)**
admin 측은 아래를 모두 구현해 두었습니다. glovek 이 **URL·토큰·시크릿만 제공**하면 환경변수 설정으로 즉시 작동합니다(미설정 시 dormant).
- **glovek → admin 수신**: `POST /api/partner/glovek-webhook` (HMAC 검증 · last-write-wins · 동일값 no_change 스킵).
- **admin → glovek 전송**: 공유 필드가 바뀐 브랜드를 아웃박스에 적재 → 크론(`/api/cron/glovek-push`, glovek-sync 크론에도 포함)이 `brand-upsert` 로 변경분만 push.
- **환경변수**(glovek 이 값 제공 시 설정):
  - `GLOVEK_PUSH_URL` — glovek 의 `brand-upsert` 엔드포인트
  - `GLOVEK_PUSH_TOKEN` — 위 호출 Bearer 토큰
  - `GLOVEK_WEBHOOK_SECRET` — 웹훅 HMAC 공유 시크릿
- 값이 들어오기 전까지는 **동기화가 사람 수정값을 덮지 않는 임시 보호**가 유지됩니다(데이터 유실 방지).

## 10. glovek 에 요청하는 것 — 체크리스트
- [ ] 공유 테이블에 레코드별 **`updated_at`(timestamptz)** 노출
- [ ] (권장) 공유 레코드 변경 시 **웹훅 POST** → `admin.glovek.space/api/partner/glovek-webhook`
- [ ] **쓰기 API** `POST /api/partner/brand-upsert` (Bearer 인증, last-write-wins, 멱등)
- [ ] admin 용 **인증 토큰 발급** + 웹훅용 **공유 시크릿**
- [ ] (권장) 안정적 **고유 ID** 필드 제공
- [ ] 공유 필드 목록 최종 확정
