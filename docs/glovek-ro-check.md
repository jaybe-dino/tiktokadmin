# glovek.space DB 연동 확인 요청서 (어드민 레퍼런스 검색용)

- 요청자: glovek-admin (틱톡샵 어드민) 개발
- 대상: glovek.space 개발 파트
- 목적: 어드민의 제안서 "유사 콘텐츠 레퍼런스" 검색이 glovek DB 의 `videos` / `products` 를
  읽기전용으로 조회합니다. 현재 검색 결과가 0건이라 ① 실데이터 유무 ② 카테고리 실제 표기
  ③ 읽기전용 접속 정보 3가지 확인이 필요합니다.

---

## 확인 ① 실데이터 유무

**실행할 SQL** (glovek 운영 DB, public 스키마):

```sql
SELECT relname AS table_name, n_live_tup AS approx_rows
  FROM pg_stat_user_tables
 WHERE relname IN ('videos', 'products');
```

**기대 결과값 (예시):**

| table_name | approx_rows |
|---|---|
| videos | 12,340 |
| products | 3,210 |

**판정 기준:**
- 두 행 모두 나오고 행수가 1 이상 → 정상(데이터 있음). ②로 진행.
- 행이 아예 안 나옴 → 테이블명이 다르거나 다른 스키마에 있음 → 실제 테이블명/스키마 회신 요청.
- 행수가 0 → 크롤러 적재가 비어 있음 → 적재 상태 확인 필요.

---

## 확인 ② 스키마(컬럼명)와 카테고리 실값

**실행할 SQL 1 — 컬럼 구조:**

```sql
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('videos', 'products')
 ORDER BY table_name, ordinal_position;
```

**기대 결과값 (예시):**

| table_name | column_name | data_type |
|---|---|---|
| videos | id | uuid |
| videos | title | text |
| videos | category | text |
| videos | thumbnail | text |
| videos | url | text |
| videos | view_count | bigint |
| products | name | text |
| products | category | text |
| products | image_url | text |
| products | gmv | numeric |

**판정 기준 — 어드민이 자동 인식하는 컬럼명 후보** (이 중 하나면 그대로 동작):

| 용도 | 인식하는 컬럼명 후보 |
|---|---|
| 카테고리 | `category`, `cat`, `category_name`, `type`, `product_category` |
| 이름/제목 | `name`, `title`, `product_name`, `product_title`, `video_title`, `caption`, `description` |
| 브랜드/샵 | `brand`, `brand_name`, `shop`, `shop_name`, `seller`, `seller_name` |
| 썸네일 | `image_url`, `image`, `thumbnail`, `thumb_url`, `thumbnail_url`, `cover`, `cover_url`, `main_image_url` |
| 링크 | `url`, `link`, `product_url`, `video_url`, `permalink`, `share_url` |
| 크리에이터 | `handle`, `creator_handle`, `username`, `author`, `author_handle` |
| GMV/조회수 | `gmv`, `est_gmv`, `revenue` / `views`, `view_count`, `play_count`, `likes` |

- 실제 컬럼명이 위 후보에 **없으면** 결과 전체를 회신해주세요 → 어드민 검색 로직을 실스키마에 맞춥니다.

**실행할 SQL 2 — 카테고리 실값 분포** (카테고리 컬럼명이 `category` 가 아니면 실제 이름으로 교체):

```sql
SELECT category, count(*) FROM videos   GROUP BY 1 ORDER BY 2 DESC LIMIT 30;
SELECT category, count(*) FROM products GROUP BY 1 ORDER BY 2 DESC LIMIT 30;
```

**기대 결과값 (예시):**

| category | count |
|---|---|
| Beauty & Personal Care | 4,120 |
| 스킨케어 | 1,890 |
| serum | 640 |
| (NULL) | 210 |

**판정 기준:**
- 값이 영어든 한글이든 상관없음 — 어드민이 한글 파트("세럼", "앰플")와 영문 동의어(serum, ampoule 등)로
  함께 검색합니다. 단, **분포 결과 30줄은 그대로 회신** 요청 (어드민의 카테고리 선택 목록을 실값 기준으로 보정).
- 대부분 NULL/빈값이면 카테고리 매칭이 불가 → 이름 컬럼 기반 검색만 동작(회신 필요).

---

## 요청 ③ 읽기전용 접속 URL 발급

**만들어 주실 것** — `videos`, `products` 에 SELECT 권한만 있는 읽기전용 롤:

```sql
CREATE ROLE glovek_ro LOGIN PASSWORD '<강력한 비밀번호>';
GRANT CONNECT ON DATABASE <DB명> TO glovek_ro;
GRANT USAGE ON SCHEMA public TO glovek_ro;
GRANT SELECT ON public.videos, public.products TO glovek_ro;
```

**회신 형식** (접속 URL 1줄):

```
postgres://glovek_ro:<비밀번호>@<호스트>:5432/<DB명>?sslmode=require
```

- 외부(Vercel)에서 접속하므로 호스트가 공인 접근 가능해야 하며, IP 제한이 있으면 회신 요청.

**어드민 측 적용 (받은 후 우리가 할 일):**
1. Vercel 환경변수 `GLOVEK_DB_URL_RO` = 위 URL 등록 → 재배포.
2. 어드민 설정 페이지 → **"glovek 콘텐츠 데이터 진단"** 카드에서 자동 확인:
   - 기대 결과값: `videos 약 N건` / `products 약 N건` 배지 + 카테고리 실값 칩 목록 표시.
   - `⚠️ GLOVEK_DB_URL_RO 미설정` 경고가 사라져야 정상.
3. 마케팅 제안서 에디터에서 카테고리 선택 → "glovek 유사 콘텐츠 불러오기" 재시도:
   - 기대 결과값: `카테고리 「스킨케어 > 크림」(검색어: 크림, cream, …) · glovek 유사 콘텐츠 N건` (N ≥ 1)
   - 0건이면 메시지에 원인이 표시됨: `GLOVEK_DB_URL_RO 미설정` / `테이블 없음(권한)` / `연결 정상 — 데이터 없음` 중 하나.

---

## 회신 체크리스트 (요약)

- [ ] ① 행수 결과 (videos / products 각 N건)
- [ ] ② 컬럼 구조 결과 전체 + 카테고리 분포 상위 30 (두 테이블)
- [ ] ③ 읽기전용 접속 URL (`postgres://glovek_ro:...?sslmode=require`)
- [ ] 테이블명/스키마가 `public.videos`, `public.products` 와 다르면 실제 이름
