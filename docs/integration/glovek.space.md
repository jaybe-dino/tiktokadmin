# 개발요청서 · glovek.space → Glovek 운영 어드민 Ingest 연동

> **대상**: glovek.space (Next.js 15 / PostgreSQL) 개발 담당
> **목적**: glovek.space의 리드·상담·자가진단·멀티몰 결제 이벤트를 운영 어드민 원장(brands)으로 실시간 전송한다.
> 서버 사이드에서만 호출하고, 사용자 응답을 막지 않는 fire-and-forget 방식이어야 한다.
> **원장은 어드민이 소유**한다. glovek은 이벤트를 "보내기"만 하면 되고, 어드민이 dedup·상태·게이트를 처리한다.

---

## 0. 발급받아 넣을 값 (env)

```
ADMIN_INGEST_URL   = https://admin.glovek.space   # 어드민 배포 URL (담당자에게 수령)
INGEST_SECRET      = <어드민과 공유하는 시크릿>       # 어드민이 발급
```

---

## 1. 공통 규격 (모든 이벤트 동일)

```
POST {ADMIN_INGEST_URL}/api/ingest/{event}
Headers:
  X-Ingest-Secret:   {INGEST_SECRET}         # 불일치 시 401
  X-Idempotency-Key: <아래 각 지점의 멱등키>    # 필수. 재전송 시 200 {dedup:true}
  Content-Type:      application/json

Body 공통 필드 (있는 것만 채움):
  site         : "glovek"          (고정)
  occurred_at  : "2026-07-27T02:00:00Z"   # UTC ISO8601
  email        : ""   # dedup 1차키 (소문자로 정규화됨)
  phone        : ""   # dedup 2차키 (숫자만)
  biz_no       : ""   # dedup 3차키 (숫자만)
  brand_name   : ""
  brand_url    : ""   # 대표 판매채널(스마트스토어 등)
  contact_name : ""
  category     : ""
  source_ref   : ""   # 원본 PK/주문번호 (멱등·역추적용)
  source_url   : ""   # 어드민 딥링크(있으면)

응답:
  200 {ok:true, brand_id, created:boolean}   # 정상
  200 {ok:true, dedup:true}                  # 멱등 재수신(무시됨)
  400 {error:"validation", fields:[...]}     # 검증 실패
  401                                        # 시크릿 불일치
  500                                        # 서버 오류 → 1회 재시도 후 포기 + 자체 로그
```

**규칙**
- **email / phone / biz_no 중 최소 하나**는 반드시 포함(없으면 400 — dedup 불가).
- 실패 시 **1회 재시도** 후 자체 로그만 남기고 사용자 흐름은 막지 않는다(비동기).
- **카드번호·비밀번호 등 민감정보는 절대 전송 금지**(요약 필드 + 원본 링크만).
- `occurred_at` 미래값/1년 이전값은 거부됨.

### dedup 키 매핑 (glovek 컬럼 → 공통 필드)
| 공통 필드 | glovek 소스 |
|---|---|
| `email` | 사용자 이메일 |
| `phone` | 연락처 |
| `biz_no` | 온보딩 `bizNo` |
| `brand_url` | `brand_url` |

---

## 2. 연동 지점 (4 + 1곳)

| # | 트리거 위치 | event | 멱등키 |
|---|---|---|---|
| 1 | `/api/consult` (consult_requests INSERT 직후) | `lead` | `consult:{id}` |
| 2 | `/api/inquiry` (inquiries INSERT 직후) | `lead` | `inq:{id}` |
| 3 | `/api/onboarding/apply` (stage=self_check 저장 직후) | `diagnosis` | `diag:{onb_id}:{updated_at_epoch}` |
| 4 | `/api/payment/subscribe-mall` 성공 + `/api/cron/subscribe` 갱신/실패 + 해지 | `payment` | `pay:{tid}` (해지 `cancel:{user_id}:{date}`) |
| +1 | signup 에 `ref`(referral_code) 있을 때 | `lead` | `signup:{user_id}` |

### 2-1. `/api/consult` → event=`lead`
```jsonc
{
  "site": "glovek",
  "occurred_at": "<UTC ISO>",
  "email": "...", "phone": "...",
  "brand_name": "<회사/브랜드>",
  "contact_name": "<담당자>",
  "category": "<카테고리>",
  "source": "glovek_consult",            // ← lead 전용 필드
  "message": "<문의 내용>",
  "plan_hint": { "...": "상담 폼의 플랜/요금 힌트(있으면)" },
  "utm": { "source":"", "medium":"", "campaign":"", "content":"", "term":"" },
  "source_ref": "<consult_requests.id>"
}
// idem: "consult:{id}"  → 어드민 state 후보: contact (상담=컨택 의향)
```

### 2-2. `/api/inquiry` → event=`lead`
```jsonc
{ "site":"glovek","occurred_at":"...","email":"...","brand_name":"...",
  "source":"glovek_inquiry", "message":"<kind 포함 요약>", "source_ref":"<inquiries.id>" }
// idem: "inq:{id}"  → state 후보: lead_new
```

### 2-3. `/api/onboarding/apply` (self_check) → event=`diagnosis`
```jsonc
{
  "site": "glovek", "occurred_at": "...", "email": "...",
  "grade": "S|A|B|C",                    // glovek gradeFromChecks 결과 그대로
  "rec_track": "onboarding|live",        // recommended_track
  "countries": ["US","VN"],
  "checks": { "q1":true,"q2":false,"q3":true,"q4":false,"q5":true },  // 5문항 불리언
  "missing_certs": ["US FDA"],
  "glovek_onb_id": "<onboarding_applications.id>",
  "source_ref": "<onboarding_applications.id>"
}
// idem: "diag:{onb_id}:{updated_at epoch}"  → 어드민이 grade/rec_track/countries 갱신 + 브리프 재생성 큐
```

### 2-4. 결제 → event=`payment`
```jsonc
// 최초 구독 성공 (/api/payment/subscribe-mall 승인 직후)
{ "site":"glovek","occurred_at":"...","email":"...",
  "pay_kind":"subscribe_first", "plan":"live_focus_490k",
  "amount": 490000, "pg_ref":"<tid>", "glovek_user_id":"<users.id>" }
// idem: "pay:{tid}"  → pay_status=subscribed, contract_type=mall, state 후보 contract_done

// 갱신 (/api/cron/subscribe)
{ "site":"glovek","occurred_at":"...","email":"...",
  "pay_kind":"subscribe_renew", "result":"ok",   // 실패 시 "fail" → pay_status=past_due
  "pg_ref":"<tid>" }
// idem: "pay:{tid}"

// 해지
{ "site":"glovek","occurred_at":"...","email":"...","pay_kind":"cancel","glovek_user_id":"<users.id>" }
// idem: "cancel:{user_id}:{date}"  → pay_status=canceled
```
> **plan 값**: 정기 멀티몰 = `live_focus_490k`, Pro = `pro_89k`. (Guarantee 100만은 결제코드 없음 → 전송 대상 아님)

### 2-5. 추천인 가입 → event=`lead`
```jsonc
{ "site":"glovek","occurred_at":"...","email":"...","brand_name":"...",
  "source":"referrer", "referral_code":"<ref>", "source_ref":"<users.id>" }
// idem: "signup:{user_id}"
```

---

## 3. 구현 예시 (서버 전용 헬퍼)

```ts
// lib/adminIngest.ts  (glovek.space 내부)
export async function sendIngest(event: string, idemKey: string, body: Record<string, unknown>) {
  const url = process.env.ADMIN_INGEST_URL;
  if (!url) return;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${url}/api/ingest/${event}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ingest-Secret": process.env.INGEST_SECRET ?? "",
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify({ site: "glovek", occurred_at: new Date().toISOString(), ...body }),
      });
      if (res.ok) return;                 // 200 이면 성공(dedup 포함)
      if (res.status === 400 || res.status === 401) {
        console.error("[ingest] 거부", event, await res.text());
        return;                            // 재시도 무의미
      }
    }
  } catch (e) {
    console.error("[ingest] 실패", event, (e as Error).message);
  }
}

// 사용 예 — /api/consult 핸들러에서 INSERT 직후 (await 하지 않고 fire-and-forget)
void sendIngest("lead", `consult:${row.id}`, {
  email: row.email, phone: row.phone, brand_name: row.company,
  contact_name: row.name, category: row.category,
  source: "glovek_consult", message: row.message, source_ref: String(row.id),
});
```

---

## 4. 추가 작업 (연동과 별개, 병행)

- [ ] **어드민용 read-only Postgres 롤 발급** → 접속 문자열을 어드민 담당에게 전달(`GLOVEK_DB_URL_RO`).
      권한 테이블: `users, orders, payments, subscriptions, mall_subscriptions, onboarding_applications,
      consult_requests, consult_progress, inquiries, referrers, utm_events, brand_stats, brand_shop_stats`.
- [ ] `referrers.code ↔ 영업담당자` 매핑표를 어드민에 전달(추천인 → 담당 자동 배정용).
- [ ] (보안) 하드코딩된 `SLACK_WEBHOOK` 등 시크릿을 env로 이전.

---

## 5. 로컬 테스트

```bash
# lead
curl -X POST "$ADMIN_INGEST_URL/api/ingest/lead" \
  -H "X-Ingest-Secret: $INGEST_SECRET" -H "X-Idempotency-Key: consult:1" \
  -H "Content-Type: application/json" \
  -d '{"site":"glovek","occurred_at":"2026-07-27T02:00:00Z","email":"a@b.com","brand_name":"테스트","contact_name":"홍길동","source":"glovek_consult","message":"문의","source_ref":"1"}'
# → 200 {"ok":true,"brand_id":"...","created":true}

# 같은 키 재전송 → 200 {"ok":true,"dedup":true}
# payment
curl -X POST "$ADMIN_INGEST_URL/api/ingest/payment" \
  -H "X-Ingest-Secret: $INGEST_SECRET" -H "X-Idempotency-Key: pay:TID123" \
  -H "Content-Type: application/json" \
  -d '{"site":"glovek","occurred_at":"2026-07-27T02:05:00Z","email":"a@b.com","pay_kind":"subscribe_first","plan":"live_focus_490k","amount":490000,"pg_ref":"TID123"}'
```

## 6. 할 일 체크
- [ ] `sendIngest` 헬퍼 + 4+1 지점 발신(멱등키 규칙 준수)
- [ ] read-only DB 롤 발급 → `GLOVEK_DB_URL_RO`
- [ ] referral_code ↔ 영업담당 매핑표 전달
- [ ] 하드코딩 시크릿 env 이전
- [ ] 각 이벤트 로컬 트리거 테스트 결과 공유
