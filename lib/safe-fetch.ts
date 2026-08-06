// SSRF 방어 fetch — 내부/사설/링크로컬/메타데이터 주소로의 서버사이드 요청 차단.
//   brand_url 등 외부 입력 URL 을 서버에서 여는 경로(crawlUrl·fetchSiteText)의 공용 게이트.
//   호스트를 DNS 로 해석해 사설 IP 면 거부하고, 리다이렉트는 수동으로 매 홉 재검증한다.
import { lookup } from "node:dns/promises";
import net from "node:net";

function ipIsPrivate(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) → 내부 v4 로 환원.
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) ip = m[1];
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 10 || a === 127 || a === 0) return true;            // private / loopback / this-host
    if (a === 172 && b >= 16 && b <= 31) return true;             // 172.16/12
    if (a === 192 && b === 168) return true;                      // 192.168/16
    if (a === 169 && b === 254) return true;                      // link-local (169.254.169.254 metadata)
    if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT 100.64/10
    if (a === 198 && (b === 18 || b === 19)) return true;         // benchmarking
    if (a >= 224) return true;                                    // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;               // loopback / unspecified
    if (low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true; // link-local / ULA
    return false;
  }
  return true; // 해석 불가 → 거부
}

/** 호스트명을 해석해 공인 IP 인지 검증(아니면 throw). */
async function assertPublicHost(hostname: string): Promise<void> {
  // 리터럴 IP 도 검사.
  if (net.isIP(hostname)) { if (ipIsPrivate(hostname)) throw new Error("사설/내부 주소 차단"); return; }
  const addrs = await lookup(hostname, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error("호스트 해석 실패");
  for (const a of addrs) if (ipIsPrivate(a.address)) throw new Error("사설/내부 주소 차단");
}

export interface SafeFetchResult { ok: boolean; status?: number; text?: string; finalUrl?: string; error?: string }

/**
 * SSRF-안전 텍스트 fetch. http/https 만, 사설 IP 거부, 리다이렉트 수동 재검증(최대 4홉),
 * 크기 상한(기본 500KB) · 타임아웃(기본 8s). 실패해도 throw 하지 않고 결과 객체로 반환.
 */
export async function safeFetchText(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxHops?: number } = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 500_000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxHops = opts.maxHops ?? 4;
  let current = rawUrl;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxHops; hop++) {
      let u: URL;
      try { u = new URL(current); } catch { return { ok: false, error: "URL 형식 아님" }; }
      if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "http/https 만 허용" };
      await assertPublicHost(u.hostname); // 사설 IP 면 throw → catch 로
      const res = await fetch(u.toString(), {
        signal: ctrl.signal, redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; GlovekBot/1.0; +https://glovek.space)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, status: res.status, error: "리다이렉트 Location 없음" };
        current = new URL(loc, u).toString(); // 다음 홉에서 재검증
        continue;
      }
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      // 크기 상한 내에서만 읽기.
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, maxBytes));
      return { ok: true, status: res.status, text, finalUrl: u.toString() };
    }
    return { ok: false, error: "리다이렉트 홉 초과" };
  } catch (e) {
    const name = (e as Error).name;
    return { ok: false, error: name === "AbortError" ? "응답 시간 초과" : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
