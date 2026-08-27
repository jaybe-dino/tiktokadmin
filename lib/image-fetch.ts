// 외부 이미지 다운로드 공용 유틸 — 제안서 웹썸네일 프록시·틱톡 레퍼런스 썸네일 저장 공용.
//   핫링크 차단(Referer 검사) 호스트 대응: 기본은 원본 도메인을 Referer 로, 틱톡 CDN 은 tiktok.com 을 보낸다.
//   이미지 MIME 만 허용(HTML 오류페이지·비이미지 차단), 8MB 상한, 실패 시 null.

/** 틱톡 "영상 페이지" URL 판별 — 담당자가 썸네일 칸에 이미지 대신 영상 링크를 붙여넣는 입력 패턴 지원용.
 *  영상 페이지(/@handle/video/123…), 공유 단축(vm./vt.tiktok.com, /t/…) 이면 그 URL 을, 아니면 null. */
export function tiktokPageUrl(u?: string | null): string | null {
  const s = (u ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const h = new URL(s).hostname.toLowerCase();
    if (!/(^|\.)tiktok\.com$/.test(h)) return null;
    if (/\/video\/\d{6,}/.test(s) || /^(vm|vt)\./.test(h) || /\/t\//.test(s)) return s;
    return null;
  } catch { return null; }
}

/** 틱톡 oEmbed 로 영상의 "현재 유효한" 썸네일 URL 재조회 — cover_url 서명 만료(x-expires) 보정용.
 *  공개 API(인증 불필요): https://www.tiktok.com/oembed?url=<영상URL> → thumbnail_url */
export async function fetchTikTokOembedThumb(videoUrl: string, timeoutMs = 8_000): Promise<string | null> {
  try {
    const u = new URL(videoUrl);
    if (!/tiktok\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
  } catch { return null; }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { thumbnail_url?: string } | null;
    const t = (json?.thumbnail_url ?? "").trim();
    return /^https?:\/\//i.test(t) ? t : null;
  } catch { return null; }
}

export async function fetchExternalImage(
  url: string,
  timeoutMs = 8_000,
): Promise<{ bytes: Buffer; mime: string } | null> {
  let referer = "";
  try {
    const h = new URL(url);
    if (h.protocol !== "https:" && h.protocol !== "http:") return null;
    // 틱톡 CDN 은 Referer 가 붙으면 403 을 주는 경우가 있어 아예 보내지 않는다(no-referrer 로드와 동일).
    referer = /tiktok/i.test(h.hostname) ? "" : `${h.origin}/`;
  } catch {
    return null;
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        // 틱톡 CDN 등은 봇 UA 서버 요청을 차단 — 실제 브라우저 UA 로 요청.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        ...(referer ? { Referer: referer } : {}),
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
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
