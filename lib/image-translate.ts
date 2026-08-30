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

// 이미지 편집 모델 — 기본은 최고 품질(Nano Banana Pro: 텍스트 렌더링·다국어 조판이 가장 정확).
//   키/티어에서 미지원·한도 초과면 flash 로 자동 폴백. 비용 절감이 필요하면
//   GEMINI_IMAGE_MODEL=gemini-2.5-flash-image 로 내릴 수 있다(장당 비용 약 1/3).
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const MODEL_FALLBACK = process.env.GEMINI_IMAGE_MODEL_FALLBACK || "gemini-2.5-flash-image";
// 텍스트 감지(좌표)·번역용 텍스트 모델.
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
// 완성도 루프 예산 — 라우트 maxDuration(240s) 안에서 끝내도록 여유를 둔다.
const BUDGET_MS = Number(process.env.IMG_TRANSLATE_BUDGET_MS ?? 210_000);
const MAX_ROUNDS = Math.max(1, Number(process.env.IMG_TRANSLATE_ROUNDS ?? 3));

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
  imageConfig?: Record<string, unknown>,
): Promise<GeminiPart[] | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const genCfg = {
      ...(jsonOut ? { responseMimeType: "application/json" } : {}),
      ...(imageConfig ? { imageConfig } : {}),
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts }],
          ...(Object.keys(genCfg).length ? { generationConfig: genCfg } : {}),
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
    `Find EVERY block of Korean text in this image, without exception. ` +
    `Return ONLY a JSON array: [{"box_2d":[ymin,xmin,ymax,xmax],"text":"<the Korean text>"}] ` +
    `with coordinates normalized to 0-1000. Be exhaustive — include headings, body copy, captions, ` +
    `bullet lists, table cells, footnotes, small print, price/spec labels, badges, stickers, ` +
    `text baked into product photos, illustrations and diagrams, text on buttons, and vertical text. ` +
    `Even a single Korean word or a mixed Korean/English line counts — report it. ` +
    `Split text into separate boxes when blocks are visually separated. ` +
    `Exclude text that contains no Korean characters, and exclude brand names/logos. ` +
    `If there is genuinely no Korean text, return [].`;
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

// ── ①-b 타일 감지 — 긴 상세페이지는 통으로 넣으면 모델 입력 해상도에 맞춰 축소되면서
//   작은 글씨를 놓친다(번역 누락의 주원인). 세로로 잘라 각 조각을 원해상도로 감지한 뒤
//   좌표를 전체 기준으로 되돌린다. 경계에 걸친 글자를 놓치지 않도록 조각을 겹쳐 자른다.

/** 감지용 세로 타일 구간(겹침 포함). 이미지가 짧으면 통으로 1개. */
export function tileRanges(width: number, height: number, overlap = 0.12): { top: number; height: number }[] {
  const tileH = Math.max(1, Math.round(width * 1.3));
  if (height <= Math.round(tileH * 1.25)) return [{ top: 0, height }];
  const step = Math.max(1, Math.round(tileH * (1 - overlap)));
  const out: { top: number; height: number }[] = [];
  for (let top = 0; top < height; top += step) {
    const h = Math.min(tileH, height - top);
    out.push({ top, height: h });
    if (top + h >= height) break;
  }
  // 마지막 조각이 너무 얇으면 위로 늘려 흡수(얇은 조각은 감지 품질이 떨어진다).
  const last = out[out.length - 1];
  if (out.length > 1 && last.height < tileH * 0.3) {
    last.top = Math.max(0, height - tileH);
    last.height = height - last.top;
  }
  return out;
}

/** 겹친 타일에서 같은 글이 두 번 잡히는 것을 정리(세로 구간이 겹치고 글자가 같으면 하나로). */
export function dedupeBoxes(boxes: TextBox[]): TextBox[] {
  const out: TextBox[] = [];
  for (const b of [...boxes].sort((a, z) => a.ymin - z.ymin)) {
    const key = b.text.replace(/\s+/g, "");
    const dup = key
      ? out.find((o) => o.text.replace(/\s+/g, "") === key && Math.min(o.ymax, b.ymax) > Math.max(o.ymin, b.ymin))
      : undefined;
    if (dup) {
      dup.ymin = Math.min(dup.ymin, b.ymin); dup.ymax = Math.max(dup.ymax, b.ymax);
      dup.xmin = Math.min(dup.xmin, b.xmin); dup.xmax = Math.max(dup.xmax, b.xmax);
      continue;
    }
    out.push({ ...b });
  }
  return out;
}

/** 전체 이미지의 한글 블록 감지 — 타일별 감지 결과를 전체 좌표(0~1000)로 합친다.
 *  모든 타일이 실패하면 null(호출부가 전체 편집으로 폴백). */
async function detectAllKorean(
  key: string, bytes: Buffer, W: number, H: number,
  sharpFn: (input: Buffer) => import("sharp").Sharp,
): Promise<TextBox[] | null> {
  const tiles = tileRanges(W, H);
  if (tiles.length === 1) return detectKoreanText(key, bytes, "image/png");
  const results = await mapLimit(tiles, 3, async (t) => {
    const crop = await sharpFn(bytes).extract({ left: 0, top: t.top, width: W, height: t.height }).png().toBuffer();
    const found = await detectKoreanText(key, crop, "image/png").catch(() => null);
    if (!found) return null;
    // 타일 로컬 좌표(0~1000) → 전체 좌표(0~1000)
    return found.map((b) => ({
      ...b,
      ymin: ((t.top + (b.ymin / 1000) * t.height) / H) * 1000,
      ymax: ((t.top + (b.ymax / 1000) * t.height) / H) * 1000,
    }));
  });
  const okTiles = results.filter(Boolean) as TextBox[][];
  if (okTiles.length === 0) return null;
  return dedupeBoxes(okTiles.flat());
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

// ── 화면비 보정 ──
//   Gemini 이미지 모델은 "지원 화면비"로만 출력한다(21:9 ~ 9:16). 크롭 비율이 그 목록과
//   조금이라도 다르면 출력도 다른 비율로 와서, 원래 자리에 되붙일 때 눌려 깨진다.
//   (근사 비율로 보내는 것만으로는 부족 — 지원 비율 사이 간격 탓에 최대 15% 어긋난다.)
//   해결: 밴드를 "정확히" 지원 화면비가 되는 높이까지 확장해서 보낸다. 이미지 폭은 제각각이라
//   필요 높이(폭 ÷ 비율)를 이미지·밴드마다 계산하며, 확장한 픽셀은 원본 자리에 그대로
//   되붙으므로 손실이 없다. 이러면 출력이 입력과 같은 비율 → 등비 축소만 하면 되어 왜곡이 없다.
const SUPPORTED_RATIOS: { label: string; r: number }[] = [
  { label: "21:9", r: 21 / 9 }, { label: "16:9", r: 16 / 9 }, { label: "4:3", r: 4 / 3 },
  { label: "3:2", r: 3 / 2 }, { label: "1:1", r: 1 }, { label: "2:3", r: 2 / 3 },
  { label: "3:4", r: 3 / 4 }, { label: "9:16", r: 9 / 16 },
];
const MAX_RATIO = 21 / 9;

/** 폭/높이 비에 가장 가까운 지원 화면비 라벨. */
export function nearestRatio(width: number, height: number): string {
  const r = width / Math.max(1, height);
  let best = SUPPORTED_RATIOS[0];
  for (const c of SUPPORTED_RATIOS) if (Math.abs(c.r - r) < Math.abs(best.r - r)) best = c;
  return best.label;
}

/** 밴드를 21:9 보다 납작하지 않게 위·아래로 확장(이미지 경계 안에서). */
export function padToRatio(top: number, height: number, width: number, imgH: number): { top: number; height: number } {
  const need = Math.ceil(width / MAX_RATIO);
  if (height >= need || imgH <= height) return { top, height };
  const grow = Math.min(need, imgH) - height;
  let newTop = top - Math.floor(grow / 2);
  let newH = height + grow;
  if (newTop < 0) newTop = 0;
  if (newTop + newH > imgH) newTop = Math.max(0, imgH - newH);
  return { top: newTop, height: Math.min(newH, imgH - newTop) };
}

/** 밴드를 "정확히" 지원 화면비가 되는 높이로 확장(이미지 폭 기준으로 매번 계산).
 *  텍스트를 잘라내지 않도록 확장만 하며(축소 없음), 이미지가 짧아 어떤 비율도 담을 수 없으면
 *  null → 호출부가 근사 방식(padToRatio + nearestRatio)으로 폴백한다. */
export function fitBandToRatio(
  top: number, height: number, width: number, imgH: number,
): { top: number; height: number; ratio: string } | null {
  let pick: { label: string; need: number } | null = null;
  for (const c of SUPPORTED_RATIOS) {
    const need = Math.round(width / c.r);
    // 텍스트를 담을 만큼 크고(확장만), 이미지 안에 들어가는 것 중 가장 작은 확장을 고른다.
    if (need >= height && need <= imgH && (!pick || need < pick.need)) pick = { label: c.label, need };
  }
  if (!pick) return null;
  const grow = pick.need - height;
  let newTop = top - Math.floor(grow / 2);
  if (newTop < 0) newTop = 0;
  if (newTop + pick.need > imgH) newTop = imgH - pick.need;
  return { top: newTop, height: pick.need, ratio: pick.label };
}

export interface FittedBand extends Band { ratio: string }

/** 밴드들을 지원 화면비에 맞춰 확장하고, 그 과정에서 겹친 구역은 합친다.
 *  겹친 채로 각각 편집해 되붙이면 나중 밴드가 앞 밴드의 번역을 원문으로 덮어쓴다.
 *  병합하면 높이가 달라져 비율이 깨지므로, 겹침이 사라질 때까지 확장·병합을 반복한다. */
export function fitBands(bands: Band[], width: number, imgH: number): FittedBand[] {
  let cur: Band[] = bands.map((b) => ({ ...b, texts: [...b.texts] }));
  for (let iter = 0; iter < 6; iter++) {
    const fitted: FittedBand[] = cur
      .map((b) => {
        const f = fitBandToRatio(b.top, b.height, width, imgH);
        if (f) return { top: f.top, height: f.height, texts: b.texts, ratio: f.ratio };
        const p = padToRatio(b.top, b.height, width, imgH);
        return { top: p.top, height: p.height, texts: b.texts, ratio: nearestRatio(width, p.height) };
      })
      .sort((a, b) => a.top - b.top);
    const merged: FittedBand[] = [];
    let overlapped = false;
    for (const p of fitted) {
      const last = merged[merged.length - 1];
      if (last && p.top <= last.top + last.height) {
        last.height = Math.max(last.top + last.height, p.top + p.height) - last.top;
        last.texts = [...last.texts, ...p.texts];
        overlapped = true;
      } else merged.push({ ...p, texts: [...p.texts] });
    }
    // 겹침이 없으면 각 밴드가 정확한 비율을 유지한 상태 — 확정.
    if (!overlapped) return merged;
    cur = merged.map((m) => ({ top: m.top, height: m.height, texts: m.texts }));
  }
  // 반복해도 안 끝나면(밴드가 이미지 전체를 덮는 경우 등) 근사 비율로 마무리.
  return cur.map((b) => ({ ...b, ratio: nearestRatio(width, b.height) }));
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
  ratio: string, width: number, height: number,
): Promise<Buffer | null> {
  const list = texts.filter(Boolean).length
    ? `Use these ${target} translations for the text blocks, in reading order:\n` +
      texts.filter(Boolean).map((t, i) => `${i + 1}. ${t}`).join("\n") + "\n"
    : "";
  const prompt =
    `This image is a cropped horizontal section of a Korean product detail page (${width}x${height} pixels). ` +
    `Replace ALL Korean text with natural, marketing-quality ${target}, in place. ${list}` +
    `Keep the exact same layout, framing, background, product photos, graphics, colors and font styling. ` +
    `Do not crop, zoom, rotate, rescale or reframe the image — the output must be pixel-aligned with the input. ` +
    `Do not add, remove or move any visual elements. Do not alter non-text areas. ` +
    `Do not translate brand names or logos. Output only the edited image at the same ${ratio} aspect ratio.`;
  // 기본 모델(Pro) → 실패(미지원 404·한도 429 등) 시 flash 폴백 — 밴드 단위라 부분 성공 가능.
  //   화면비를 명시해 모델이 다른 비율로 재조판하는 것을 막는다(되붙일 때 눌림·깨짐 방지).
  //   Pro 는 2K 출력을 지원해 텍스트가 훨씬 선명하다(flash 는 해당 필드 무시).
  for (const model of [MODEL, ...(MODEL_FALLBACK !== MODEL ? [MODEL_FALLBACK] : [])]) {
    const cfg: Record<string, unknown> = { aspectRatio: ratio };
    if (/pro/i.test(model)) cfg.imageSize = "2K";
    const parts = await geminiCall(key, model, [
      { inline_data: { mime_type: mime, data: crop.toString("base64") } },
      { text: prompt },
    ], 40_000, false, cfg).catch(() => null);
    const img = partsImage(parts)?.bytes;
    if (img) return img;
  }
  return null;
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
    let lastErr: unknown = null;
    for (const model of [MODEL, ...(MODEL_FALLBACK !== MODEL ? [MODEL_FALLBACK] : [])]) {
      try {
        const parts = await geminiCall(key, model, [
          { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
          { text: prompt },
        ], 55_000);
        const img = partsImage(parts);
        if (img) return { ok: true, bytes: img.bytes, mime: img.mime, note: "텍스트 좌표 감지 실패 — 전체 편집 방식으로 처리됨" };
        console.error("[image-translate] no image in response:", partsText(parts).slice(0, 200));
      } catch (e) { lastErr = e; }
    }
    if (lastErr) return httpError(lastErr);
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

  const t0 = Date.now();
  const msLeft = () => BUDGET_MS - (Date.now() - t0);

  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    const W = meta.width ?? 0, H = meta.height ?? 0;
    if (!W || !H) return translateWholeImage(key, bytes, mime, target);

    let cur = bytes;             // 라운드마다 갱신되는 현재 이미지
    let verifiedClean = false;   // 감지 결과 "한글 0곳"으로 확인된 상태
    let anyEdit = false;
    let leftover = 0;            // 마지막 감지에서 남아 있던 한글 블록 수

    // 완성도 루프 — 번역 후 다시 감지해서 남은 한글이 있으면 그 부분만 재작업한다.
    //   (감지 모델이 한 번에 모든 글자를 잡지 못하는 것이 누락의 주원인이라, 확인·재시도가
    //    프롬프트 개선보다 확실하다. 예산 안에서 최대 ROUNDS 회.)
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 한 라운드(감지+편집)를 돌릴 시간이 없으면 중단하고 지금까지 결과를 반환.
      if (round > 0 && msLeft() < 35_000) break;

      const boxes = await detectAllKorean(key, cur, W, H, sharp);
      if (boxes === null) {
        if (round === 0) return translateWholeImage(key, bytes, mime, target);
        break; // 이미 일부 번역됨 — 감지 실패라도 지금까지 결과를 유지
      }
      leftover = boxes.length;
      if (boxes.length === 0) {
        // 첫 라운드면 애초에 한글이 없는 이미지, 이후 라운드면 남김없이 번역 완료.
        if (round === 0) return { ok: true, bytes, mime, note: "이미지에서 한글 텍스트를 찾지 못했습니다 — 원본 그대로 저장" };
        verifiedClean = true;
        break;
      }

      // ② 정확 번역(실패해도 진행 — 편집 모델이 즉석 번역).
      const translated = await translateTexts(key, boxes.map((b) => b.text), target).catch(() => null);
      const withT = boxes.map((b, i) => ({ ...b, text: translated?.[i] ?? "" }));

      // ③ 밴드 편집 — 밴드 병합 → 정확한 지원 화면비로 확장 → 겹침 정리
      //    (겹친 채 되붙이면 나중 밴드가 앞 밴드의 번역을 원문으로 덮어쓴다).
      const bands = fitBands(mergeBands(withT, W, H), W, H);
      if (bands.length === 0) {
        if (round === 0) return translateWholeImage(key, bytes, mime, target);
        break;
      }
      const src = cur; // 이번 라운드의 크롭 원본
      const results = await mapLimit(bands, 4, async (band) => {
        if (msLeft() < 12_000) return null; // 예산 초과분은 다음 실행에서 처리
        const { top, height, ratio } = band;
        const crop = await sharp(src).extract({ left: 0, top, width: W, height }).png().toBuffer();
        let edited = await editBand(key, crop, "image/png", target, band.texts, ratio, W, height);
        if (!edited && msLeft() > 15_000) {
          edited = await editBand(key, crop, "image/png", target, band.texts, ratio, W, height); // 재시도 1회
        }
        if (!edited) return null;
        // 되붙이기 — 입력과 같은 비율로 받았으므로 등비 축소만 일어난다(lanczos3 로 선명도 유지).
        //   혹시 모델이 다른 비율로 보내면 cover 로 중앙을 맞춰 잘라 넣는다(늘여서 눌리는 것보다 낫다).
        const fitted = await sharp(edited)
          .resize(W, height, { fit: "cover", position: "centre", kernel: "lanczos3" })
          .png().toBuffer();
        return { top, buf: fitted };
      });

      const done = results.filter(Boolean) as { top: number; buf: Buffer }[];
      if (done.length === 0) {
        if (round === 0 && !anyEdit) return translateWholeImage(key, bytes, mime, target);
        break;
      }
      anyEdit = true;
      // 라운드 중간 결과는 무손실(PNG)로 유지 — 반복 저장에 따른 화질 열화 방지.
      cur = await sharp(cur).composite(done.map((d) => ({ input: d.buf, left: 0, top: d.top }))).png().toBuffer();
    }

    if (!anyEdit) return translateWholeImage(key, bytes, mime, target);

    const outJpeg = mime === "image/jpeg" || mime === "image/jpg";
    // 텍스트 가장자리 보존을 위해 JPEG 품질을 높게(4:4:4 크로마 서브샘플링 해제).
    const outBytes = outJpeg
      ? await sharp(cur).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer()
      : await sharp(cur).png().toBuffer();
    return {
      ok: true, bytes: outBytes, mime: outJpeg ? "image/jpeg" : "image/png",
      note: verifiedClean
        ? undefined
        : `번역되지 않은 한글이 남아 있을 수 있습니다${leftover ? ` (마지막 확인 ${leftover}곳)` : ""} — ` +
          `"이어서 번역"을 실행하면 남은 부분만 다시 처리합니다.`,
    };
  } catch (e) { return httpError(e); }
}
