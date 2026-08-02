# 개발요청서 · tpartners.live → Glovek 운영 어드민 Ingest 연동

> **대상**: tpartners.live (React/Vite + Express/tRPC + MySQL/TiDB, Manus 호스팅) 개발 담당
> **목적**: tpartners의 세미나 신청·전자책 리드를 운영 어드민 원장(brands)으로 전송한다.
> tRPC 서버 핸들러에서만 호출한다. **Manus 환경에서 외부 HTTP 아웃바운드가 제한되면 §4 폴링/CSV 대안**을 사용한다.

---

## ⛔ 기존 시스템 보호 — 반드시 지킬 것 (연동 전 필독)

tpartners는 **리드(lead) 이벤트만** 보낸다. 어떤 상태·판정도 계산하지 말 것:

| 하지 말 것 (❌) | 이유 |
|---|---|
| 어드민/원장 DB에 직접 접근·쓰기 | 어드민이 처리. tRPC 핸들러에서 **event만** 전송 |
| lead 외 event(payment·doc_progress 등) 전송 | tpartners 범위는 리드 유입만 |
| event 이름·payload 필드명·멱등키 형식 임의 변경 | dedup·역추적이 깨짐 |
| 어드민 URL 하드코딩 | env `ADMIN_INGEST_URL`(정본 `https://tiktokadmin.vercel.app`) |

**✅ 지킬 것**: email 없으면 phone만(둘 다 없으면 400) · occurred_at UTC 그대로 · fire-and-forget · 재시도 1회 · `brandName` 컬럼 폼별 의미 분리(§2-1).

---

## 0. 발급받아 넣을 값 (env)

```
ADMIN_INGEST_URL = https://tiktokadmin.vercel.app   # 정본 (구 admin.glovek.space 폐기)
INGEST_SECRET    = <어드민과 공유하는 시크릿>
```
> ⚠️ URL은 반드시 **env 에서 읽고 하드코딩 금지**. 커스텀 도메인 연결 시 env 값만 교체.

---

## 1. 공통 규격

```
POST {ADMIN_INGEST_URL}/api/ingest/lead
Headers:
  X-Ingest-Secret:   {INGEST_SECRET}
  X-Idempotency-Key: <아래 멱등키>
  Content-Type:      application/json

Body 공통: { site:"tpartners", occurred_at(UTC 그대로), email, phone, brand_name,
             brand_url, category, source_ref, ... }

응답: 200 {ok,brand_id,created} | 200 {ok,dedup:true} | 400 | 401 | 500
```

**규칙**
- **타임스탬프는 UTC 그대로 전송**한다(어드민이 KST 변환). MySQL 값이 UTC임에 주의.
- email이 **빈 문자열일 수 있음** → 그 경우 **email 필드를 생략하고 phone만** 보낸다(둘 다 없으면 400).
- 실패 시 1회 재시도 후 로컬 로그. 사용자 흐름 블로킹 금지.

---

## 2. 연동 지점 (2곳)

| # | 트리거 위치 | event / source | 멱등키 |
|---|---|---|---|
| 1 | `seminar.register` 성공 직후 | `lead` / `tp_seminar` | `sem:{id}` |
| 2 | `ebook.requestAccess` 성공 직후 | `lead` / `tp_ebook` | `ebook:{id}` |

### 2-1. `seminar.register` → event=`lead`, source=`tp_seminar`
> **주의(brandName 컬럼 의미가 폼별로 다름)**:
> `seminarSession === "fasttrack"` 이면 `brandName` 값은 **brandLink(URL)** → `brand_url` 로,
> `seminarSession === "marketing"` 이면 **inquiry 텍스트** → `message` 로 분리해서 보낸다.

```jsonc
{
  "site":"tpartners", "occurred_at":"<UTC 그대로>",
  "email":"...", "phone":"...",
  "brand_name":"<브랜드명>",
  "brand_url":"<fasttrack일 때 brandLink>",
  "category":"<카테고리>",
  "source":"tp_seminar",
  "message":"<marketing일 때 inquiry 텍스트>",
  "utm": { "source":"","medium":"","campaign":"","content":"","term":"" },
  "source_ref":"<seminar_registrations.id>"
  // 참고 필드: ref, partner, seminarSession 값도 message/payload에 함께 담아도 됨
}
// idem: "sem:{id}"  → state 후보: seminar
```

### 2-2. `ebook.requestAccess` → event=`lead`, source=`tp_ebook`
```jsonc
{ "site":"tpartners","occurred_at":"<UTC>","email":"...","phone":"...",
  "brand_name":"...", "brand_url":"<brandLink>", "source":"tp_ebook",
  "source_ref":"<ebook_leads.id>" }
// idem: "ebook:{id}"  → state 후보: lead_new
```

---

## 3. 구현 예시 (tRPC 핸들러 내부)

```ts
// server/adminIngest.ts
export async function sendIngest(idemKey: string, body: Record<string, unknown>) {
  const url = process.env.ADMIN_INGEST_URL;
  if (!url) return;
  const payload: Record<string, unknown> = { site: "tpartners", ...body };
  // email 빈 문자열이면 필드 제거 (phone만 전송)
  if (!payload.email) delete payload.email;
  try {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${url}/api/ingest/lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ingest-Secret": process.env.INGEST_SECRET ?? "",
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
      if (res.status === 400 || res.status === 401) { console.error("[ingest] 거부", await res.text()); return; }
    }
  } catch (e) { console.error("[ingest] 실패", (e as Error).message); }
}

// seminar.register mutation 성공 직후
const isFast = input.seminarSession === "fasttrack";
void sendIngest(`sem:${row.id}`, {
  occurred_at: row.createdAt.toISOString(),   // UTC 그대로
  email: row.email, phone: row.phone, brand_name: row.name,
  brand_url: isFast ? row.brandName : "",
  message: isFast ? "" : row.brandName,        // marketing 이면 inquiry
  category: row.category, source: "tp_seminar", source_ref: String(row.id),
});
```

---

## 4. 아웃바운드 제한 시 대안 (Manus)

Manus 환경에서 외부 HTTP 호출이 막히면 아래 중 하나로 대체하고, 가능 여부를 먼저 확인해 회신:

- **대안 A (폴링)**: 어드민이 주기적으로 당겨갈 수 있도록 `seminar.list` / `ebook.list` 에
  **읽기 전용 adminToken**을 발급. 어드민이 이 엔드포인트를 폴링해 신규 건을 흡수한다.
- **대안 B (CSV)**: 세미나 신청 탭에도 **CSV export**를 추가(현재 전자책 탭만 있음). 어드민이 CSV 임포트.

겸사겸사(보안): 하드코딩된 `ADMIN_USERNAME/PASSWORD`·토큰·Slack Webhook URL을 env로 이전.

---

## 5. 로컬 테스트

```bash
# fasttrack (brandName=brandLink)
curl -X POST "$ADMIN_INGEST_URL/api/ingest/lead" \
  -H "X-Ingest-Secret: $INGEST_SECRET" -H "X-Idempotency-Key: sem:1" \
  -H "Content-Type: application/json" \
  -d '{"site":"tpartners","occurred_at":"2026-07-27T02:00:00Z","email":"a@b.com","brand_name":"루미너스","brand_url":"https://smartstore.naver.com/luminous","source":"tp_seminar","source_ref":"1"}'

# email 없는 케이스(phone만)
curl -X POST "$ADMIN_INGEST_URL/api/ingest/lead" \
  -H "X-Ingest-Secret: $INGEST_SECRET" -H "X-Idempotency-Key: ebook:9" \
  -H "Content-Type: application/json" \
  -d '{"site":"tpartners","occurred_at":"2026-07-27T02:00:00Z","phone":"01055556666","brand_name":"노이메일","source":"tp_ebook","source_ref":"9"}'
```

## 6. 할 일 체크
- [ ] Manus 아웃바운드 HTTP 가능 여부 확인 → 불가 시 §4 폴링/CSV 대안
- [ ] `sendIngest` + 2지점 발신(멱등키)
- [ ] `brandName` 컬럼 폼별 의미 분리(fasttrack=brandLink / marketing=inquiry)
- [ ] email 빈 문자열 시 phone-only 전송 처리
- [ ] 타임스탬프 UTC 그대로 전송
- [ ] 하드코딩 자격증명·Slack URL env 이전
