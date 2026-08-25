// 외부 이미지 다운로드 공용 유틸 — 제안서 웹썸네일 프록시·틱톡 레퍼런스 썸네일 저장 공용.
//   핫링크 차단(Referer 검사) 호스트 대응: 기본은 원본 도메인을 Referer 로, 틱톡 CDN 은 tiktok.com 을 보낸다.
//   이미지 MIME 만 허용(HTML 오류페이지·비이미지 차단), 8MB 상한, 실패 시 null.

export async function fetchExternalImage(
  url: string,
  timeoutMs = 8_000,
): Promise<{ bytes: Buffer; mime: string } | null> {
  let referer = "";
  try {
    const h = new URL(url);
    if (h.protocol !== "https:" && h.protocol !== "http:") return null;
    referer = /tiktok/i.test(h.hostname) ? "https://www.tiktok.com/" : `${h.origin}/`;
  } catch {
    return null;
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GlovekBot/1.0)",
        Referer: referer,
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0].trim() || "";
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
    return { bytes: buf, mime };
  } catch {
    return null;
  }
}
