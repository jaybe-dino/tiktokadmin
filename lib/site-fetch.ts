// 회사 웹사이트 본문 수집 — 심층 분석 근거용. HTML → 가독 텍스트 추출.
//   외부 사이트 fetch(프로덕션에서만 실동작). 타임아웃·크기 제한·오류 무해화.

function normalizeUrl(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { const u = new URL(withProto); return u.protocol.startsWith("http") ? u.toString() : null; }
  catch { return null; }
}

/** HTML → 텍스트: script/style/nav 제거, 태그 제거, 공백 정리. meta description 우선 추출. */
function htmlToText(html: string): string {
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return [title && `제목: ${title}`, metaDesc && `설명: ${metaDesc}`, ogDesc && ogDesc, body]
    .filter(Boolean).join("\n").slice(0, 8000);
}

async function fetchOne(url: string, ms = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; GlovekBot/1.0; +https://glovek.space)" },
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text")) return "";
    const html = (await res.text()).slice(0, 400_000);
    return htmlToText(html);
  } catch { return ""; }
  finally { clearTimeout(t); }
}

/**
 * 회사 사이트 수집 — 메인 + (있으면) 소개/회사 페이지 몇 개를 합쳐 텍스트로.
 *   반환 {ok, text, fetched[]}. 실패해도 throw 안 함(분석은 다른 데이터로 진행).
 */
export async function fetchSiteText(brandUrl: string): Promise<{ ok: boolean; text: string; fetched: string[] }> {
  const base = normalizeUrl(brandUrl);
  if (!base) return { ok: false, text: "", fetched: [] };
  const origin = new URL(base).origin;
  const candidates = [base, `${origin}/about`, `${origin}/company`, `${origin}/brand`, `${origin}/about-us`];
  const seen = new Set<string>();
  const parts: string[] = [];
  const fetched: string[] = [];
  for (const u of candidates) {
    if (seen.has(u)) continue; seen.add(u);
    const txt = await fetchOne(u);
    if (txt && txt.length > 80) { parts.push(`# ${u}\n${txt}`); fetched.push(u); }
    if (parts.join("\n").length > 12_000) break;  // 총량 상한
  }
  return { ok: parts.length > 0, text: parts.join("\n\n").slice(0, 14_000), fetched };
}
