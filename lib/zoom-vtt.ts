// Zoom 클라우드 전사(VTT) 파서 — 자막 파일을 사람이 읽는 전사문으로.
//   DB·네트워크 의존 없음(테스트 용이). Zoom 전사는 아래 형태로 온다:
//     WEBVTT
//
//     1
//     00:00:03.720 --> 00:00:08.250
//     홍길동: 안녕하세요
//
//   화자가 연속으로 말하면 큐가 쪼개져 오므로 같은 화자는 한 문단으로 합친다.

export interface VttCue { start: string; speaker: string | null; text: string }

const TIME_RE = /^(\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(\d{2}:)?\d{2}:\d{2}[.,]\d{3}/;
// "이름: 내용" — 이름에 콜론이 없고 너무 길지 않을 때만 화자로 본다(본문 속 콜론 오인 방지).
const SPEAKER_RE = /^([^:\n]{1,40}):\s+(.*)$/s;

/** VTT 원문 → 큐 목록. 형식이 아니면 빈 배열. */
export function parseVtt(vtt: string): VttCue[] {
  const text = (vtt ?? "").replace(/\r\n/g, "\n").replace(/^﻿/, "");
  if (!text.trim()) return [];
  const cues: VttCue[] = [];
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (/^WEBVTT/i.test(lines[0])) continue;      // 헤더
    if (/^NOTE\b/i.test(lines[0])) continue;      // 주석 블록
    const timeIdx = lines.findIndex((l) => TIME_RE.test(l));
    if (timeIdx < 0) continue;                    // 타임코드 없는 블록은 자막이 아님
    const start = lines[timeIdx].split("-->")[0].trim();
    const body = lines.slice(timeIdx + 1).join(" ").trim();
    if (!body) continue;
    const m = body.match(SPEAKER_RE);
    cues.push(m ? { start, speaker: m[1].trim(), text: m[2].trim() } : { start, speaker: null, text: body });
  }
  return cues;
}

/** VTT → 전사문. 같은 화자의 연속 발화는 한 문단으로 합친다. */
export function vttToTranscript(vtt: string): string {
  const cues = parseVtt(vtt);
  if (cues.length === 0) return "";
  const out: string[] = [];
  let curSpeaker: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    const line = buf.join(" ").replace(/\s+/g, " ").trim();
    out.push(curSpeaker ? `${curSpeaker}: ${line}` : line);
    buf = [];
  };
  for (const c of cues) {
    if (c.speaker !== curSpeaker) { flush(); curSpeaker = c.speaker; }
    buf.push(c.text);
  }
  flush();
  return out.join("\n");
}

/** 전사에 등장한 화자 이름 목록(참석자 보조 근거) — 순서 유지, 중복 제거. */
export function vttSpeakers(vtt: string): string[] {
  const seen = new Set<string>();
  for (const c of parseVtt(vtt)) {
    if (c.speaker && !seen.has(c.speaker)) seen.add(c.speaker);
  }
  return [...seen];
}
