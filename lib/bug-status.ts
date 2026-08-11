// 기능오류 제보 상태 정의 — DB 의존성 없는 상수(클라이언트 컴포넌트에서도 import 가능).
export const BUG_STATUS: { key: string; label: string; cls: string }[] = [
  { key: "open", label: "신규", cls: "cc-warn" },
  { key: "triaged", label: "확인", cls: "cc-ing" },
  { key: "in_progress", label: "진행중", cls: "cc-ing" },
  { key: "resolved", label: "해결", cls: "cc-ok" },
  { key: "wontfix", label: "보류/제외", cls: "cc-no" },
];
