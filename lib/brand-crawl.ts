// 브랜드 제출 URL 서버사이드 크롤 — 제안서 기본내용 AI 생성용 컨텍스트 추출.
//   임의 사이트를 여는 특성상 타임아웃·크기 상한·실패 graceful. JS 렌더 페이지는
//   메타태그(og:*)·title 위주로만 얻어질 수 있음(전체 본문 추출은 best-effort).
export interface CrawlResult {
  ok: boolean;
  title?: string;
  description?: string;
  ogImage?: string;
  text?: string;
  error?: string;
}

export async function crawlUrl(url: string): Promise<CrawlResult> {
  const u = (url || "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: "URL 형식이 아닙니다(https:// 필요)." };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(u, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GloveKBot/1.0; +https://glovek.space)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const raw = await res.text();
    const html = raw.slice(0, 500_000); // 대형 페이지 상한
    const pick = (re: RegExp) => (html.match(re)?.[1] || "").trim();
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const description =
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
      pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
    const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i);
    // og:title / product 관련 메타를 본문 앞에 얹어 신호 강화.
    const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    const text = [ogTitle, description, body].filter(Boolean).join(" · ");
    return { ok: true, title, description, ogImage, text };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "응답 시간 초과(8s)" : (e as Error).message };
  }
}
