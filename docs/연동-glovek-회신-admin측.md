# GloveK ↔ TikTok Admin 양방향 동기화 — admin 회신 (§8 미결 확정)

> 회신: TikTok Shop Admin(admin.glovek.space) → glovek.space 개발팀
> glovek 회신(구현 완료 안내)에 대한 답신입니다. admin 측 구현도 완료되어, **토큰/시크릿 공유 후 즉시 연동 개시 가능**합니다.

---

## §8 미결 4항목 회신

1. **공유 필드 최종 확정** — 현재 7개 유지로 확정합니다.
   `brand_name, contact_name, email, phone, biz_no, category, brand_url`
   - `grade`(셀러등급)·`recommended_track`(추천트랙)은 **공유에 포함하지 않습니다**. glovek 진단값이므로 **glovek → admin 단방향**(기존 `admin-ingest` 경로)으로 유지합니다.

2. **매칭 없을 때 생성(create) 허용 여부** — **비활성(create:false)** 로 확정합니다.
   - admin 은 `brand-upsert` 호출 시 항상 `create:false` 로 보냅니다. 매칭 실패 시 `not_found` 처리(신규 생성 안 함).

3. **웹훅 수신 URL** — **기본값 사용**: `POST https://admin.glovek.space/api/partner/glovek-webhook`
   - `X-GloveK-Signature` = `HMAC-SHA256(rawBody, PARTNER_WEBHOOK_SECRET)` 로 검증합니다(구현 완료).

4. **토큰/시크릿 공유 채널** — 안전한 채널(1Password 공유링크 또는 사내 보안 채널)로 1회 전달 부탁드립니다.
   - admin 환경변수 매핑: `PARTNER_ADMIN_TOKEN → GLOVEK_PUSH_TOKEN`, `PARTNER_WEBHOOK_SECRET → GLOVEK_WEBHOOK_SECRET`.

---

## 동기화 적용 범위 — **glovek 출처 브랜드 한정(중요)**
- admin→glovek push 는 **glovek 에서 받은 브랜드에만** 동작합니다. 판별: glovek 안정 PK(`glovek_user_id`) 보유 또는 `source`가 `glovek*`.
- admin 자체 리드/CSV/마케팅 직접등록 브랜드는 glovek 에 없으므로 **절대 push 하지 않습니다.**
- glovek 웹훅이 admin 의 기존 브랜드와 (email/사업자번호/전화) 매칭되면, 해당 브랜드에 `glovek_user_id`를 연결해 이후 양방향 동기화 대상에 편입합니다.

## admin 측 구현 정합 확인 (glovek 스펙 대비)

- **admin → glovek (push)**: `POST /api/partner/brand-upsert`
  - `match { id, email, biz_no, phone }` (우선순위 id→email→biz_no→phone)
  - `fields`: 쓰기 대상만 `brand_name, contact_name, phone, category, brand_url` (email·biz_no 는 매칭키라 제외)
  - `updated_at`: admin 의 `profile_updated_at`(공유 필드 전용 수정시각), `create:false`
  - 변경분만 전송(아웃박스 큐), 응답 2xx 시 큐 제거.
- **glovek → admin (webhook)**: `/api/partner/glovek-webhook`
  - HMAC 검증 → `id→email→biz_no→phone` 매칭 → `profile_updated_at` 기준 last-write-wins
  - 동일값이면 `no_change` 로 스킵(추가 에코 차단).
- **에코 방지**: glovek 이 brand-upsert 반영 시 웹훅 미발신 → 왕복 루프 없음(확인).

---

## 연동 개시 순서 (합의)

1. glovek: `PARTNER_ADMIN_TOKEN`·`PARTNER_WEBHOOK_SECRET` 발급 → 안전 채널로 공유.
2. admin: 토큰/시크릿을 env 등록(완료 예정) + 코드 배포 + DB 마이그레이션(profile 컬럼/아웃박스) 적용.
3. **초기 정합(1회)**: admin 이 `GET /api/partner/brands`(since 없이) 전량 조회 → email 기준 대조로 기존 불일치 정리. *(옵션 B 폴링 사용 시. 상시 동기화는 웹훅(옵션 A)으로 진행.)*
4. 증분 동기화 개시: 웹훅(glovek→admin) + `brand-upsert`(admin→glovek).

> 준비 완료 상태입니다. 토큰/시크릿만 주시면 바로 켜겠습니다.
