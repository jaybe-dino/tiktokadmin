// 상세페이지 이미지 통번역 — Google Gemini 이미지 편집 모델(나노바나나)로
//   이미지 속 한글 텍스트를 타겟 언어로 번역해 "새 이미지"를 생성한다(레이아웃·디자인 유지).
//   호출처: /api/image-translate(어드민) · /api/apply/translate-image(온보딩 고객).
import { env } from "./env";

export const IMG_TRANSLATE_LANGS = {
  en: { label: "영어", name: "English" },
  vi: { label: "베트남어", name: "Vietnamese" },
  th: { label: "태국어", name: "Thai" },
} as const;
export type ImgTranslateLang = keyof typeof IMG_TRANSLATE_LANGS;

export function isImgTranslateLang(v: string): v is ImgTranslateLang {
  return v in IMG_TRANSLATE_LANGS;
}

// 텍스트 번역·재배치에 강한 이미지 편집 모델(일명 nano-banana). 필요 시 env 로 교체 가능.
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

export interface TranslateImageResult {
  ok: boolean;
  bytes?: Buffer;
  mime?: string;
  error?: string;
}

/** 이미지 1장을 타겟 언어로 번역한 새 이미지 생성. 실패해도 throw 하지 않는다. */
export async function translateImage(bytes: Buffer, mime: string, lang: ImgTranslateLang): Promise<TranslateImageResult> {
  const key = env.geminiKey;
  if (!key) return { ok: false, error: "GEMINI_API_KEY 미설정 — 설정 후 다시 시도하세요(관리자)." };
  const target = IMG_TRANSLATE_LANGS[lang].name;

  const prompt =
    `Translate ALL Korean text in this product detail page image into natural, marketing-quality ${target}. ` +
    `Replace the Korean text in place with the ${target} translation. ` +
    `Keep the exact same layout, background, product photos, graphics, colors, and font styling. ` +
    `Do not add, remove, or move any visual elements. Do not translate brand names or logos — keep them as-is. ` +
    `Output the edited image only.`;

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 55_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
              { text: prompt },
            ],
          }],
        }),
      },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[image-translate] gemini http", res.status, body.slice(0, 300));
      if (res.status === 400 && /API key/i.test(body)) return { ok: false, error: "Gemini API 키가 올바르지 않습니다(관리자 확인)." };
      if (res.status === 429) return { ok: false, error: "Gemini 사용량 한도 초과 — 잠시 후 다시 시도하세요." };
      return { ok: false, error: `번역 요청 실패(HTTP ${res.status})` };
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inline_data?: { mime_type?: string; data?: string }; inlineData?: { mimeType?: string; data?: string }; text?: string }[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const img = p.inline_data ?? p.inlineData;
      const data = img?.data;
      if (data) {
        return { ok: true, bytes: Buffer.from(data, "base64"), mime: (p.inline_data?.mime_type ?? p.inlineData?.mimeType) || "image/png" };
      }
    }
    const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200);
    console.error("[image-translate] no image in response:", text);
    return { ok: false, error: "모델이 이미지를 반환하지 않았습니다 — 다시 시도하거나 다른 이미지로 시도하세요." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) return { ok: false, error: "번역 시간 초과(55초) — 이미지를 줄여 다시 시도하세요." };
    console.error("[image-translate]", msg);
    return { ok: false, error: "번역 처리 중 오류가 발생했습니다." };
  }
}
