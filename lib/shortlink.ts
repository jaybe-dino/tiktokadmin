// 드라이브 첨부 쇼트링크 (기획확정 8절 · 첨부 발송)
//   드라이브(@dinostudio.kr/@glovek.space) 링크 → 쇼트링크 변환 + 클릭 트래킹.
//   커스텀 도메인 file.glovek.space 는 Vercel 도메인 연결 + SHORTLINK_BASE env
//   (예: SHORTLINK_BASE=https://file.glovek.space) 로 커버 — 코드 변경 불필요.
//   리다이렉트 처리는 app/f/[code]/route.ts (클릭 시 clicks 증가 + link_clicks 기록).
import { randomBytes } from "node:crypto";
import { queryOne } from "./db";
import { env } from "./env";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LEN = 8;

/** 8자 랜덤 base62 코드 (node:crypto randomBytes 기반) */
function randomCode(len = CODE_LEN): string {
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += BASE62[buf[i] % 62];
  return out;
}

/** 구글 드라이브/문서 링크 판별 (drive.google.com / docs.google.com) */
export function isDriveUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "drive.google.com" || h === "docs.google.com" ||
      h.endsWith(".drive.google.com") || h.endsWith(".docs.google.com")
    );
  } catch {
    return false;
  }
}

/** 쇼트링크 베이스 URL — SHORTLINK_BASE(커스텀 도메인) 우선, 기본 ${ADMIN_URL}/f */
export function shortlinkBase(): string {
  return (process.env.SHORTLINK_BASE || `${env.adminUrl}/f`).replace(/\/+$/, "");
}

export interface ShortLink {
  code: string;
  url: string;
}

/**
 * 쇼트링크 생성 — 코드 저장 후 접속 URL 반환.
 * 코드 충돌(PK) 시 재생성(최대 5회). ON CONFLICT DO NOTHING 으로 원자적 처리.
 */
export async function createShortLink(
  targetUrl: string,
  opts: { brandId?: string | null; label?: string | null; createdBy?: string | null } = {},
): Promise<ShortLink> {
  const target = targetUrl.trim();
  if (!target) throw new Error("쇼트링크 대상 URL 이 비어 있습니다.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const row = await queryOne<{ code: string }>(
      `INSERT INTO short_links (code, target_url, brand_id, label, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [code, target, opts.brandId ?? null, opts.label ?? null, opts.createdBy ?? null],
    );
    if (row) return { code, url: `${shortlinkBase()}/${code}` };
  }
  throw new Error("쇼트링크 코드 생성 실패(충돌 반복)");
}
