// 과거 회의 가져오기 표기 — DB 를 부르지 않는 순수 판정("use client" 패널에서도 같은 라벨을 쓴다).

/**
 * 우리 DB 에 이 회의가 어디까지 들어와 있는지.
 *   none       : 없음
 *   scheduled  : 일정만 등록됨(meeting.created 웹훅·캘린더 등) — 녹화는 아직 받지 않았다
 *   recording   : 녹화 파일까지 접수됨 — 전사는 아직 없음
 *   transcript : 전사까지 수집 완료
 * 일정만 등록된 회의를 "이미 수집됨"으로 적으면 녹화 웹훅 미도착을 놓친다.
 */
export type StoredStage = "none" | "scheduled" | "recording" | "transcript";

export const STORED_STAGE_LABEL: Record<StoredStage, string> = {
  none: "미수집",
  scheduled: "일정만 등록",
  recording: "녹화 접수 · 전사 없음",
  transcript: "전사 완료",
};

export interface StoredProbe {
  id: string;
  transcript_status?: string | null;
  has_transcript?: boolean | null;
  files?: number | null;
}

/** 조회 결과 → 단계. 행이 없으면 none. */
export function storedStage(row: StoredProbe | null | undefined): StoredStage {
  if (!row?.id) return "none";
  if (row.has_transcript || row.transcript_status === "ready") return "transcript";
  if ((row.files ?? 0) > 0) return "recording";
  return "scheduled";
}

export interface BackfillRow {
  uuid: string; zoomMeetingId: string; topic: string; startTime: string;
  durationMin: number; hasTranscript: boolean; stored: StoredStage; brandName: string | null;
}
