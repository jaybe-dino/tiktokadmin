// LOA(수권서) PDF 생성 — 서명 이미지 포함. pdf-lib(순수 JS, 서버리스).
//   본문은 영문 법적 문서(식별 필드도 영문 수집). 폰트 미지원 문자는 안전 치환.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const S = (v: unknown) => (v == null ? "" : String(v)).trim();
// WinAnsi(Helvetica) 미지원 문자 안전화 — 한글 등은 '?' 로(온스크린 뷰는 정상 표기).
const A = (v: unknown) => S(v).replace(/[^\x20-\x7E¡-ÿ]/g, "?") || "____________";

export async function buildLoaPdf(app: Record<string, unknown>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 pt
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const M = 56;
  const maxW = width - M * 2;
  const ink = rgb(0.12, 0.13, 0.15);
  const gray = rgb(0.42, 0.45, 0.5);
  let y = 841.89 - 64;

  const wrap = (text: string, f: typeof font, size: number): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const draw = (text: string, opts: { f?: typeof font; size?: number; color?: typeof ink; gap?: number; x?: number } = {}) => {
    const f = opts.f ?? font, size = opts.size ?? 10.5;
    for (const line of wrap(text, f, size)) {
      page.drawText(line, { x: opts.x ?? M, y, size, font: f, color: opts.color ?? ink });
      y -= size + (opts.gap ?? 5);
    }
  };
  const space = (n: number) => { y -= n; };

  // 제목
  const title = "LETTER OF AUTHORIZATION";
  page.drawText(title, { x: (width - bold.widthOfTextAtSize(title, 20)) / 2, y, size: 20, font: bold, color: ink });
  y -= 40;

  const rep = A(app.ubo_full_name), pos = A(app.ubo_title), coEn = A(app.company_name_en);
  const shop = A(app.shop_name_en), cat = A(app.product_category);

  draw(`This letter serves as an official authorization for ${rep}, ${pos} of ${coEn}, to represent the company in all matters concerning our TikTok Shop business.`);
  space(6);
  draw(`${rep} is hereby authorized to:`, { f: bold });
  for (const li of [
    `Register and operate a TikTok Shop account`,
    `List and sell [${cat}] products`,
    `Manage all business operations related to TikTok Shop`,
    `Handle all transactions, communications, and administrative matters`,
    `Make business decisions on behalf of [${coEn}]`,
  ]) draw(`•  ${li}`, { x: M + 10 });
  space(6);
  draw(`This authorization is valid from the date of this letter and shall remain in effect until revoked in writing.`);
  space(10);

  // Brand Information
  page.drawLine({ start: { x: M, y: y + 4 }, end: { x: width - M, y: y + 4 }, thickness: 0.7, color: rgb(0.9, 0.9, 0.92) });
  space(8);
  draw("Brand Information", { f: bold });
  for (const li of [`Brand name: ${shop}`, `Company: ${coEn}`, `Authorized Representative: ${rep}`, `Position: ${pos}`])
    draw(`•  ${li}`, { x: M + 10, size: 10, color: gray });
  space(14);

  // 서명 블록 (2단)
  const colY = y;
  const col2X = width / 2 + 6;
  page.drawText("Authorized by", { x: M, y: colY, size: 11, font: bold, color: ink });
  page.drawText("Acknowledged by", { x: col2X, y: colY, size: 11, font: bold, color: ink });

  // 대표자 서명 이미지
  const sig = S(app.ubo_signature_data);
  const boxY = colY - 96, boxH = 84, boxW = maxW / 2 - 10;
  page.drawRectangle({ x: M, y: boxY, width: boxW, height: boxH, borderColor: rgb(0.84, 0.86, 0.88), borderWidth: 1 });
  if (sig.startsWith("data:image")) {
    try {
      const b64 = sig.split(",")[1] ?? "";
      const bytes = Buffer.from(b64, "base64");
      const img = sig.includes("image/png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const scale = Math.min((boxW - 12) / img.width, (boxH - 12) / img.height);
      page.drawImage(img, { x: M + (boxW - img.width * scale) / 2, y: boxY + (boxH - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    } catch { /* 이미지 손상 시 빈 박스 */ }
  }
  // 대행사 사전 서명
  page.drawRectangle({ x: col2X, y: boxY, width: boxW, height: boxH, borderColor: rgb(0.84, 0.86, 0.88), borderWidth: 1 });
  page.drawText("Hur Jeongbal", { x: col2X + 14, y: boxY + boxH / 2 - 6, size: 20, font, color: rgb(0.22, 0.24, 0.27) });

  y = boxY - 16;
  page.drawText(rep, { x: M, y, size: 11, font: bold, color: ink });
  page.drawText("DINO STUDIO INC.", { x: col2X, y, size: 11, font: bold, color: ink });
  y -= 14;
  page.drawText(pos, { x: M, y, size: 9.5, font, color: gray });
  page.drawText("Hur Jeongbal · CEO", { x: col2X, y, size: 9.5, font, color: gray });
  const signedAt = S(app.ubo_signed_at);
  if (signedAt) { y -= 13; page.drawText(`Signed at ${signedAt.slice(0, 10)}`, { x: M, y, size: 8.5, font, color: gray }); }

  return doc.save();
}
