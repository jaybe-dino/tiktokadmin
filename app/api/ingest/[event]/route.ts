import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { processIngest } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretOk(provided: string | null): boolean {
  const expected = env.ingestSecret;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ event: string }> },
) {
  const { event } = await params;

  if (!secretOk(req.headers.get("x-ingest-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const idemKey = req.headers.get("x-idempotency-key");
  if (!idemKey) {
    return NextResponse.json({ error: "validation", fields: ["X-Idempotency-Key 필수"] }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "validation", fields: ["invalid json"] }, { status: 400 });
  }

  const result = await processIngest(event, idemKey, payload);
  return NextResponse.json(result.body, { status: result.http });
}
