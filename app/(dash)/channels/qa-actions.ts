"use server";
// Codex(운영 QA)용 안전 검증 경로 — 실제 고객을 건드리지 않고 수신거부 흐름을 끝까지 확인한다.
//   · 대상은 항상 합성 주소(qa+<난수>@glovek.invalid / 0100000xxxx)라 실제 수신자와 겹치지 않는다.
//     .invalid 는 예약 도메인(RFC 2606)이라 어떤 메일함에도 존재하지 않는다.
//   · 실제 발송은 하지 않는다(문구 미리보기만 만든다).
//   · 확정하면 ad_optouts 에 source='qa' 로 남아 운영 데이터와 구분된다.
import { randomBytes } from "node:crypto";
import { currentUser } from "@/lib/auth";
import { optoutUrl, withSmsOptout, withMailOptout, confirmOptOut, mintToken, addrHash, AD_PURPOSE } from "@/lib/ad-optout";
import { query } from "@/lib/db";

function canEdit(role: string | undefined): boolean { return role === "lead" || role === "exec"; }

export interface QaPreview {
  email: string; phone: string;
  smsUrl: string; mailUrl: string;
  smsBody: string; mailBody: string;
}

/** 합성 수신자 1명을 만들어 실제로 붙는 문구와 링크를 그대로 보여준다(발송 없음). */
export async function qaOptoutPreviewAction(sampleSms: string, sampleMail: string): Promise<{ ok: boolean; error?: string; data?: QaPreview }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };

  const n = randomBytes(4).toString("hex");
  const email = `qa+${n}@glovek.invalid`;      // 실존하지 않는 예약 도메인
  const phone = `0100000${n.slice(0, 4).replace(/[a-f]/g, "0")}`;
  const smsUrl = optoutUrl("phone", phone);
  const mailUrl = optoutUrl("email", email);
  return {
    ok: true,
    data: {
      email, phone, smsUrl, mailUrl,
      smsBody: withSmsOptout(sampleSms || "(문자 본문 예시)", smsUrl),
      mailBody: withMailOptout(sampleMail || "(메일 본문 예시)", mailUrl),
    },
  };
}

/** QA 합성 주소의 수신거부 상태를 확인한다(실제 고객 조회 아님). */
export async function qaOptoutStatusAction(email: string, phone: string): Promise<{ ok: boolean; blocked?: { kind: string; at: string }[]; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!/@glovek\.invalid$/.test(email)) return { ok: false, error: "QA 합성 주소만 조회할 수 있습니다." };
  const hashes = [addrHash("email", email), addrHash("phone", phone)].filter(Boolean);
  try {
    const rows = await query<{ kind: string; opted_out_at: string }>(
      `SELECT kind, opted_out_at::text AS opted_out_at FROM ad_optouts
        WHERE purpose=$1 AND addr_hash = ANY($2::text[])`, [AD_PURPOSE, hashes]);
    return { ok: true, blocked: rows.map((r) => ({ kind: r.kind, at: r.opted_out_at })) };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** QA 합성 주소로 만든 수신거부를 되돌린다 — 검증 후 정리용(실제 고객은 대상 아님). */
export async function qaOptoutResetAction(email: string, phone: string): Promise<{ ok: boolean; removed?: number; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  if (!/@glovek\.invalid$/.test(email)) return { ok: false, error: "QA 합성 주소만 정리할 수 있습니다." };
  const hashes = [addrHash("email", email), addrHash("phone", phone)].filter(Boolean);
  try {
    // source='qa' 또는 'link' 로 들어온 합성 주소 행만 지운다(실제 고객 해시는 애초에 대상이 아님).
    const rows = await query<{ id: string }>(
      `DELETE FROM ad_optouts WHERE purpose=$1 AND addr_hash = ANY($2::text[]) RETURNING id`,
      [AD_PURPOSE, hashes]);
    return { ok: true, removed: rows.length };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** QA 토큰으로 직접 확정(브라우저 없이 흐름 확인용). 합성 주소에만 허용. */
export async function qaOptoutConfirmAction(email: string, phone: string, which: "email" | "phone"): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  if (!/@glovek\.invalid$/.test(email)) return { ok: false, error: "QA 합성 주소만 확정할 수 있습니다." };
  const token = which === "email" ? mintToken("email", email) : mintToken("phone", phone);
  const r = await confirmOptOut(token, { source: "qa" });
  return { ok: r.ok, error: r.error, already: r.already };
}
