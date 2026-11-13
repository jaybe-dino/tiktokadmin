// 온보딩 서류 사전 검수 실행부(BUG-60).
//   ① 기계 검사 — 외부 호출 없이 항상 돈다(형식·해상도·빈 파일).
//   ② AI 검사 — 키가 있을 때만, 서류를 보고 "이대로면 반려" 인지 판정한다.
//
// 개인정보: 모델에는 이미지와 "무엇이 보여야 하는가" 만 보내고, 받는 것은 판정과
//   정해진 사유 코드뿐이다. 이름·번호·주소 같은 값은 요청하지도 저장하지도 않는다.
//   여권·거주지 증명처럼 신분 정보가 담긴 칸은 ONB_AI_ID_DOCS=1 일 때만 AI 로 보낸다
//   (기본값은 보내지 않는다 — 기계 검사만 한다).
import { aiEnabled, aiClient, AI_MODEL } from "./ai";
import { checkMinPixels } from "./image-dims";
import { query, queryOne } from "./db";
import {
  type DocCheck, type DocVerdict, ruleFor, cleanReasons, cleanVerdict, REASON_CODES,
} from "./onb-doc-rules";

/** 비어 있다고 볼 만한 크기 — 이보다 작으면 내용이 없는 파일이다. */
const MIN_BYTES = 3 * 1024;
/** 모델에 보낼 수 있는 이미지 한도(Anthropic 권장) — 넘으면 AI 검사를 건너뛴다. */
const AI_MAX_BYTES = 5 * 1024 * 1024;
const AI_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function idDocsAllowed(): boolean {
  return String(process.env.ONB_AI_ID_DOCS ?? "").trim() === "1";
}

const SYSTEM = [
  "너는 입점 서류 접수 담당이다. 받은 이미지가 요청한 서류로 그대로 접수 가능한지만 판단한다.",
  "반드시 JSON 한 개만 출력한다: {\"verdict\":\"pass|warn|reject\",\"reasons\":[\"코드\"]}",
  "verdict 는 pass(그대로 접수), warn(접수하되 담당자 확인 필요), reject(이대로면 반려) 중 하나다.",
  `reasons 는 다음 코드만 쓴다: ${REASON_CODES.join(", ")}. 해당 없으면 빈 배열.`,
  "이름·번호·주소·생년월일 등 서류에 적힌 값은 절대 출력하지 않는다. 설명 문장도 쓰지 않는다.",
  "판단이 어려우면 reject 가 아니라 warn 과 not_checked 를 쓴다.",
].join("\n");

/** 기계 검사 — 외부 호출 없음. */
export function mechanicalCheck(input: {
  field: string; mime: string; size: number; bytes: Uint8Array;
}): { verdict: DocVerdict; reasons: string[] } {
  const rule = ruleFor(input.field);
  const reasons: string[] = [];
  if (input.size < MIN_BYTES) reasons.push("too_small_bytes");
  if (rule?.minPx) {
    const dim = checkMinPixels(input.bytes, rule.minPx);
    if (!dim.ok) reasons.push("too_small_pixels");
  }
  return { verdict: reasons.length ? "reject" : "pass", reasons };
}

/** 이 칸을 AI 로 볼 수 있는가(이유까지 돌려준다 — 조용히 건너뛰지 않기 위해). */
export function aiCheckable(field: string, mime: string, size: number): { ok: boolean; why?: string } {
  const rule = ruleFor(field);
  if (!rule) return { ok: false, why: "검수 규칙이 없는 칸" };
  if (!aiEnabled()) return { ok: false, why: "AI 키 미설정" };
  if (rule.identity && !idDocsAllowed()) return { ok: false, why: "신분 서류 — ONB_AI_ID_DOCS 미설정" };
  if (!AI_MIME.has(mime)) return { ok: false, why: "이미지가 아님(PDF 등)" };
  if (size > AI_MAX_BYTES) return { ok: false, why: "AI 검사 한도 초과" };
  return { ok: true };
}

/**
 * 서류 한 건 검수. 기계 검사에서 이미 반려면 AI 를 부르지 않는다(돈·시간 낭비).
 * AI 호출이 실패하면 실패를 삼키지 않고 warn + not_checked 로 남긴다 — 통과로 바꾸지 않는다.
 */
export async function checkDocument(input: {
  field: string; mime: string; size: number; bytes: Buffer;
}): Promise<DocCheck> {
  const mech = mechanicalCheck(input);
  if (mech.verdict === "reject") return { ...mech, aiUsed: false };

  const can = aiCheckable(input.field, input.mime, input.size);
  if (!can.ok) return { verdict: "pass", reasons: [], aiUsed: false };

  const rule = ruleFor(input.field)!;
  try {
    const resp = await aiClient().messages.create({
      model: AI_MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: input.mime as "image/jpeg", data: input.bytes.toString("base64") },
          },
          { type: "text", text: `요청한 서류: ${rule.label}\n보여야 하는 것: ${rule.expect}` },
        ],
      }],
    });
    const text = resp.content.filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text).join("").trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("JSON 응답 아님");
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const verdict = cleanVerdict(parsed.verdict);
    if (!verdict) throw new Error("verdict 값 없음");
    const reasons = cleanReasons(parsed.reasons);
    // 사유 없이 reject 라고만 하면 사람이 고칠 수가 없다 — 확인 필요로 낮춘다.
    if (verdict === "reject" && reasons.length === 0) {
      return { verdict: "warn", reasons: ["not_checked"], aiUsed: true };
    }
    return { verdict, reasons, aiUsed: true };
  } catch (e) {
    console.error("[onb-doc-check] 실패:", (e as Error).message);
    return { verdict: "warn", reasons: ["not_checked"], aiUsed: true };
  }
}

/** 검수 결과 저장. 표가 없으면(마이그레이션 미적용) 조용히 넘어간다 — 업로드를 막지 않는다. */
export async function saveDocCheck(fileId: string, applicationId: string, field: string, c: DocCheck): Promise<void> {
  await query(
    `INSERT INTO onb_doc_checks (file_id, application_id, field, verdict, reasons, ai_used)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (file_id) DO UPDATE
       SET verdict=EXCLUDED.verdict, reasons=EXCLUDED.reasons,
           ai_used=EXCLUDED.ai_used, checked_at=now()`,
    [fileId, applicationId, field, c.verdict, JSON.stringify(c.reasons), c.aiUsed],
  ).catch((e) => console.error("[onb-doc-check] 저장 실패:", (e as Error).message));
}

export interface StoredCheck { file_id: string; field: string; verdict: DocVerdict; reasons: string[]; ai_used: boolean; checked_at: string }

/** 신청서 한 건의 검수 결과 전부(관리자 화면용). 표가 없으면 빈 배열. */
export async function listDocChecks(applicationId: string): Promise<StoredCheck[]> {
  const rows = await query<{ file_id: string; field: string; verdict: string; reasons: unknown; ai_used: boolean; checked_at: string }>(
    `SELECT file_id::text AS file_id, field, verdict, reasons, ai_used, checked_at::text AS checked_at
       FROM onb_doc_checks WHERE application_id=$1 ORDER BY checked_at DESC`,
    [applicationId],
  ).catch(() => []);
  return rows.map((r) => ({
    file_id: r.file_id,
    field: r.field,
    verdict: (cleanVerdict(r.verdict) ?? "warn"),
    reasons: cleanReasons(r.reasons),
    ai_used: Boolean(r.ai_used),
    checked_at: r.checked_at,
  }));
}

/** 파일 한 건의 최신 검수 결과. */
export async function getDocCheck(fileId: string): Promise<StoredCheck | null> {
  const r = await queryOne<{ file_id: string; field: string; verdict: string; reasons: unknown; ai_used: boolean; checked_at: string }>(
    `SELECT file_id::text AS file_id, field, verdict, reasons, ai_used, checked_at::text AS checked_at
       FROM onb_doc_checks WHERE file_id=$1`,
    [fileId],
  ).catch(() => null);
  if (!r) return null;
  return {
    file_id: r.file_id, field: r.field,
    verdict: cleanVerdict(r.verdict) ?? "warn",
    reasons: cleanReasons(r.reasons),
    ai_used: Boolean(r.ai_used),
    checked_at: r.checked_at,
  };
}
