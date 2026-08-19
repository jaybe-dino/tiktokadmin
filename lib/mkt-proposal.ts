// 마케팅 제안서 고도화 — 사전 RFP(설문 요약) · 우리 서비스 소개(설정) · AI 제안 방향.
import { query, queryOne } from "./db";
import { aiEnabled, aiText } from "./ai";

// ── 우리 서비스 소개(AI 참고 컨텍스트) — 설정에서 계속 업데이트 ──
export async function getMktServices(): Promise<string> {
  const r = await queryOne<{ services_md: string }>("SELECT services_md FROM mkt_services_config WHERE id=1").catch(() => null);
  return r?.services_md ?? "";
}
export async function saveMktServices(md: string): Promise<void> {
  await query(
    `INSERT INTO mkt_services_config (id, services_md) VALUES (1,$1)
     ON CONFLICT (id) DO UPDATE SET services_md=EXCLUDED.services_md, updated_at=now()`,
    [md]).catch(() => {});
}

// ── 브랜드 설문 → 사전 RFP 요약 ────────────────────────────────
const A_LABEL: Record<string, string> = {
  budget_band: "예산대", monthly_budget: "월 예산", target_countries: "목표 국가", timeline: "일정",
  seeding_capacity: "시딩 여력", concerns: "고민/니즈", goal: "목표", channels: "희망 채널",
  category: "카테고리", product: "제품", current_status: "현황", competitor: "경쟁사",
};

/** 브랜드의 최근 응답 설문에서 RFP 초안 텍스트를 구성. 없으면 빈 문자열. */
export async function brandRfpFromSurvey(brandId: string): Promise<{ rfp: string; from: string | null }> {
  const s = await queryOne<{ answers: Record<string, unknown>; kind: string; responded_at: string | null; created_at: string }>(
    `SELECT answers, kind, responded_at, created_at FROM surveys
      WHERE brand_id=$1 AND answers IS NOT NULL AND answers::text <> '{}'
      ORDER BY (responded_at IS NOT NULL) DESC, COALESCE(responded_at, created_at) DESC LIMIT 1`,
    [brandId]).catch(() => null);
  if (!s || !s.answers) return { rfp: "", from: null };
  const lines: string[] = [];
  for (const [k, v] of Object.entries(s.answers)) {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const label = A_LABEL[k] ?? k;
    const val = Array.isArray(v) ? v.join(", ") : String(v);
    lines.push(`- ${label}: ${val}`);
  }
  if (lines.length === 0) return { rfp: "", from: null };
  return { rfp: `[설문 기반 RFP]\n${lines.join("\n")}`, from: s.kind };
}

// ── AI 제안 방향(예산·RFP·우리 서비스 기반) ────────────────────
export interface DirectionInput { brandName: string; category?: string | null; amount?: number | null; rfp?: string | null }

/** 예산·RFP·우리 서비스 소개를 참고해 제안 방향을 AI 로 제안. 키 없으면 규칙기반 골격. */
export async function generateProposalDirection(input: DirectionInput): Promise<string> {
  const services = await getMktServices();
  const budget = input.amount != null ? `${input.amount.toLocaleString("ko-KR")}원` : "미정";
  if (aiEnabled()) {
    const text = await aiText({
      system: "너는 GloveK 마케팅 제안 전략가다. 아래 '우리 서비스', 브랜드 정보, 예산, RFP 를 참고해 " +
        "실행 가능한 제안 방향을 한국어 마크다운으로 제안하라. 구성: ① 핵심 제안 요지 ② 우리 서비스 매칭(RFP·예산 대비) " +
        "③ 추천 실행안 3가지(채널·산출물) ④ 예산 배분 가이드 ⑤ 예상 리스크/확인 필요. 과장 없이 근거 기반, 8~14줄.",
      user: `[우리 서비스]\n${services || "(미설정)"}\n\n[브랜드]\n${input.brandName} · 카테고리 ${input.category || "미상"}\n[예산]\n${budget}\n\n[RFP]\n${input.rfp || "(없음 — 일반 제안)"}`,
      maxTokens: 1100,
    }).catch(() => null);
    if (text) return text;
  }
  // 폴백(규칙기반 골격)
  return [
    `## 제안 방향 초안 — ${input.brandName}`,
    `- 예산: ${budget}`,
    input.rfp ? `- RFP 요지: ${input.rfp.replace(/\n/g, " ").slice(0, 200)}` : "- RFP: 미확보(설문/업로드 권장)",
    "",
    "### 추천 실행안",
    "1. 크리에이터 시딩 + 라이브 커머스로 초기 인지·전환",
    "2. 틱톡·메타 퍼포먼스 광고로 확장",
    "3. 숏폼 콘텐츠·상세페이지 현지화",
    "",
    "※ AI 키(ANTHROPIC) 설정 시 예산·RFP 맞춤 제안이 자동 생성됩니다.",
  ].join("\n");
}
