import { NextRequest } from "next/server";
import { env } from "./env";

// Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 를 보낸다.
export function cronAuthorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  // 프로덕션에서 시크릿 미설정이면 fail-closed(무보호 크론·데이터노출 방지).
  //   로컬(NODE_ENV!=='production')에서만 미설정 시 허용.
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  // 브라우저/curl 수동 트리거용 쿼리 토큰 (?token=...)
  if (req.nextUrl.searchParams.get("token") === secret) return true;
  return false;
}
