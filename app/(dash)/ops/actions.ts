"use server";

// 운영 사이클 화면 전용 서버액션.
// (@/app/actions.ts 는 수정 금지 규칙에 따라 이 화면 전용 파일로 분리)
import { query } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { aiText, aiEnabled } from "@/lib/ai";
import { opsDashboard, monthFirst } from "@/lib/operations";

export interface MonthlyReportResult {
  ok: boolean;
  error?: string;
  draft?: string;
  month?: string;
}

/**
 * 월간 성과 리포트 AI 초안 — 이번 달 운영 사이클 지표(opsDashboard 실데이터)를
 * 요약해 복사/저장용 월간 리포트 초안을 생성한다.
 *   · 브랜드수·평균 이행률·워크아이템(시딩/라이브/리포트) 이행 현황을 맥락으로 사용.
 *   · 판정(등급·게이트·정산 금액)은 하지 않고 요약·성과 문구·제안만 작성.
 *   · 개인정보(카드·신분증·비밀번호)는 프롬프트/출력 금지. 브랜드명 외 민감정보 없음.
 */
export async function generateMonthlyReportAction(input?: {
  month?: string;
}): Promise<MonthlyReportResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  const month = (input?.month || monthFirst()).slice(0, 10);

  // 실데이터 — 화면과 동일한 opsDashboard 집계.
  const rows = await opsDashboard(month).catch(() => []);
  if (rows.length === 0) {
    return { ok: false, error: "이번 달 사이클 데이터가 없습니다.", month };
  }

  // 워크아이템 종류별(시딩/라이브/리포트) 이행 현황 — 존재 테이블/컬럼만 사용.
  const kinds = await query<{ kind: string; target: number; done: number }>(
    `SELECT wi.kind,
            COALESCE(sum(wi.qty_target),0)::int target,
            COALESCE(sum(wi.qty_done),0)::int done
       FROM ops_cycles c JOIN work_items wi ON wi.cycle_id=c.id
      WHERE c.month=$1
      GROUP BY wi.kind
      ORDER BY wi.kind`,
    [month],
  ).catch(() => [] as { kind: string; target: number; done: number }[]);

  // 파생 집계(하드코딩 금지 — 실데이터에서 계산).
  const active = rows.filter((r) => r.status === "active").length;
  const closed = rows.filter((r) => r.status === "closed").length;
  const paused = rows.filter((r) => r.status === "paused").length;
  const avgRate = Math.round(rows.reduce((s, r) => s + r.rate, 0) / rows.length);
  const behind = rows.filter((r) => r.rate < 50);
  const top = [...rows].sort((a, b) => b.rate - a.rate).slice(0, 5);

  const KIND_LABELS: Record<string, string> = {
    seeding: "시딩",
    live: "라이브",
    report: "리포트",
  };
  const kindLines = kinds
    .map((k) => `- ${KIND_LABELS[k.kind] ?? k.kind}: ${k.done}/${k.target} 이행`)
    .join("\n");
  const topLines = top
    .map((r) => `- ${r.brand_name}: 이행률 ${r.rate}% (${r.items_done}/${r.items_total})`)
    .join("\n");
  const behindLines = behind.length
    ? behind.map((r) => `- ${r.brand_name}: ${r.rate}%`).join("\n")
    : "- 없음";

  const system = `너는 GloveK(틱톡샵 해외진출 운영대행사)의 운영 매니저다. 아래 이번 달 운영 사이클 지표를 바탕으로 경영진·팀 공유용 한국어 "월간 성과 리포트 초안"을 작성한다.
규칙:
- 제공된 수치만 사용하고 없는 데이터를 지어내지 않는다.
- 등급 판정·발송 게이트·정산 금액 산정 같은 판정은 하지 말고, 요약·성과 해석·다음 달 제안만 작성한다.
- 개인정보(카드번호·신분증·비밀번호)는 절대 포함하지 않는다.
- 구성: 1) 한 줄 요약 2) 핵심 지표 3) 잘된 점 4) 점검 필요 5) 다음 달 제안. 간결하고 실무적으로.`;

  const user = `대상 월: ${month.slice(0, 7)}

전체 지표:
- 운영 사이클(브랜드): ${rows.length}개 (진행중 ${active} · 마감 ${closed} · 일시중지 ${paused})
- 평균 이행률: ${avgRate}%
- 이행 지연(<50%) 브랜드: ${behind.length}개

워크아이템 종류별 이행:
${kindLines || "- 데이터 없음"}

이행률 상위 브랜드:
${topLines}

점검 필요 브랜드(<50%):
${behindLines}

위 지표로 월간 성과 리포트 초안을 작성해줘.`;

  const draft = await aiText({ system, user, maxTokens: 1200 }).catch(() => null);
  if (!draft) return { ok: false, error: "AI 초안 생성 실패 (잠시 후 재시도)", month };
  return { ok: true, draft: draft.trim(), month };
}
