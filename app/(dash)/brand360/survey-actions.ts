"use server";

// 브랜드360 · 1:1 사전 설문 서버액션 (기획확정 8절).
// "사전 설문 보내기" — 공개 링크 생성 + 이메일 발송 준비.
// 발송은 직접 하지 않고 초안함(email_drafts) 경유 — 승인·발송은 기존 approveAndSend(canSend 게이트).
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { createSurvey } from "@/lib/repo/card";
import { env } from "@/lib/env";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreSurveySendResult {
  ok: boolean;
  error?: string;
  url?: string;        // 공개 응답 링크(/s/{token})
  draftId?: string;    // 초안함 초안 id
  reusedDraft?: boolean; // 동일 링크 초안이 이미 있어 재사용됨
}

/**
 * 사전 설문 보내기:
 *  1) 미응답 pre_meeting 설문이 있으면 토큰 재사용, 없으면 생성(surveys.answers jsonb — 스키마 변경 없음)
 *  2) 요청 메일을 초안함에 생성(kind='doc_request': 회사정보·서류 요청 성격의 거래성 — canSend 통과)
 *  3) 실제 발송·contact_logged 기록은 초안함 승인 시 기존 경로가 수행
 */
export async function sendPreSurveyAction(brandId: string): Promise<PreSurveySendResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };

  const brand = await queryOne<{ brand_name: string; email: string | null }>(
    "SELECT brand_name, email FROM brands WHERE id=$1", [brandId]).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 1) 설문 토큰 — 미응답 사전 설문 재사용(중복 생성 방지)
  const existing = await queryOne<{ token: string }>(
    `SELECT token FROM surveys
      WHERE brand_id=$1 AND kind='pre_meeting' AND responded_at IS NULL
      ORDER BY created_at DESC LIMIT 1`, [brandId]).catch(() => null);
  const token = existing?.token ?? await createSurvey(brandId, "pre_meeting");
  const url = `${env.adminUrl}/s/${token}`;

  // 2) 수신자 — brands.email → 대표 연락처 폴백(없으면 초안함에서 수기 입력)
  let to = (brand.email ?? "").trim();
  if (!to) {
    const c = await queryOne<{ email: string | null }>(
      "SELECT email FROM brand_contacts WHERE brand_id=$1 AND is_primary AND email IS NOT NULL LIMIT 1",
      [brandId]).catch(() => null);
    to = (c?.email ?? "").trim();
  }

  // 3) 초안함 — 동일 링크의 대기 초안이 있으면 재사용(중복 초안 방지)
  const dup = await queryOne<{ id: string }>(
    "SELECT id FROM email_drafts WHERE brand_id=$1 AND status='draft' AND body_md LIKE '%'||$2||'%' LIMIT 1",
    [brandId, token]).catch(() => null);
  if (dup) {
    revalidatePath(`/brand/${brandId}`);
    return { ok: true, url, draftId: dup.id, reusedDraft: true };
  }

  const subject = `[GloveK] ${brand.brand_name} 1:1 미팅 사전 설문 요청`;
  const bodyMd = `${brand.brand_name} 담당자님, 안녕하세요. GloveK입니다.

예정된 1:1 미팅을 더 알차게 준비하기 위해 사전 설문을 부탁드립니다. (약 2분)
- 마케팅 목표 · 기존 채널 · 월 광고 예산 · 콘텐츠 보유 현황
- 회사 기본정보: 사업자등록번호 · 회사명 · 주소 · 담당자 연락처

▶ 사전 설문 링크: ${url}

응답해 주신 내용은 미팅 준비와 맞춤 제안에만 활용됩니다. 감사합니다.
GloveK 드림`;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status)
     VALUES ($1,'doc_request',$2,$3,$4,'draft') RETURNING id`,
    [brandId, to, subject, bodyMd]).catch(() => null);
  if (!row) return { ok: false, error: "메일 초안 생성 실패" };

  revalidatePath(`/brand/${brandId}`);
  return { ok: true, url, draftId: row.id };
}
