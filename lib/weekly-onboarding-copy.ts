// 1일차 문자에 덧붙일 문구 — **초안이다. 아직 어디에도 적용하지 않았다.**
//
//   · 이 파일은 발송 경로에서 import 하지 않는다(테스트가 그 사실을 검사한다).
//     운영 문구는 lib/lead-sequence-copy.ts 와 DB(lead_sequence_steps)에 있고, 그대로 두었다.
//   · 사용자가 검토·확정한 뒤에, 세미나 유입을 제외한 1일차에만 적용할 예정이다.
//   · 모집 수량·잔여석·마감·선착순을 쓰지 않는다 — 세어서 막는 로직이 없기 때문이다.

/** 공개 신청서 주소(기존 경로 유지). */
export const WEEKLY_APPLY_URL = "https://admin.glovek.space/weekly";

/** 승인 대기 중인 1일차 추가 문구(초안). */
export const WEEKLY_DAY1_SMS_DRAFT =
  "틱톡샵 온보딩은 한정된 슬롯으로 진행됩니다. 사전 신청이 필요한 팀은 신청해 주세요: "
  + WEEKLY_APPLY_URL;

/** 적용 범위(합의 전 메모) — 코드가 이 값으로 자동 분기하지 않는다. */
export const WEEKLY_DAY1_SCOPE_NOTE =
  "세미나 유입(apply_seminar · tp_seminar)은 제외하고, 그 밖의 유입 루트 1일차에만 적용 예정. 사용자 검토 후 적용.";

/** 쓰면 안 되는 표현 — 검수·테스트에서 함께 본다. */
export const WEEKLY_FORBIDDEN_CLAIMS = ["마감", "잔여", "선착순", "확정", "보장", "남은 자리", "개 브랜드"];
