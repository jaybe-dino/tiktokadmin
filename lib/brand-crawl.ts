// 브랜드 제출 URL 서버사이드 크롤 — 제안서 기본내용 AI 생성용 컨텍스트 추출.
//   임의 사이트를 여는 특성상 SSRF 방어(safeFetchText: 사설 IP 차단·리다이렉트 재검증)를 거친다.
//   JS 렌더 페이지는 메타태그(og:*)·title 위주로만 얻어질 수 있음(전체 본문 추출은 best-effort).
import { safeFetchText } from "./safe-fetch";

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
  const res = await safeFetchText(u, { maxBytes: 500_000, timeoutMs: 8000 });
  if (!res.ok || !res.text) return { ok: false, error: res.error ?? "가져오기 실패" };
  const html = res.text;
  const pick = (re: RegExp) => (html.match(re)?.[1] || "").trim();
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const ogImageRaw = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i);
  const ogImage = /^https?:\/\//i.test(ogImageRaw) ? ogImageRaw : undefined; // http(s) 만 허용
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
}

