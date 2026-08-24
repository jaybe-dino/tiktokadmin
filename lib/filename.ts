// 업로드 파일명 한글 깨짐 보정 + 다운로드 Content-Disposition 안전 생성.

/**
 * multipart 업로드의 파일명이 latin1 로 잘못 디코드된 UTF-8(한글 mojibake)이면 되돌린다.
 *   · 이미 한글이 정상이면 그대로.
 *   · latin1 보충영역(0x80-0xFF) 흔적이 있고 재디코드 시 한글이 나오면 교체.
 */
export function fixUploadFilename(name: string | null | undefined): string | null {
  if (!name) return name ?? null;
  // 정상 한글이 이미 있으면 손대지 않음.
  if (/[\uac00-\ud7a3]/.test(name)) return name;
  // latin1 로 오디코드된 UTF-8 흔적이 있으면 재디코드 시도.
  if (/[\u0080-\u00ff]/.test(name)) {
    try {
      const decoded = Buffer.from(name, "latin1").toString("utf8");
      if (/[\uac00-\ud7a3]/.test(decoded)) return decoded;
    } catch { /* noop */ }
  }
  return name;
}

/**
 * 한글 등 비ASCII 파일명을 브라우저가 올바로 표시하도록 RFC 5987 형식으로 생성.
 *   filename="ascii-fallback"; filename*=UTF-8''<percent-encoded>
 */
export function contentDisposition(filename: string | null | undefined, mode: "inline" | "attachment" = "inline"): string {
  const name = fixUploadFilename(filename) || "file";
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_"); // 폴백(ASCII)
  const encoded = encodeURIComponent(name);
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
