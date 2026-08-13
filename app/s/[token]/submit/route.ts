import { NextRequest, NextResponse } from "next/server";
import { getSurveyByToken, submitSurveyResponse } from "@/lib/repo/card";
import { query } from "@/lib/db";
import { questionsForKind, missingRequired } from "@/lib/survey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 공개 설문 응답 수신 — 토큰이 곧 자격(인증 불필요).
// 저장은 기존 게이트(submitSurveyResponse: 재제출 방지·목표국 병합·수신동의 전파) 경유.
// 사전 설문(kind='pre_meeting')이면 추가로:
//   · 회사정보(사업자번호·회사명·주소)를 brands/brand_company 에 반영 — 빈 값만 채움(기존 값 덮지 않음)
//   · 타임라인 기록: brand_sources contact_logged(channel='survey') + last_contact_at
// glovek 원본 테이블은 건드리지 않음(brands·brand_company 는 어드민 원장).

const digitsOf = (v: unknown): string => (typeof v === "string" ? v.replace(/\D/g, "") : "");
const strOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token: raw } = await ctx.params;
  const token = raw.trim();

  let body: { answers?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const answers = body.answers ?? {};
  if (typeof answers !== "object" || Array.isArray(answers)) {
    return NextResponse.json({ error: "answers 형식 오류" }, { status: 400 });
  }

  try {
    const survey = await getSurveyByToken(token);
    if (!survey) return NextResponse.json({ error: "설문을 찾을 수 없습니다" }, { status: 404 });

    // 필수 항목 검증 — 미입력 제출 차단(클라이언트 우회 방지). kind 별 문항 세트 기준.
    const missing = missingRequired(questionsForKind(survey.kind), answers as Record<string, unknown>);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `필수 항목이 비어 있습니다: ${missing.map((q) => q.label.replace(/\(.*\)$/, "")).join(", ")}` },
        { status: 400 },
      );
    }

    const ok = await submitSurveyResponse(token, answers);
    if (!ok) return NextResponse.json({ error: "설문을 찾을 수 없습니다" }, { status: 404 });

    // ── 사전 설문 회사정보 반영 (빈 값만 채움 — 어드민 보정값·기존 값 우선) ──
    if (survey.kind === "pre_meeting") {
      const bizNo = digitsOf(answers.biz_reg_no);
      if (bizNo) {
        // brands.biz_no 는 UNIQUE — 비어 있을 때만 채우고, 중복 충돌은 무시(수기 확인).
        await query(
          "UPDATE brands SET biz_no=$2 WHERE id=$1 AND (biz_no IS NULL OR biz_no='')",
          [survey.brand_id, bizNo],
        ).catch((e) => console.error("[survey] 사업자번호 반영 실패(중복 가능)", e));
      }
      const name = strOf(answers.company_name);
      const addr = strOf(answers.company_address);
      if (name || addr) {
        await query(
          `INSERT INTO brand_company (brand_id, company_name_kr, address_kr, source)
           VALUES ($1, NULLIF($2,''), NULLIF($3,''), 'manual')
           ON CONFLICT (brand_id) DO UPDATE SET
             company_name_kr = COALESCE(NULLIF(brand_company.company_name_kr,''), EXCLUDED.company_name_kr, brand_company.company_name_kr),
             address_kr      = COALESCE(NULLIF(brand_company.address_kr,''),      EXCLUDED.address_kr,      brand_company.address_kr),
             updated_at = now()`,
          [survey.brand_id, name, addr],
        ).catch((e) => console.error("[survey] 회사정보 반영 실패", e));
      }
    }

    // ── 타임라인: 응답 완료 기록 (source_ref 로 멱등, channel='survey' — 미팅 게이트와 무관) ──
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
       VALUES ($1,'manual','contact_logged',$2,$3,now())
       ON CONFLICT (site, event, source_ref) DO NOTHING`,
      [survey.brand_id, `survey:${survey.id}`,
       JSON.stringify({ channel: "survey", kind: survey.kind,
         note: survey.kind === "pre_meeting" ? "1:1 사전 설문 응답 수신" : "미팅 후 설문 응답 수신" })],
    ).catch((e) => console.error("[survey] 타임라인 기록 실패", e));
    await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [survey.brand_id])
      .catch(() => {});

    // ── AI 인사이트: 응답을 구조화 추출해 브랜드 원장에 반영(빈 값만). 키 없으면 스킵, 실패해도 제출 성공 유지. ──
    try {
      const { extractAndApplyInsight } = await import("@/app/(dash)/brand360/survey-actions");
      await extractAndApplyInsight(survey.id, "survey:auto");
    } catch (e) {
      console.error("[survey] AI 인사이트 추출 실패(제출은 정상):", (e as Error).message);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
