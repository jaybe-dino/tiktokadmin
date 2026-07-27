import { NextRequest } from "next/server";
import { env } from "./env";

// Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 를 보낸다.
export function cronAuthorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return true; // 미설정(로컬)에서는 허용
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}
