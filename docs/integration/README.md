# 사이트 연동 — 정본 인덱스 & 정합성 정리

> 개발자에게 실제 전달하는 **정본 문서는 이 폴더의 사이트별 `.md`** 입니다.
> 다른 문서(`docs/HANDOFF-연동가이드.md` PART B, `docs/spec/07-SITE-INTEGRATION.md`)는 요약본이며,
> **값이 다르면 이 폴더 문서를 따릅니다.**

## 정본 파일 (개발자 전달용)
| 사이트 | 파일 | 범위 |
|---|---|---|
| glovek.space | `glovek.space.md` | lead·diagnosis·payment (4+1지점) + read-only DB 공유 |
| apply.tpartners.live | `apply.tpartners.live.md` | lead·payment·doc_progress (6지점) |
| tpartners.live | `tpartners.live.md` | lead (2지점) |

## 공통 상수 (전 사이트 동일 — 절대 변경 금지)
- **어드민 URL 정본**: `https://tiktokadmin.vercel.app` (env `ADMIN_INGEST_URL`, 하드코딩 금지)
- **인증 헤더**: `X-Ingest-Secret`(공유 시크릿) + `X-Idempotency-Key`(필수)
- **dedup 키**: email → phone → biz_no → brand_name+url → aliases (최소 하나 필수)
- **재시도**: 실패 시 1회(멱등키로 재전송 안전, 필요 시 최대 3회 지수백오프) 후 로컬 로그, fire-and-forget
- **event**: `lead · diagnosis · payment · doc_progress · contact_logged · onboarding` (임의 추가 금지)

---

## 🔧 이번 정합성 정리 (기존 프롬프트와의 충돌 제거)

이미 개발자에게 나간 프롬프트와 충돌하지 않도록 아래를 통일했습니다. **개발자에게 이 3가지만 재공지**하면 됩니다:

1. **어드민 URL 변경**: `admin.glovek.space` → **`https://tiktokadmin.vercel.app`** (env 값만 교체, 코드 수정 불필요).
   - 커스텀 도메인을 나중에 붙이면 env `ADMIN_INGEST_URL` 값만 바꾸면 됨.
2. **재시도 정책 통일**: "1회 재시도"(멱등키로 안전) 기준. 기존 "최대 3회" 안내와 정합.
3. **기존 시스템 보호 규칙**: 각 정본 문서 상단 "⛔ 반드시 지킬 것" 표 추가 — DB 직접 쓰기 금지, 상태·게이트·정산 사이트 판정 금지, payload/event/멱등키 임의 변경 금지, 민감정보 전송 금지.

### 중복 제거
- `docs/07-SITE-INTEGRATION.md`(구버전 중복) **삭제** → `docs/spec/07-SITE-INTEGRATION.md`(스펙)만 유지.
- `docs/spec/07` · `HANDOFF PART B` 상단에 "정본은 integration/ 문서" 안내 추가.

### 기존 시스템과의 무충돌 보장
- glovek 기존 테이블(users·orders·payments 등)은 어드민이 **읽기 전용**(`assertNotGlovekWrite` 가드) — 사이트 연동이 기존 데이터를 건드리지 않음.
- 모든 수신은 dedup 후 원장에 병합 — 중복 유입돼도 멱등키/매칭으로 안전.
- enum(state 등)은 어드민 `lib/states.ts` 정본만 사용 — 사이트는 상태를 보내지 않음.
