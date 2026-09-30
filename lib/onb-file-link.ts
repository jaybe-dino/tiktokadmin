// 첨부파일 다운로드 링크 — 순수 함수(클라이언트에서도 import 가능, DB 의존 없음).
//   어드민에서 첨부를 받을 때 새 창 미리보기가 아니라 곧바로 저장되게 한다.
//   내부 저장 파일(/api/apply/file/<id>, /api/brand/import-file/<id>)만 ?dl=1 +
//   download 속성으로 강제할 수 있고, 브랜드가 직접 적어 넣은 외부 링크는
//   다른 출처라 브라우저가 download 를 무시하므로 새 창 열기를 유지한다.

const INTERNAL_FILE_RE = /^\/api\/(?:apply\/file|brand\/import-file)\/[^/?#]+/i;

/** 우리 서버가 직접 스트리밍하는 첨부인가(= 즉시 다운로드 강제 가능). */
export function isInternalFileUrl(u: string | null | undefined): boolean {
  return INTERNAL_FILE_RE.test((u ?? "").trim());
}

/** 즉시 다운로드용 href. 내부 첨부면 ?dl=1 을 붙이고, 외부 링크는 그대로 둔다. */
export function fileDownloadHref(u: string | null | undefined): string {
  const url = (u ?? "").trim();
  if (!isInternalFileUrl(url)) return url;
  if (/[?&]dl=1(?:&|$)/.test(url)) return url;
  return url.includes("?") ? `${url}&dl=1` : `${url}?dl=1`;
}

/** <a> 에 펼쳐 넣을 속성 묶음. 내부 첨부는 download, 외부 링크는 target=_blank. */
export function fileLinkProps(u: string | null | undefined, filename?: string) {
  const url = (u ?? "").trim();
  if (!isInternalFileUrl(url)) return { href: url, target: "_blank" as const, rel: "noreferrer" };
  return { href: fileDownloadHref(url), download: filename || "" };
}

/** Content-Disposition 한 줄. 한글·공백 파일명도 깨지지 않게 filename* (RFC 5987) 을 함께 준다. */
export function contentDisposition(filename: string, download: boolean): string {
  const safe = (filename || "download").replace(/[\r\n"]/g, "").replace(/[\\/]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_") || "download";
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
