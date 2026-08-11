// 마케팅 루틴 운영대행 — DB 무관 상수/타입(클라이언트 번들 안전). pg 를 끌어오지 않음.
export type RoutineStage = "plan" | "running" | "report" | "done";

export const ROUTINE_STAGES: { key: RoutineStage; label: string; cc: string }[] = [
  { key: "plan", label: "기획", cc: "cc-ing" },
  { key: "running", label: "진행(시딩·라방)", cc: "cc-warn" },
  { key: "report", label: "리포트", cc: "cc-warn" },
  { key: "done", label: "완료·정산", cc: "cc-ok" },
];

export interface RoutineCycle {
  id: string;
  project_id: string;
  ym: string;
  stage: RoutineStage;
  note: string;
  report_url: string | null;
}

export interface RoutineProject {
  id: string;
  brand_id: string;
  brand_name: string;
  title: string;
  note: string | null;
  contract_start: string | null;
  contract_end: string | null;
  cycles: RoutineCycle[];
}
