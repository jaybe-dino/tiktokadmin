// 상세페이지 이미지 통번역 — "텍스트 영역만" 편집하는 밴드 파이프라인.
//   이전 방식(이미지 전체를 Gemini 이미지 편집 모델에 통째로 재생성)은 제품 사진·그래픽까지
//   다시 그려져 변형되고, 세로로 긴 상세페이지는 축소돼 화질이 뭉개지는 문제가 있었다.
//   현재 파이프라인:
//     ① 감지  — Gemini 텍스트 모델이 한글 텍스트 블록의 좌표(box_2d)·원문을 JSON 으로 반환
//     ② 번역  — 감지된 원문을 텍스트 모델로 정확 번역(이미지 모델의 즉석 번역보다 품질 높음)
//     ③ 편집  — 텍스트가 있는 "가로 띠(밴드)"만 잘라 이미지 편집 모델에 번역문 교체 지시
//     ④ 합성  — 편집된 띠를 원본의 같은 자리에 되붙임 → 텍스트 밖 영역은 원본 픽셀 그대로
//   감지 실패·밴드 0개면 기존 전체 편집 방식으로 폴백. 호출처: /api/image-translate(어드민)
//   · /api/apply/translate-image(온보딩 고객).
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
// 텍스트 감지(좌표)·번역용 텍스트 모델.
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

export interface TranslateImageResult {
  ok: boolean;
  bytes?: Buffer;
  mime?: string;
  error?: string;
  note?: string; // 부분 실패 등 사용자 안내(성공이어도 채워질 수 있음)
}

// ── Gemini REST 공용 호출 ──
interface GeminiPart { inline_data?: { mime_type?: string; data?: string }; inlineData?: { mimeType?: string; data?: string }; text?: string }

async function geminiCall(
  key: string, model: string, parts: unknown[], timeoutMs: number, jsonOut = false,
): Promise<GeminiPart[] | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts }],
          ...(jsonOut ? { generationConfig: { responseMimeType: "application/json" } } : {}),
        }),
      },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[image-translate] ${model} http`, res.status, body.slice(0, 200));
      // 상위에서 키/한도 오류 메시지를 구분할 수 있게 상태를 에러로 전달.
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body: body.slice(0, 300) });
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
    return json.candidates?.[0]?.content?.parts ?? [];
  } catch (e) {
    if (e instanceof Error && /HTTP \d+/.test(e.message)) throw e;
    console.error(`[image-translate] ${model}:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

const partsText = (parts: GeminiPart[] | null): string =>
  (parts ?? []).map((p) => p.text).filter(Boolean).join("");

const partsImage = (parts: GeminiPart[] | null): { bytes: Buffer; mime: string } | null => {
  for (const p of parts ?? []) {
    const img = p.inline_data ?? p.inlineData;
    if (img?.data) return { bytes: Buffer.from(img.data, "base64"), mime: (p.inline_data?.mime_type ?? p.inlineData?.mimeType) || "image/png" };
  }
  return null;
};

// 관대한 JSON 추출(코드펜스·앞뒤 텍스트 허용).
function looseJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { /* fallthrough */ }
  const m = s.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as T; } catch { /* noop */ } }
  return null;
}

// ── ① 한글 텍스트 블록 감지(좌표 0~1000 정규화) ──
export interface TextBox { ymin: number; xmin: number; ymax: number; xmax: number; text: string }

async function detectKoreanText(key: string, bytes: Buffer, mime: string): Promise<TextBox[] | null> {
  const prompt =
    `Find every distinct block of Korean text in this product detail page image. ` +
    `Return ONLY a JSON array: [{"box_2d":[ymin,xmin,ymax,xmax],"text":"<the Korean text>"}] ` +
    `with coordinates normalized to 0-1000. Include ALL Korean text: headings, body copy, captions, ` +
    `labels inside graphics and tables. Exclude text that is not Korean, and exclude brand names/logos. ` +
    `If there is no Korean text, return [].`;
  const parts = await geminiCall(key, TEXT_MODEL, [
    { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
    { text: prompt },
  ], 25_000, true).catch(() => null);
  if (!parts) return null;
  const raw = looseJson<{ box_2d?: number[]; text?: string }[]>(partsText(parts));
  if (!Array.isArray(raw)) return null;
  const out: TextBox[] = [];
  for (const r of raw) {
    const b = r.box_2d;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => Number.isFinite(n))) continue;
    const [ymin, xmin, ymax, xmax] = b.map((n) => Math.max(0, Math.min(1000, Number(n))));
    if (ymax <= ymin || xmax <= xmin) continue;
    out.push({ ymin, xmin, ymax, xmax, text: String(r.text ?? "").trim() });
  }
  return out;
}

// ── ② 원문 일괄 번역(순서 보존) ──
async function translateTexts(key: string, texts: string[], target: string): Promise<string[] | null> {
  if (texts.length === 0) return [];
  const prompt =
    `Translate each Korean product-marketing text below into natural, marketing-quality ${target}. ` +
    `Keep numbers, units and emphasis. Do not translate brand names. ` +
    `Return ONLY a JSON array of ${texts.length} strings in the same order.\n` +
    JSON.stringify(texts);
  const parts = await geminiCall(key, TEXT_MODEL, [{ text: prompt }], 20_000, true).catch(() => null);
  if (!parts) return null;
  const arr = looseJson<unknown[]>(partsText(parts));
  if (!Array.isArray(arr) || arr.length !== texts.length) return null;
  return arr.map((s) => String(s ?? ""));
}

// ── 밴드 계산 — 박스들을 "가로 전체 폭 띠"로 병합(상세페이지는 세로 스택 구조라 이음새가 깔끔). ──
export interface Band { top: number; height: number; texts: string[] }

export function mergeBands(boxes: TextBox[], width: number, height: number, maxBands = 12): Band[] {
  if (boxes.length === 0) return [];
  const pad = Math.max(8, Math.round(height * 0.006));
  const gap = Math.max(12, Math.round(height * 0.012)); // 이 간격 이하로 붙은 띠는 병합
  const strips = boxes
    .map((b) => ({
      top: Math.max(0, Math.round((b.ymin / 1000) * height) - pad),
      bottom: Math.min(height, Math.round((b.ymax / 1000) * height) + pad),
      texts: b.text ? [b.text] : [],
    }))
    .sort((a, b) => a.top - b.top);
  const merged: typeof strips = [];
  for (const s of strips) {
    const last = merged[merged.length - 1];
    if (last && s.top <= last.bottom + gap) {
      last.bottom = Math.max(last.bottom, s.bottom);
      last.texts.push(...s.texts);
    } else merged.push({ ...s, texts: [...s.texts] });
  }
  // 호출 수 상한 — 넘치면 가장 가까운 이웃끼리 계속 병합(밴드를 버리면 한글이 남으므로 병합으로 해결).
  while (merged.length > maxBands) {
    let bi = 0, bg = Infinity;
    for (let i = 0; i + 1 < merged.length; i++) {
      const g = merged[i + 1].top - merged[i].bottom;
      if (g < bg) { bg = g; bi = i; }
    }
    merged[bi].bottom = Math.max(merged[bi].bottom, merged[bi + 1].bottom);
    merged[bi].texts.push(...merged[bi + 1].texts);
    merged.splice(bi + 1, 1);
  }
  return merged
    .map((s) => ({ top: s.top, height: Math.max(1, s.bottom - s.top), texts: s.texts }))
    .filter((b) => b.height >= 10);
}

// ── ③ 밴드 크롭 편집(번역문을 명시해 교체 — 이미지 모델의 즉석 번역보다 정확) ──
async function editBand(
  key: string, crop: Buffer, mime: string, target: string, texts: string[],
): Promise<Buffer | null> {
  const list = texts.filter(Boolean).length
    ? `Use these ${target} translations for the text blocks, in reading order:\n` +
      texts.filter(Boolean).map((t, i) => `${i + 1}. ${t}`).join("\n") + "\n"
    : "";
  const prompt =
    `This image is a cropped horizontal section of a Korean product detail page. ` +
    `Replace ALL Korean text with natural, marketing-quality ${target}, in place. ${list}` +
    `Keep the exact same layout, background, product photos, graphics, colors and font styling. ` +
    `Do not add, remove or move any visual elements. Do not alter non-text areas. ` +
    `Do not translate brand names or logos. Output only the edited image with the same dimensions.`;
  const parts = await geminiCall(key, MODEL, [
    { inline_data: { mime_type: mime, data: crop.toString("base64") } },
    { text: prompt },
  ], 28_000).catch(() => null);
  return partsImage(parts)?.bytes ?? null;
}

// ── 폴백: 기존 전체 이미지 편집(감지 실패·텍스트 좌표 미확보 시에만) ──
async function translateWholeImage(key: string, bytes: Buffer, mime: string, target: string): Promise<TranslateImageResult> {
  const prompt =
    `Translate ALL Korean text in this product detail page image into natural, marketing-quality ${target}. ` +
    `Replace the Korean text in place with the ${target} translation. ` +
    `Keep the exact same layout, background, product photos, graphics, colors, and font styling. ` +
    `Do not add, remove, or move any visual elements. Do not translate brand names or logos — keep them as-is. ` +
    `Output the edited image only.`;
  try {
    const parts = await geminiCall(key, MODEL, [
      { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
      { text: prompt },
    ], 55_000);
    const img = partsImage(parts);
    if (img) return { ok: true, bytes: img.bytes, mime: img.mime, note: "텍스트 좌표 감지 실패 — 전체 편집 방식으로 처리됨" };
    console.error("[image-translate] no image in response:", partsText(parts).slice(0, 200));
    return { ok: false, error: "모델이 이미지를 반환하지 않았습니다 — 다시 시도하거나 다른 이미지로 시도하세요." };
  } catch (e) { return httpError(e); }
}

function httpError(e: unknown): TranslateImageResult {
  const status = (e as { status?: number }).status;
  const body = (e as { body?: string }).body ?? "";
  if (status === 400 && /API key/i.test(body)) return { ok: false, error: "Gemini API 키가 올바르지 않습니다(관리자 확인)." };
  if (status === 429) return { ok: false, error: "Gemini 사용량 한도 초과 — 잠시 후 다시 시도하세요." };
  if (status) return { ok: false, error: `번역 요청 실패(HTTP ${status})` };
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return { ok: false, error: "번역 시간 초과 — 이미지를 줄여 다시 시도하세요." };
  return { ok: false, error: "번역 처리 중 오류가 발생했습니다." };
}

// 제한 동시성 실행(밴드 편집 3개씩).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 이미지 1장을 타겟 언어로 번역한 새 이미지 생성. 실패해도 throw 하지 않는다. */
export async function translateImage(bytes: Buffer, mime: string, lang: ImgTranslateLang): Promise<TranslateImageResult> {
  const key = env.geminiKey;
  if (!key) return { ok: false, error: "GEMINI_API_KEY 미설정 — 설정 후 다시 시도하세요(관리자)." };
  const target = IMG_TRANSLATE_LANGS[lang].name;
  // 운영 중 문제 시 전체 편집 방식으로 즉시 되돌릴 수 있는 스위치.
  if (process.env.IMG_TRANSLATE_MODE === "whole") return translateWholeImage(key, bytes, mime, target);

  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    const W = meta.width ?? 0, H = meta.height ?? 0;
    if (!W || !H) return translateWholeImage(key, bytes, mime, target);

    // ① 감지 — 실패(null)면 폴백. 성공했는데 0개면 "번역할 한글 없음" → 원본 그대로.
    const boxes = await detectKoreanText(key, bytes, mime).catch((e) => { throw e; });
    if (boxes === null) return translateWholeImage(key, bytes, mime, target);
    if (boxes.length === 0) return { ok: true, bytes, mime, note: "이미지에서 한글 텍스트를 찾지 못했습니다 — 원본 그대로 저장" };

    // ② 정확 번역(실패해도 진행 — 편집 모델이 즉석 번역).
    const translated = await translateTexts(key, boxes.map((b) => b.text), target).catch(() => null);
    const withT = boxes.map((b, i) => ({ ...b, text: translated?.[i] ?? "" }));

    // ③ 밴드 편집 — 텍스트가 있는 가로 띠만 편집(동시 3, 실패 1회 재시도).
    const bands = mergeBands(withT, W, H);
    if (bands.length === 0) return translateWholeImage(key, bytes, mime, target);
    const cropMime = "image/png"; // 크롭은 무손실로 보내 편집 입력 품질 유지
    const results = await mapLimit(bands, 3, async (band) => {
      const crop = await sharp(bytes).extract({ left: 0, top: band.top, width: W, height: band.height }).png().toBuffer();
      let edited = await editBand(key, crop, cropMime, target, band.texts);
      if (!edited) edited = await editBand(key, crop, cropMime, target, band.texts); // 재시도 1회
      if (!edited) return null;
      // 모델 출력 해상도는 입력과 다를 수 있음 — 밴드 크기에 정확히 맞춰 되붙인다.
      const fitted = await sharp(edited).resize(W, band.height, { fit: "fill" }).png().toBuffer();
      return { top: band.top, buf: fitted };
    });

    const done = results.filter(Boolean) as { top: number; buf: Buffer }[];
    if (done.length === 0) return translateWholeImage(key, bytes, mime, target);
    const composed = sharp(bytes).composite(done.map((d) => ({ input: d.buf, left: 0, top: d.top })));
    const outJpeg = mime === "image/jpeg" || mime === "image/jpg";
    const outBytes = outJpeg ? await composed.jpeg({ quality: 92 }).toBuffer() : await composed.png().toBuffer();
    const failed = results.length - done.length;
    return {
      ok: true, bytes: outBytes, mime: outJpeg ? "image/jpeg" : "image/png",
      note: failed > 0 ? `${failed}개 구역은 번역에 실패해 원문이 남았습니다 — 한 번 더 실행해 주세요.` : undefined,
    };
  } catch (e) { return httpError(e); }
}
