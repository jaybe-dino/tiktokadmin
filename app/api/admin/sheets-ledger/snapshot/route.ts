import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sheetsAuthState } from "@/lib/google-sheets";
import { readLedger, ledgerScope, rowOptions } from "@/lib/ledger-sheet-sync";
import { buildRow, MANAGED_HEADERS } from "@/lib/ledger-sheet-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 원장 스냅샷(읽기 전용) — Google 권한 승인 전에 시트에 들어갈 값을 그대로 확인하는 경로.
//   GET /api/admin/sheets-ledger/snapshot
//
//   · 로그인 세션만 받는다. cron 토큰·쿼리 토큰 경로를 두지 않는다.
//   · role=exec 만 통과한다(401 미로그인 / 403 권한부족).
//   · 돌려주는 값은 "시트에 쓰기로 승인된 열" 뿐이다. buildRow 결과를 그대로 쓰므로
//     은행·서류·비밀번호·토큰은 애초에 담기지 않는다.
//   · 쓰기가 없다 — 시트도, DB 도 건드리지 않는다.
export async function GET() {
  const user = await currentUser().catch(() => null);
  if (!user) return noStore({ error: "unauthorized" }, 401);
  if (user.role !== "exec") return noStore({ error: "forbidden" }, 403);

  const brands = await readLedger();
  const scope = await ledgerScope();
  const collectedAt = new Date().toISOString();
  const o = rowOptions(collectedAt);

  // 시트에 쓰는 열만 추려 담는다. MANAGED_HEADERS 밖의 값은 응답에 들어가지 않는다.
  const rows = brands.map((b) => {
    const full = buildRow(b, o);
    const out: Record<string, string | number> = {};
    for (const h of MANAGED_HEADERS) if (full[h] !== undefined) out[h] = full[h];
    return out;
  });

  const auth = sheetsAuthState();
  return noStore({
    ok: true,
    collectedAt,
    count: rows.length,
    scope,
    fields: [...MANAGED_HEADERS],
    meta: {
      // 이 시트 한 개에 편집자로 공유할 대상. 공개해도 되는 값이다(비밀키가 아니다).
      //   비밀키·액세스 토큰·도메인 위임 클라이언트 ID 는 어떤 경우에도 담지 않는다.
      serviceAccountEmail: auth.clientEmail || null,
      // 운영 런타임 기준 설정 여부. 이 값이 false 라고 해서 운영에 없다는 뜻은 아니다 —
      // 이 응답을 만든 런타임에 없다는 뜻이다(Cloud 컨테이너와 운영 환경은 다르다).
      runtimeHasServiceAccountKey: auth.hasServiceAccount,
      runtimeHasSpreadsheetId: auth.hasSpreadsheetId,
      authMode: auth.mode,
      sheetWriteReady: auth.ready,
    },
    rows,
  }, 200);
}

function noStore(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store, no-cache, must-revalidate", pragma: "no-cache" },
  });
}
