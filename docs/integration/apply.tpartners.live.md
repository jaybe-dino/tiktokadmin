# 개발요청서 · apply.tpartners.live → Glovek 운영 어드민 Ingest 연동

> **대상**: apply.tpartners.live (FastAPI / SQLite / Jinja SSR) 개발 담당
> **목적**: apply의 상담·온보딩 결제·서류 스텝·세미나/QnA/SMR 리드를 운영 어드민 원장(brands)으로 전송한다.
> apply에는 기존 외부 아웃바운드 호출이 없으므로 **신규로 httpx 비동기 클라이언트를 구현**한다.
> **온보딩 서류 파일·UBO 신분증 정보는 절대 전송하지 않는다**(요약 필드 + apply 어드민 딥링크만).

---

## 0. 발급받아 넣을 값 (env)

```
ADMIN_INGEST_URL = https://admin.glovek.space
INGEST_SECRET    = <어드민과 공유하는 시크릿>
```

---

## 1. 공통 규격 (모든 이벤트 동일)

```
POST {ADMIN_INGEST_URL}/api/ingest/{event}
Headers:
  X-Ingest-Secret:   {INGEST_SECRET}
  X-Idempotency-Key: <아래 각 지점의 멱등키>   # 필수. 재전송 시 200 {dedup:true}
  Content-Type:      application/json

Body 공통: { site:"apply", occurred_at(UTC ISO), email, phone, biz_no,
             brand_name, brand_url, contact_name, category, source_ref, source_url }

응답: 200 {ok,brand_id,created} | 200 {ok,dedup:true} | 400 | 401 | 500
```

**규칙**
- email / phone / biz_no 중 **최소 하나** 필수. (SMR은 email이 없으니 **phone 필수**)
- 실패 시 1회 재시도 후 로컬 로그. 사용자 흐름 블로킹 금지(비동기).
- 서류 파일·신분증 등 민감정보 전송 금지 — 요약만.

### dedup 키 매핑 (apply 컬럼 → 공통 필드)
| 공통 필드 | apply 소스 |
|---|---|
| `email` | 신청자 이메일 |
| `phone` | 연락처 |
| `biz_no` | `company_reg_number` (숫자만) |
| `brand_url` | `sales_channel_url` |

---

## 2. 연동 지점 (6곳)

| # | 트리거 위치 | event | 멱등키 |
|---|---|---|---|
| 1 | `POST /consultation` 저장 직후 | `lead` | `consult:{id}` |
| 2 | `_finalize_order_paid` (온보딩 주문 paid 확정) 직후 | `payment` | `order:{order_no}` |
| 3 | `/apply/step/{n}` status 변경(submitted/approved/rejected) | `doc_progress` | `step:{app_id}:{step_no}:{status}` |
| 4 | `POST /seminar` | `lead` | `seminar:{id}` |
| 5 | `POST /qna/enter` | `lead` | `qna:{id}` |
| 6 | `POST /smr/enter` | `lead` | `smr:{id}` |

### 2-1. `/consultation` → event=`lead`
```jsonc
{
  "site":"apply","occurred_at":"<UTC ISO>",
  "email":"...","phone":"...","biz_no":"<company_reg_number 숫자만>",
  "brand_name":"...", "brand_url":"<sales_channel_url>", "contact_name":"...",
  "source":"apply_consult",
  "plan_hint": { "plan_tier":"", "country_option":"", "billing_cycle":"", "selected_countries":[] },
  "message":"<main_inquiry>",
  "source_ref":"<consultation_requests.id>",
  "source_url":"<apply 어드민 상세 URL>"
}
// idem: "consult:{id}"  → state 후보: contact
```

### 2-2. `_finalize_order_paid` → event=`payment`
```jsonc
{
  "site":"apply","occurred_at":"...","email":"...","biz_no":"...",
  "pay_kind":"once",                       // ※ 정기 아님. 일회성
  "plan":"onboarding_onetime",
  "amount":<total_amount_krw>,             // 총액(+VAT 포함액)
  "pg_ref":"<order_no>",
  "apply_customer_id":<customer_id>,
  "source_ref":"<order_no>"
}
// idem: "order:{order_no}"  (가상계좌 웹훅 확정도 같은 지점이라 중복 없음)
// → pay_status=once_paid, contract_type=onboarding, state 후보 contract_done, 서류 템플릿 자동 생성
```

### 2-3. `/apply/step/{n}` → event=`doc_progress`
```jsonc
{
  "site":"apply","occurred_at":"...","email":"...","biz_no":"...",
  "apply_app_id":<tiktok_shop_applications.id>,
  "step_no": 1,                            // 1..5
  "step_status":"approved",                // submitted | approved | rejected
  "summary": { "company":"<company_name_kr>", "countries":["US","VN"], "warehouse_count":2 },
  "source_ref":"step:<app_id>:<step_no>:<status>",
  "source_url":"<apply 어드민 상세 URL>"
}
// idem: "step:{app_id}:{step_no}:{status}"
// ※ 서류 파일·UBO 신분증 등은 넣지 말 것 — summary 요약만.
// → doc_items 의 step{n} 갱신(approved=완료). 100% 도달 시 docs→setup 게이트 통과 가능.
```

### 2-4~6. 세미나 / QnA / SMR → event=`lead`
```jsonc
{ "site":"apply","occurred_at":"...","email":"...","brand_name":"...",
  "source":"apply_seminar", "source_ref":"<seminar_applicants.id>" }   // idem: "seminar:{id}"

{ "site":"apply","occurred_at":"...","email":"...","source":"apply_qna","source_ref":"<qna_leads.id>" } // idem: "qna:{id}"

// SMR은 email 없음 → phone 필수
{ "site":"apply","occurred_at":"...","phone":"...","source":"apply_smr","source_ref":"<smr_leads.id>" }  // idem: "smr:{id}"
```

---

## 3. 구현 예시 (httpx 비동기)

```python
# app/admin_ingest.py
import os, httpx, logging
from datetime import datetime, timezone

ADMIN_URL = os.getenv("ADMIN_INGEST_URL")
SECRET = os.getenv("INGEST_SECRET", "")
log = logging.getLogger("ingest")

async def send_ingest(event: str, idem_key: str, body: dict) -> None:
    if not ADMIN_URL:
        return
    payload = {"site": "apply", "occurred_at": datetime.now(timezone.utc).isoformat(), **body}
    headers = {"X-Ingest-Secret": SECRET, "X-Idempotency-Key": idem_key}
    async with httpx.AsyncClient(timeout=8) as client:
        for _ in range(2):  # 1회 재시도
            try:
                r = await client.post(f"{ADMIN_URL}/api/ingest/{event}", json=payload, headers=headers)
                if r.status_code == 200:
                    return
                if r.status_code in (400, 401):
                    log.error("ingest 거부 %s %s", event, r.text)
                    return
            except Exception as e:
                log.error("ingest 실패 %s %s", event, e)

# 사용 예 — /consultation 저장 직후 (백그라운드 태스크로)
import asyncio
asyncio.create_task(send_ingest("lead", f"consult:{row.id}", {
    "email": row.email, "phone": row.phone,
    "biz_no": "".join(filter(str.isdigit, row.company_reg_number or "")),
    "brand_name": row.brand_name, "brand_url": row.sales_channel_url,
    "contact_name": row.contact_name, "source": "apply_consult",
    "message": row.main_inquiry, "source_ref": str(row.id),
}))
```

---

## 4. 추가 작업 (최우선 포함)

- [ ] **Railway Persistent Volume 확인** — SQLite DB·업로드 서류가 `data/`에 영속 마운트돼 있는지 확인.
      **미설정이면 재배포마다 데이터·서류가 소실**된다(연동보다 우선). 미설정 시 볼륨 마운트 방법을 함께 안내.
- [ ] 프로덕션에서 `/docs`, `/redoc`, `/openapi.json` **무인증 노출 차단**.
- [ ] 관리자 화면 각 신청 상세 URL 패턴을 어드민에 공유(`source_url` 로 사용).
- [ ] (중기) SQLite → 공유 Postgres 이관 검토(원장에 직결).

---

## 5. 로컬 테스트

```bash
curl -X POST "$ADMIN_INGEST_URL/api/ingest/doc_progress" \
  -H "X-Ingest-Secret: $INGEST_SECRET" -H "X-Idempotency-Key: step:10:1:approved" \
  -H "Content-Type: application/json" \
  -d '{"site":"apply","occurred_at":"2026-07-27T02:00:00Z","email":"a@b.com","biz_no":"1112233444","apply_app_id":10,"step_no":1,"step_status":"approved","summary":{"company":"코스메랩","countries":["US"],"warehouse_count":1}}'

curl -X POST "$ADMIN_INGEST_URL/api/ingest/payment" \
  -H "X-Ingest-Secret: $INGEST_SECRET" -H "X-Idempotency-Key: order:ORD-1" \
  -H "Content-Type: application/json" \
  -d '{"site":"apply","occurred_at":"2026-07-27T02:00:00Z","email":"a@b.com","biz_no":"1112233444","pay_kind":"once","plan":"onboarding_onetime","amount":3300000,"pg_ref":"ORD-1"}'
```

## 6. 할 일 체크
- [ ] Railway Persistent Volume 확인(최우선)
- [ ] `send_ingest` + 6지점 발신(멱등키 규칙)
- [ ] `/docs` 차단 · 하드코딩 시크릿 env 이전
- [ ] 어드민 상세 URL 패턴(딥링크) 공유
- [ ] SMR은 phone 필수 처리 확인
- [ ] 각 이벤트 로컬 트리거 테스트 결과 공유
