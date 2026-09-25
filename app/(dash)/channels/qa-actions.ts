"use server";
// Codex(운영 QA)용 안전 검증 경로 — 실제 고객을 건드리지 않고 수신거부 흐름을 끝까지 확인한다.
//   · 대상은 서버가 만든 합성 수신자뿐이다. 주소는 항상 qa+<난수>@glovek.invalid 이고
//     전화번호는 아예 두지 않는다(.invalid 는 RFC 2606 예약 도메인이라 실존할 수 없다).
//   · 클라이언트는 주소를 보내지 않는다 — 서버가 발급한 토큰만 주고받으므로
//     실제 고객의 이메일·전화로 바꿔치기할 수 없다.
//   · 실제 발송은 하지 않고, 기록을 지우는 기능도 두지 않는다(삭제로 실기록을 건드릴 위험 제거).
import { randomBytes } from "node:crypto";
import { currentUser } from "@/lib/auth";
import {
  ensureRecipient, recipientByToken, optoutUrlFor, withSmsOptout, withMailOptout,
  confirmOptOut, adGate,
} from "@/lib/ad-optout";
import { AD_SEQ_ROUNDS } from "@/lib/ad-optout-copy";

function canEdit(role: string | undefined): boolean { return role === "lead" || role === "exec"; }
const QA_DOMAIN = "@glovek.invalid";

export interface QaFixture {
  token: string;
  emailMasked: string;
  url: string;
  smsBody: string;
  mailBody: string;
}

/** 합성 수신자 1명을 서버에서 만들고, 실제로 붙는 문구와 링크를 보여준다(발송 없음). */
export async function qaOptoutFixtureAction(): Promise<{ ok: boolean; error?: string; data?: QaFixture }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };

  const email = `qa+${randomBytes(4).toString("hex")}${QA_DOMAIN}`;
  const r = await ensureRecipient({ email, kind: "qa" }).catch(() => null);
  if (!r) return { ok: false, error: "QA 수신자를 만들지 못했습니다(마이그레이션 0098 적용 여부 확인)." };

  const url = optoutUrlFor(r.token);
  return {
    ok: true,
    data: {
      token: r.token,
      emailMasked: `qa+****${QA_DOMAIN}`,
      url,
      // 연속 안내와 같은 범위 표기로 보여준다 — 미리보기와 실제 발송 문구가 다르지 않게.
      smsBody: withSmsOptout("[디노스튜디오·GloveK]\n예시 문자 본문입니다.", url, { rounds: AD_SEQ_ROUNDS }),
      mailBody: withMailOptout("안녕하세요. 디노스튜디오 GloveK입니다.\n\n예시 메일 본문입니다.", url, { rounds: AD_SEQ_ROUNDS }),
    },
  };
}

/** 서버 발급 QA 토큰의 현재 차단 상태. 합성 수신자가 아니면 거부한다. */
export async function qaOptoutStatusAction(token: string): Promise<{ ok: boolean; blocked?: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const r = await recipientByToken(token).catch(() => null);
  if (!r || r.kind !== "qa" || !r.email.endsWith(QA_DOMAIN)) return { ok: false, error: "QA 수신자만 조회할 수 있습니다." };
  const g = await adGate({ email: r.email });
  if (g.error) return { ok: false, error: g.error };
  return { ok: true, blocked: !g.emailAllowed };
}

/** 서버 발급 QA 토큰으로 확정(모의). 합성 수신자가 아니면 거부한다. */
export async function qaOptoutConfirmAction(token: string): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  const r = await recipientByToken(token).catch(() => null);
  if (!r || r.kind !== "qa" || !r.email.endsWith(QA_DOMAIN)) return { ok: false, error: "QA 수신자만 확정할 수 있습니다." };
  const out = await confirmOptOut(token, { source: "qa" });
  return { ok: out.ok, already: out.already, error: out.error };
}
