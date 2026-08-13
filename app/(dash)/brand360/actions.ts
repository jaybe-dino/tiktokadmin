"use server";

// 브랜드360 화면 전용 서버액션.
// (@/app/actions.ts 는 수정 금지 규칙에 따라 이 화면 전용 파일로 분리)
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { aiText, aiEnabled } from "@/lib/ai";
import { STATE_LABELS, type State } from "@/lib/types";
import { generateEmailPreview } from "@/lib/email-compose";

// ── 미팅 상태 수동 변경(노쇼 오기 정정 등) ──
const MEETING_STATUS_SET = ["held", "no_show", "canceled", "scheduled", "ready"];
export async function setMeetingStatusAction(meetingId: string, status: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return { ok: false, error: "잘못된 미팅" };
  if (!MEETING_STATUS_SET.includes(status)) return { ok: false, error: "잘못된 상태값" };
  const row = await queryOne<{ brand_id: string | null }>(
    "UPDATE meetings SET status=$2 WHERE id=$1 RETURNING brand_id", [meetingId, status],
  ).catch(() => null);
  if (!row) return { ok: false, error: "미팅을 찾을 수 없습니다." };
  if (row.brand_id) revalidatePath(`/brand/${row.brand_id}`);
  return { ok: true };
}

// ── 메일 작성 — AI 미리보기(저장 안 함) ──
export async function previewComposeAction(
  brandId: string, intent?: string,
): Promise<{ ok: boolean; subject?: string; body?: string; toEmail?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) return { ok: false, error: "잘못된 브랜드" };
  try {
    return await generateEmailPreview(brandId, (intent ?? "").trim() || undefined);
  } catch (e) {
    return { ok: false, error: (e as Error).message || "AI 생성 실패" };
  }
}

// ── 메일 작성 — 수동 초안 저장(초안함으로) ──
export async function createManualDraftAction(
  brandId: string, to: string, subject: string, body: string,
): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) return { ok: false, error: "잘못된 브랜드" };
  const s = (subject ?? "").trim();
  const b = (body ?? "").trim();
  if (!b) return { ok: false, error: "본문을 입력하세요." };
  // 받는사람 미입력 시 브랜드 원장 이메일로 기본.
  let toEmail = (to ?? "").trim();
  if (!toEmail) {
    const br = await queryOne<{ email: string | null }>("SELECT email FROM brands WHERE id=$1", [brandId]).catch(() => null);
    toEmail = (br?.email ?? "").trim();
  }
  await query(
    `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status)
     VALUES ($1,'manual',$2,$3,$4,'draft')`,
    [brandId, toEmail, s || "(제목 없음)", b],
  );
  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/drafts");
  return { ok: true };
}

// ── 회의록(직접 입력) — 텍스트 + 파일(DB 저장). 브랜드360 회의록 탭 ──
export async function addMeetingNoteAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const brandId = String(formData.get("brand_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) return { ok: false, error: "잘못된 브랜드" };
  const noteDate = String(formData.get("note_date") ?? "").trim() || null;
  let title = String(formData.get("title") ?? "").trim();
  let body = String(formData.get("body") ?? "").trim();
  const fileUrl = String(formData.get("file_url") ?? "").trim();
  const wantTranscribe = String(formData.get("transcribe") ?? "") === "on";
  const file = formData.get("file");

  let fileName: string | null = null, fileMime: string | null = null, fileBytes: Buffer | null = null;
  let isAudio = false;
  if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
    const f = file as File;
    fileName = f.name; fileMime = f.type || "application/octet-stream";
    const { isAudioFile } = await import("@/lib/stt");
    isAudio = isAudioFile(fileName, fileMime);
    // 녹음(전사 대상)은 25MB(Whisper 한도), 그 외 첨부는 15MB.
    const cap = isAudio && wantTranscribe ? 25 : 15;
    if (f.size > cap * 1024 * 1024) return { ok: false, error: `파일은 ${cap}MB 이하만 가능합니다.` };
    fileBytes = Buffer.from(await f.arrayBuffer());
  }
  if (!body && !fileBytes && !fileUrl) return { ok: false, error: "회의록 내용(텍스트) 또는 파일이 필요합니다." };

  // 녹음 파일 자동 전사·요약 — 한국어 전사(Whisper) 후 AI 회의록 요약.
  let transcript = "";
  let note = "";
  if (fileBytes && isAudio && wantTranscribe) {
    const { transcribeAudioBuffer, sttEnabled } = await import("@/lib/stt");
    if (!sttEnabled()) {
      note = "전사 미설정(OPENAI/GROQ 키 없음) — 녹음 파일만 저장했습니다.";
    } else {
      transcript = (await transcribeAudioBuffer(fileBytes, fileName ?? "recording.m4a", fileMime ?? "audio/m4a")) ?? "";
      if (!transcript) {
        note = "전사 실패(파일 형식/크기 확인) — 녹음 파일만 저장했습니다.";
      } else {
        // AI 회의록 요약(키 있으면).
        let summary = "";
        if (aiEnabled()) {
          summary = (await aiText({
            system: "너는 GloveK 영업/온보딩 미팅 서기다. 아래 한국어 녹취를 회의록으로 정리하라. 마크다운으로 " +
              "① 핵심 논의 요약(3~5줄) ② 결정 사항 ③ 액션 아이템(담당/기한 추정 포함) ④ 후속 확인 필요 항목. 과장 없이 사실 기반.",
            user: `미팅 녹취:\n${transcript.slice(0, 12000)}`,
            maxTokens: 1200,
          }).catch(() => null)) ?? "";
        }
        // 본문 = (사용자 입력) + 요약(있으면) + 전사 원문. 요약 없으면 전사 원문이 본문 역할.
        const parts = [body];
        if (summary) parts.push(summary);
        parts.push(`---\n[전사 원문]\n${transcript.slice(0, 20000)}`);
        body = parts.filter(Boolean).join("\n\n");
        if (!title) title = "녹음 회의록";
      }
    }
  }

  const { addMeetingNote } = await import("@/lib/meeting-notes");
  const id = await addMeetingNote({
    brand_id: brandId, note_date: noteDate, title,
    body: [body, note].filter(Boolean).join("\n\n"),
    file_url: fileUrl || null, file_name: fileName, file_mime: fileMime, file_bytes: fileBytes,
    created_by: u.id,
  });
  if (!id) return { ok: false, error: "저장 실패(마이그레이션 0056 확인)" };
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function deleteMeetingNoteAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const { deleteMeetingNote } = await import("@/lib/meeting-notes");
  const brandId = await deleteMeetingNote(id);
  if (brandId) revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

// ── 타임라인 직접 입력(4-3) — brand_sources(event='note')로 기록, 타임라인에 내용 표시 ──
export async function addTimelineEntryAction(brandId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const t = (text ?? "").trim();
  if (!t) return { ok: false, error: "내용을 입력하세요." };
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) return { ok: false, error: "잘못된 브랜드" };
  try {
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'admin','note',$2,now())`,
      [brandId, JSON.stringify({ text: t, by: u.id })],
    );
  } catch (e) {
    // brand_sources.site CHECK(0067 미적용) 위반 등 — 서버 크래시 대신 명확한 메시지.
    const msg = (e as Error).message ?? "";
    if (/brand_sources_site_check|check constraint/i.test(msg)) {
      return { ok: false, error: "타임라인 저장 제약 오류 — 마이그레이션(0067) 적용이 필요합니다(관리자)." };
    }
    return { ok: false, error: "타임라인 기록에 실패했습니다. 잠시 후 다시 시도하세요." };
  }
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

// ── ④ 틱톡샵 계정 저장 + 개설 안내 발송(운영·정산) ──
export async function saveTiktokAccountAction(brandId: string, input: {
  tiktok_shop_url?: string; tiktok_seller_id?: string; tiktok_seller_pw?: string;
  markOpened?: boolean; sendNotify?: boolean;
}): Promise<{ ok: boolean; error?: string; sent?: string[] }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const sets: string[] = ["tiktok_shop_url=$2", "tiktok_seller_id=$3", "tiktok_seller_pw=$4", "updated_at=now()"];
  const params: unknown[] = [brandId, (input.tiktok_shop_url ?? "").trim(), (input.tiktok_seller_id ?? "").trim(), (input.tiktok_seller_pw ?? "").trim()];
  if (input.markOpened) sets.push("tiktok_opened_at=COALESCE(tiktok_opened_at, now())");
  await query(`UPDATE brands SET ${sets.join(", ")} WHERE id=$1`, params).catch(() => {});

  let sent: string[] | undefined;
  if (input.sendNotify) {
    const b = await queryOne<{ brand_name: string; contact_name: string | null; email: string | null; phone: string | null; tiktok_shop_url: string; tiktok_seller_id: string; tiktok_seller_pw: string }>(
      "SELECT brand_name, contact_name, email, phone, tiktok_shop_url, tiktok_seller_id, tiktok_seller_pw FROM brands WHERE id=$1", [brandId]);
    if (!b) return { ok: false, error: "브랜드를 찾을 수 없습니다." };
    if (!b.tiktok_shop_url || !b.tiktok_seller_id) return { ok: false, error: "셀러센터 링크·ID를 먼저 입력하세요." };
    const name = b.contact_name || b.brand_name;
    const lines = [
      `[GloveK] ${b.brand_name} 틱톡샵 개설 안내`,
      `${name}님, 틱톡샵 셀러 계정이 개설되었습니다.`,
      `• 셀러센터: ${b.tiktok_shop_url}`,
      `• 아이디: ${b.tiktok_seller_id}`,
      `• 비밀번호: ${b.tiktok_seller_pw}`,
      `로그인 후 초기 비밀번호를 변경해 주세요.`,
    ];
    sent = [];
    const { sendSms } = await import("@/lib/sms");
    const { sendEmail } = await import("@/lib/mailer");
    if (b.phone) { const r = await sendSms({ receiver: b.phone, msg: lines.join("\n") }).catch(() => ({ ok: false })); if (r.ok) sent.push("sms"); }
    if (b.email) { const r = await sendEmail({ to: b.email, subject: `[GloveK] ${b.brand_name} 틱톡샵 개설 안내`, text: lines.join("\n") }).catch(() => ({ ok: false })); if (r.ok) sent.push("email"); }
    if (sent.length) {
      await query("UPDATE brands SET tiktok_sent_at=now(), tiktok_opened_at=COALESCE(tiktok_opened_at, now()), last_contact_at=now() WHERE id=$1", [brandId]).catch(() => {});
      await query(`INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at) VALUES ($1,'admin','contact_logged',$2,now())`,
        [brandId, JSON.stringify({ channel: sent.join("+"), kind: "tiktok_account" })]).catch(() => {});
    }
  }
  revalidatePath(`/brand/${brandId}`);
  return { ok: true, sent };
}

export interface NextActionSuggestResult {
  ok: boolean;
  error?: string;
  draft?: string;
}

/**
 * 다음 액션 제안 AI 초안 — 해당 브랜드의 맥락(사전분석 브리프·현재 단계·기존 다음액션·
 * 최근 메일 제목/요약)을 바탕으로 담당자가 취할 "다음 액션"을 한국어로 제안한다.
 *   · 존재 테이블/컬럼(brands, brand_emails)만 사용하고 데이터를 지어내지 않는다.
 *   · 등급 판정·발송 게이트·정산 금액 산정 같은 판정은 하지 말고, 제안·문구·요약만 작성.
 *   · 개인정보(카드번호·신분증·비밀번호)는 프롬프트/출력에 포함하지 않는다.
 */
export async function suggestNextActionsAction(
  brandId: string,
): Promise<NextActionSuggestResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brandId)) {
    return { ok: false, error: "잘못된 브랜드 ID" };
  }

  // 실데이터 — 브랜드 맥락(개인정보 컬럼은 조회하지 않음).
  const brand = await queryOne<{
    brand_name: string;
    category: string;
    state: State;
    next_action: string;
    brief_md: string | null;
    due_date: string | null;
    last_contact_at: string | null;
  }>(
    `SELECT brand_name, category, state, next_action, brief_md, due_date, last_contact_at
       FROM brands WHERE id=$1`,
    [brandId],
  ).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 최근 메일 — 방향·제목·요약만(주소 등 개인정보는 프롬프트에 넣지 않음).
  const emails = await query<{
    direction: string;
    subject: string | null;
    snippet: string | null;
    occurred_at: string;
  }>(
    `SELECT direction, subject, snippet, occurred_at
       FROM brand_emails WHERE brand_id=$1 ORDER BY occurred_at DESC LIMIT 5`,
    [brandId],
  ).catch(() => [] as { direction: string; subject: string | null; snippet: string | null; occurred_at: string }[]);

  const DIR_LABEL: Record<string, string> = { in: "수신", out: "발신", unknown: "-" };
  const mailLines = emails.length
    ? emails
        .map(
          (e) =>
            `- ${e.occurred_at.slice(0, 10)} ${DIR_LABEL[e.direction] ?? e.direction} · ${e.subject || "(제목 없음)"}${e.snippet ? ` — ${e.snippet.slice(0, 120)}` : ""}`,
        )
        .join("\n")
    : "- 기록된 메일 없음";

  const briefText = brand.brief_md
    ? brand.brief_md.slice(0, 1500)
    : "(사전분석 브리프 미생성)";

  const system = `너는 GloveK(틱톡샵 해외진출 운영대행사)의 브랜드 담당 매니저를 돕는 AI 도우미다. 아래 브랜드 맥락을 바탕으로, 담당자가 지금 취하면 좋은 한국어 "다음 액션 제안"을 작성한다.
규칙:
- 제공된 맥락만 사용하고 없는 사실을 지어내지 않는다.
- 등급 판정·발송 게이트 충족 여부·정산 금액 산정 같은 판정은 하지 말고, 실무적인 다음 액션 제안·문구·요약만 작성한다.
- 개인정보(카드번호·신분증·비밀번호)는 절대 포함하지 않는다.
- 형식: 우선순위가 높은 순서로 3~5개의 구체적 액션을 번호 목록으로. 각 항목은 한 줄로 간결하게(무엇을·왜). 마지막에 한 줄 코멘트.`;

  const user = `브랜드: ${brand.brand_name}
카테고리: ${brand.category || "미상"}
현재 단계: ${STATE_LABELS[brand.state] ?? brand.state}
기존 다음 액션: ${brand.next_action || "(없음)"}${brand.due_date ? ` (기한 ${brand.due_date.slice(0, 10)})` : ""}
마지막 접촉: ${brand.last_contact_at ? brand.last_contact_at.slice(0, 10) : "기록 없음"}

사전분석 브리프:
${briefText}

최근 메일:
${mailLines}

위 맥락으로 담당자를 위한 "다음 액션 제안"을 작성해줘.`;

  const draft = await aiText({ system, user, maxTokens: 700 }).catch(() => null);
  if (!draft) return { ok: false, error: "AI 제안 생성 실패 (잠시 후 재시도)" };
  return { ok: true, draft: draft.trim() };
}

// ═══ v3.1 재정합 추가 액션 ═══════════════════════════════════
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 메모·협업 탭 코멘트 등록 — comments 테이블(0006). @멘션은 mentions 배열로 보존. */
export async function addCommentAction(
  brandId: string, body: string,
): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };
  const text = (body ?? "").trim();
  if (!text) return { ok: false, error: "내용을 입력하세요" };
  const mentions = [...text.matchAll(/@([^\s@,]+)/g)].map((m) => m[1]);
  await query(
    "INSERT INTO comments (brand_id, author, body, mentions) VALUES ($1,$2,$3,$4)",
    [brandId, u.name || u.id, text, mentions],
  );
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

/**
 * AI 기업·브랜드 심층 분석(회사정보 탭) — 브랜드·회사·시그널·제품 실데이터만으로
 * 매출/구조/채널/포지셔닝 추정 요약을 생성해 반환한다(저장 테이블 없음 → 화면 표시용).
 * 판단 참고용 문구만 작성하고 등급 판정·게이트 판정은 하지 않는다.
 */
export async function deepAnalysisAction(
  brandId: string,
): Promise<{ ok: boolean; error?: string; md?: string; fetched?: string[] }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };

  const brand = await queryOne<{
    brand_name: string; category: string; brand_url: string; biz_no: string | null;
    countries: string[]; grade: string | null; brief_md: string | null;
  }>(
    `SELECT brand_name, category, brand_url, biz_no, countries, grade, brief_md
       FROM brands WHERE id=$1`, [brandId],
  ).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  const [signals, products] = await Promise.all([
    query<{ source: string; metric: string; value_num: number | null; value_text: string | null; confidence: string }>(
      "SELECT source, metric, value_num, value_text, confidence FROM brand_signals WHERE brand_id=$1 ORDER BY collected_at DESC LIMIT 20",
      [brandId],
    ).catch(() => []),
    query<{ name_kr: string; category: string; price_band: string }>(
      "SELECT name_kr, category, price_band FROM products_master WHERE brand_id=$1 LIMIT 20",
      [brandId],
    ).catch(() => []),
  ]);

  const sigLines = signals.length
    ? signals.map((s) => `- ${s.source} · ${s.metric} = ${s.value_num ?? s.value_text ?? "-"} (신뢰도 ${s.confidence})`).join("\n")
    : "- 수집된 시그널 없음";
  const prodLines = products.length
    ? products.map((p) => `- ${p.name_kr}${p.category ? ` (${p.category})` : ""}${p.price_band ? ` · ${p.price_band}` : ""}`).join("\n")
    : "- 등록 제품 없음";

  // ── 회사 웹사이트 수집(있으면) — 심층 분석 근거 ──────────────
  let site = { ok: false, text: "", fetched: [] as string[] };
  if (brand.brand_url) {
    const { fetchSiteText } = await import("@/lib/site-fetch");
    site = await fetchSiteText(brand.brand_url).catch(() => site);
  }

  // ── 다층 프롬프트 프리셋 — TikTok Shop 해외진출 대행 관점 심층 분석 ──
  const system = `너는 GloveK(TikTok Shop 해외진출 대행사) 운영 어드민의 기업·브랜드 심층 분석가다. 제공된 실데이터 + 회사 웹사이트 발췌만 근거로 한국어 심층 분석을 작성한다.
원칙:
- 근거는 제공된 데이터/웹사이트 텍스트만. 없는 수치·사실은 지어내지 말고 "웹사이트/데이터 근거 없음"으로 표기. 추정은 "추정:"으로 명시하고 근거를 붙인다.
- 등급·게이트·정산금액 확정 판정은 하지 않는다(참고용 분석만).
- 개인정보(대표 개인정보·연락처 나열) 나열 금지.
다음 다층 구조(마크다운 소제목)로 작성한다. 각 2~4줄, 근거 있는 것만:
## 1. 회사·브랜드 개요 (사업/설립/규모/대표 브랜드)
## 2. 제품·카테고리 (주력 라인·가격대·강점 SKU)
## 3. 브랜드 포지셔닝·차별점 (핵심 메시지·USP·톤)
## 4. 타깃 시장·고객 (국내/해외, 연령·성별·니즈)
## 5. 해외·TikTok Shop 진출 적합도 ★ (숏폼/라이브 적합성, 콘텐츠 소재, 시딩 가능성, 진입 난이도)
## 6. 경쟁·기회 (경쟁 강도, 진출 가능 국가·기회 포인트)
## 7. 리스크·인증 (규제/인증 필요 카테고리, 물류·법적 리스크)
## 8. 추천 액션 (다음 단계 3가지 — 제안 방향/시딩/셋업 우선순위)
마지막 줄: **핵심 한 줄 요약**.`;

  const user = `[브랜드 원장 데이터]
브랜드: ${brand.brand_name}
카테고리: ${brand.category || "미상"} · URL: ${brand.brand_url || "없음"} · 사업자번호: ${brand.biz_no ? "있음" : "없음"}
목표국: ${brand.countries?.length ? brand.countries.join(", ") : "미정"} · 진단 등급: ${brand.grade ?? "미진단"}

[사전분석 브리프]
${brand.brief_md ? brand.brief_md.slice(0, 1200) : "(미생성)"}

[수집 시그널]
${sigLines}

[제품]
${prodLines}

[회사 웹사이트 발췌]
${site.ok ? site.text : "(웹사이트 미등록 또는 수집 실패 — 이 경우 원장 데이터만으로 분석하고 5~7번은 '웹사이트 근거 없음'으로 표기)"}

위 근거로 8개 층 심층 분석을 작성해줘.`;

  const md = await aiText({ system, user, maxTokens: 1800 }).catch(() => null);
  if (!md) return { ok: false, error: "AI 분석 생성 실패 (잠시 후 재시도)" };
  const text = md.trim();

  // 결과 저장 — 재실행 없이 카드에서 열람(근거 URL·시각 기록).
  await query(
    "UPDATE brands SET deep_analysis_md=$2, deep_analysis_at=now(), deep_analysis_src=$3 WHERE id=$1",
    [brandId, text, site.fetched.join(", ") || null],
  ).catch(() => {});

  revalidatePath(`/brand/${brandId}`);
  return { ok: true, md: text, fetched: site.fetched };
}

// ═══ 셋업 — 브랜드별 제품/인증/물류 보강 (PLAN 8절) ═══════════
// @/app/actions.ts 수정 금지 규칙에 따라, 기존 upsertCertAction/upsertLogisticsAction 이
// 받지 못하던 입력(서류링크=note·발급일·계약 시작일)을 이 화면 액션으로 확장한다.
// 저장처는 어드민 원장 테이블(product_certs·logistics_contracts)뿐 — glovek 원본은 읽기전용.
import { upsertCert as repoUpsertCert, upsertLogistics as repoUpsertLogistics } from "@/lib/repo/card";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CERT_STATUSES = new Set(["none", "preparing", "submitted", "ready", "rejected", "expired"]);
const LOGI_STATUSES = new Set(["none", "negotiating", "contracted", "active", "expired"]);

function dateOrNull(v?: string | null): string | null {
  const s = (v ?? "").trim();
  return DATE_RE.test(s) ? s : null;
}

/** 인증 등록·수정(전체 필드) — 기존 컬럼 범위(issued_at·expires_at·note=서류링크/메모). */
export async function upsertCertFullAction(brandId: string, input: {
  product_id: string; country: string; cert_type: string; status?: string;
  cert_number?: string; issued_at?: string | null; expires_at?: string | null; note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드 ID" };
  if (!UUID_RE.test(input.product_id)) return { ok: false, error: "제품을 선택하세요" };
  const certType = (input.cert_type ?? "").trim();
  if (!certType) return { ok: false, error: "인증 종류를 입력하세요" };
  // 제품이 이 브랜드 소속인지 확인(다른 브랜드 제품에 인증이 붙는 것 방지).
  const owns = await queryOne<{ id: string }>(
    "SELECT id FROM products_master WHERE id=$1 AND brand_id=$2", [input.product_id, brandId]);
  if (!owns) return { ok: false, error: "이 브랜드의 제품이 아닙니다" };
  const status = CERT_STATUSES.has(input.status ?? "") ? input.status! : "preparing";
  await repoUpsertCert({
    product_id: input.product_id, country: input.country, cert_type: certType, status,
    cert_number: (input.cert_number ?? "").trim(),
    issued_at: dateOrNull(input.issued_at), expires_at: dateOrNull(input.expires_at),
    note: (input.note ?? "").trim(),
  });
  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/products");
  return { ok: true };
}

/** 물류 계약 등록(전체 필드) — 시작일·계약서/서류 링크(note) 포함. */
export async function upsertLogisticsFullAction(input: {
  brand_id: string; country: string; provider?: string; status?: string;
  warehouse_region?: string; start_date?: string | null; end_date?: string | null; note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(input.brand_id)) return { ok: false, error: "잘못된 브랜드 ID" };
  const country = (input.country ?? "").trim().toUpperCase();
  if (!country) return { ok: false, error: "국가를 선택하세요" };
  const status = LOGI_STATUSES.has(input.status ?? "") ? input.status! : "none";
  await repoUpsertLogistics({
    brand_id: input.brand_id, country,
    provider: (input.provider ?? "").trim(), status,
    warehouse_region: (input.warehouse_region ?? "").trim(),
    start_date: dateOrNull(input.start_date), end_date: dateOrNull(input.end_date),
    note: (input.note ?? "").trim(),
  });
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}
