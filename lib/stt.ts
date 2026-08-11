// Whisper STT (08 §3-2) — 녹음 파일 → 한국어 전사. OpenAI 또는 Groq(OpenAI 호환).
//   env OPENAI_API_KEY(우선) 또는 GROQ_API_KEY. 키 없으면 null(스킵).
//   민감정보: 전사 결과는 요약 워커에서만 사용, 로그에 본문 남기지 않음.

function provider(): { url: string; key: string; model: string } | null {
  const openai = process.env.OPENAI_API_KEY;
  if (openai) return { url: "https://api.openai.com/v1/audio/transcriptions", key: openai, model: "whisper-1" };
  const groq = process.env.GROQ_API_KEY;
  if (groq) return { url: "https://api.groq.com/openai/v1/audio/transcriptions", key: groq, model: "whisper-large-v3" };
  return null;
}

export function sttEnabled(): boolean {
  return provider() !== null;
}

/** 업로드된 녹음 파일(바이트) → 한국어 전사 텍스트. 실패/키없음 시 null. (Whisper 25MB 제한) */
export async function transcribeAudioBuffer(bytes: Buffer, filename = "recording.m4a", mime = "audio/m4a"): Promise<string | null> {
  const p = provider();
  if (!p) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    form.append("model", p.model);
    form.append("language", "ko");
    form.append("response_format", "text");
    const res = await fetch(p.url, { method: "POST", headers: { authorization: `Bearer ${p.key}` }, body: form });
    if (!res.ok) { console.error("[stt] buffer transcription failed:", res.status); return null; }
    const text = await res.text();
    return text.trim() || null;
  } catch (e) {
    console.error("[stt] buffer error:", (e as Error).message);
    return null;
  }
}

/** 파일이 음성/영상 녹음인지 판정(mime 또는 확장자). */
export function isAudioFile(name: string, mime: string): boolean {
  if (/^(audio|video)\//i.test(mime)) return true;
  return /\.(m4a|mp3|wav|aac|ogg|flac|mp4|mov|webm|mpeg|mpga|amr)$/i.test(name);
}

/**
 * 녹음 URL(M4A/MP3 등) → 한국어 전사 텍스트. 실패/키없음 시 null.
 *   25MB 초과는 provider 제한 — 프로덕션에선 청크 분할 필요(현재는 단일 요청).
 */
export async function transcribeAudio(audioUrl: string, downloadToken?: string): Promise<string | null> {
  const p = provider();
  if (!p) return null;
  try {
    // 녹음 다운로드 (Zoom 은 download_token 필요할 수 있음)
    const dlUrl = downloadToken ? `${audioUrl}${audioUrl.includes("?") ? "&" : "?"}access_token=${downloadToken}` : audioUrl;
    const audioRes = await fetch(dlUrl);
    if (!audioRes.ok) return null;
    const blob = await audioRes.blob();

    const form = new FormData();
    form.append("file", blob, "recording.m4a");
    form.append("model", p.model);
    form.append("language", "ko");
    form.append("response_format", "text");

    const res = await fetch(p.url, {
      method: "POST",
      headers: { authorization: `Bearer ${p.key}` },
      body: form,
    });
    if (!res.ok) {
      console.error("[stt] transcription failed:", res.status);
      return null;
    }
    const text = await res.text();
    return text.trim() || null;
  } catch (e) {
    console.error("[stt] error:", (e as Error).message);
    return null;
  }
}
