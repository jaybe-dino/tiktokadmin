# 13 · 협업 층 — 코멘트·멘션·피드·동시성 (30~40명용)

> Claude Code 지시: v0.1에 스키마 포함, UI는 S1~S2에 구현. 목적: "이거 누가 처리 중?"이 슬랙이 아니라 어드민 안에서 해결되게.

## 1. 스키마

```sql
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES comments(id),        -- 스레드
  author text NOT NULL,                          -- admin_users.id
  body text NOT NULL,                            -- 마크다운. @멘션은 @{user_id} 토큰
  mentions text[] DEFAULT '{}',
  pinned boolean DEFAULT false,                  -- 브랜드당 핀 1~3개(핵심 컨텍스트)
  edited_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE INDEX ON comments (brand_id, created_at);

CREATE TABLE presence (                          -- "보는 중" (TTL 60초 하트비트)
  user_id text NOT NULL, brand_id uuid NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, brand_id)
);

ALTER TABLE brands ADD COLUMN version int NOT NULL DEFAULT 1;  -- 낙관적 잠금
```

## 2. 기능

| 기능 | 상세 |
|---|---|
| **코멘트 스레드** | 브랜드 360 우측 고정 패널. 스레드·핀 지원. 첨부는 assets 연결. 검색 포함 |
| **@멘션 → 알림** | 멘션 시 대상에게 Slack DM(코멘트 본문+360 링크) + 인앱 알림함. 미확인 24h 시 리마인드 1회 |
| **활동 피드 통합** | 360 타임라인 = stage_history + brand_sources + alerts + **comments** 시간순 단일 피드. 필터(사람만/시스템만) |
| **보는 중 표시** | 360 상단에 현재 열람자 아바타(presence). 편집 폼 진입 시 "OO님도 편집 중" 경고 |
| **낙관적 잠금** | 저장 시 version 불일치 → 409 + diff 표시("그 사이 OO님이 담당을 변경함") → 병합 or 재시도. ops API 전체 적용 |
| **일괄 코멘트** | 세그먼트 선택 → 공지성 코멘트 일괄(예: "이번 주 US 물류 지연 — 해당 브랜드 안내 요망") |

## 3. Slack과의 역할 분담 (중요)
- **Slack** = 신호(알림·승인·긴급), **어드민 코멘트** = 기록(브랜드 문맥의 논의·결정). 멘션 알림은 Slack으로 가되 본문·이력은 어드민에 남는다 — "결정이 슬랙에 파묻히는 문제"를 구조로 해결.
- Slack 카드에 [💬 코멘트 달기] 버튼 → 모달로 어드민 코멘트 작성(슬랙에서도 기록은 어드민에).

## 4. AI 연계 (M7)
- 스레드 20개+ 브랜드: "논의 요약" 버튼 → 결정사항·미결사항 추출.
- 인수인계 요약(09)에 핀 코멘트·최근 논의 자동 포함.

## 5. 완료 기준
- [ ] 멘션→Slack DM→클릭→해당 코멘트로 딥링크
- [ ] 동시 편집 409 시나리오 테스트(두 세션)
- [ ] 피드에 사람·시스템 이벤트 시간순 통합
- [ ] 코멘트가 권한 scope 따름(권한 밖 브랜드 코멘트 비노출)
