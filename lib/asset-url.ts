// 제안서 이미지 URL 정리 — 순수 함수(클라이언트에서도 import 가능, DB 의존 없음).
//   문제 1) 구글드라이브 공유 링크(file/d/…/view)는 이미지가 아니라 HTML 페이지 → <img> 에서 항상 깨짐.
//   문제 2) /api/brand/import-file/… · /api/apply/file/… 은 세션 보호 → 로그인 없는 제안서 열람자에겐 403.
//   해결: ① 드라이브 링크는 직접 표시 가능한 thumbnail 엔드포인트로 변환,
//         ② 세션 보호 파일은 제안서 토큰 기반 프록시(/api/proposal-asset/<token>/<id>)로 재작성.

/** 드라이브 공유 링크 → <img> 에서 바로 뜨는 형태로 변환. 그 외 URL 은 그대로. */
export function normalizeImageUrl(u: string | null | undefined): string {
  const url = (u ?? "").trim();
  if (!url) return "";
  // https://drive.google.com/file/d/<id>/view?... · /open?id=<id> · /uc?id=<id>&...
  const m =
    url.match(/drive\.google\.com\/file\/d\/([\w-]{10,})/) ||
    url.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([\w-]{10,})/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600`;
  return url;
}

const PROTECTED_FILE_RE = /^\/api\/(?:brand\/import-file|apply\/file)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** 제안서 공개 페이지용 — 드라이브 변환 + 세션 보호 파일을 토큰 프록시 경로로 재작성. */
export function proposalAssetUrl(u: string | null | undefined, token: string): string {
  const n = normalizeImageUrl(u);
  const m = n.match(PROTECTED_FILE_RE);
  return m ? `/api/proposal-asset/${encodeURIComponent(token)}/${m[1]}` : n;
}

/** 제안서 공개 페이지용(강화판) — 보호 파일은 토큰 프록시로, 외부 http(s) 이미지는 서버 웹썸네일
 *  프록시(/api/proposal-img)로 재작성. 외부 CDN 의 핫링크 차단·만료 URL 도 서버가 대신 받아
 *  첫 성공 시 영구 캐시하므로, 웹에서 보는 썸네일이 그대로 뜬다. */
export function proposalImageUrl(u: string | null | undefined, token: string): string {
  const n = normalizeImageUrl(u);
  if (!n) return "";
  const m = n.match(PROTECTED_FILE_RE);
  if (m) return `/api/proposal-asset/${encodeURIComponent(token)}/${m[1]}`;
  if (/^https?:\/\//i.test(n)) return `/api/proposal-img/${encodeURIComponent(token)}?u=${encodeURIComponent(n)}`;
  return n;
}
