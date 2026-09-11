// 브랜드사 제출 알림 — 설문(사전·콘텐츠 브리프 등)·온보딩 신청서 단계·제품 등록이
//   들어오면 Slack 에 즉시 알린다. 담당자가 어드민을 계속 들여다보지 않아도 회수 사실을 안다.
//   채널: SLACK_CH_FORMS(없으면 onboard→leads→intake 로 폴백) — 설정 없이도 동작.
//   설계 원칙: 알림 실패가 제출 자체를 막지 않는다(전부 catch, 호출부는 await 하지 않아도 됨).
import { queryOne } from "./db";
import { env } from "./env";
import { slackPost, type Block } from "./slack";

const adminUrl = () => env.adminUrl.replace(/\/+$/, "");

/** 사람이 읽는 설문 종류 라벨. */
function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "pre_meeting": return "사전 설문";
    case "content_brief": return "콘텐츠 브리프";
    case "marketing": return "마케팅 설문";
    default: return kind ? `설문(${kind})` : "설문";
  }
}

function post(text: string, blocks: Block[]): void {
  // 의도적으로 await 하지 않음 — 고객 화면 응답을 알림 때문에 늦추지 않는다.
  void slackPost({ channelKey: "forms", text, blocks }).catch((e) => {
    console.error("[submit-notify]", e instanceof Error ? e.message : String(e));
  });
}

const section = (md: string): Block => ({ type: "section", text: { type: "mrkdwn", text: md } });
const context = (md: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text: md }] });

/** 설문 응답 제출 — 모든 종류(사전·콘텐츠 브리프·마케팅) 공용. */
export async function notifySurveySubmitted(token: string): Promise<void> {
  const s = await queryOne<{
    id: string; kind: string | null; brand_id: string; brand_name: string | null;
    answers: Record<string, unknown> | null;
  }>(
    `SELECT s.id, s.kind, s.brand_id, b.brand_name, s.answers
       FROM surveys s LEFT JOIN brands b ON b.id = s.brand_id
      WHERE s.token = $1`,
    [token],
  ).catch(() => null);
  if (!s) return;

  const a = s.answers ?? {};
  // 발급 시 심어둔 메타(product_label)는 응답 수에서 제외해 "실제 답변 수"만 센다.
  const answered = Object.entries(a).filter(([k, v]) =>
    k !== "product_label" && v != null && String(v).trim() !== "").length;
  const product = String(a.product_name_kr ?? a.product_label ?? "").trim();
  const brand = s.brand_name || "(브랜드 미연결)";
  const label = kindLabel(s.kind);
  const text = `📝 ${brand} — ${label} 응답 도착`;

  post(text, [
    section(`*📝 ${label} 응답 도착*\n*${brand}*${product ? ` · ${product}` : ""}`),
    context(`응답 ${answered}문항 · <${adminUrl()}/brand/${s.brand_id}?b360=sv|브랜드 360에서 응답 보기 ↗>`),
  ]);
}

/** 온보딩 신청서 단계 제출. */
export async function notifyOnbStepSubmitted(applicationId: string, stepNo: number): Promise<void> {
  const r = await queryOne<{ brand_id: string | null; brand_name: string | null; email: string | null }>(
    `SELECT a.brand_id, b.brand_name, c.email
       FROM onb_applications a
       LEFT JOIN brands b ON b.id = a.brand_id
       LEFT JOIN onb_customers c ON c.id = a.customer_id
      WHERE a.id = $1`,
    [applicationId],
  ).catch(() => null);

  const who = r?.brand_name || r?.email || "(브랜드 확인 필요)";
  const link = r?.brand_id ? `${adminUrl()}/brand/${r.brand_id}` : `${adminUrl()}/onboarding`;
  const text = `📋 ${who} — 온보딩 신청서 ${stepNo}단계 제출`;

  post(text, [
    section(`*📋 온보딩 신청서 제출*\n*${who}* · ${stepNo}단계`),
    context(`검토 대기 · <${link}|어드민에서 열기 ↗>`),
  ]);
}

/** 브랜드사 제품 등록(온보딩 포털). */
export async function notifyOnbProductSubmitted(applicationId: string, productName: string): Promise<void> {
  const r = await queryOne<{ brand_id: string | null; brand_name: string | null; email: string | null }>(
    `SELECT a.brand_id, b.brand_name, c.email
       FROM onb_applications a
       LEFT JOIN brands b ON b.id = a.brand_id
       LEFT JOIN onb_customers c ON c.id = a.customer_id
      WHERE a.id = $1`,
    [applicationId],
  ).catch(() => null);

  const who = r?.brand_name || r?.email || "(브랜드 확인 필요)";
  const name = (productName || "").trim() || "(제품명 미입력)";
  const link = r?.brand_id ? `${adminUrl()}/brand/${r.brand_id}` : `${adminUrl()}/products`;
  const text = `📦 ${who} — 제품 등록: ${name}`;

  post(text, [
    section(`*📦 제품 등록*\n*${who}* · ${name}`),
    context(`승인 대기 · <${link}|어드민에서 열기 ↗>`),
  ]);
}
