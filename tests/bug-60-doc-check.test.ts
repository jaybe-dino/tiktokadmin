// BUG-60 — "각 서류마다 AI 가 먼저 검수하고 반려일지 말지를 체크".
//   올린 자리에서 바로 판정이 나와야 하고, 판정이 틀렸을 때 사람이 고칠 수 있어야 한다.
//   특히: 검수 실패를 '통과' 로 둔갑시키지 않을 것, 서류에 적힌 값을 저장/출력하지 않을 것.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  ruleFor, cleanReasons, cleanVerdict, reasonLines, REASON_TEXT, REASON_CODES, VERDICT_LABEL,
} from "../lib/onb-doc-rules";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("검수 규칙", () => {
  it("실제 업로드 칸마다 규칙이 있다", () => {
    ["doc_biz_reg_en", "doc_corp_reg_kr", "rep_passport_front", "rep_address_proof"].forEach((f) => {
      expect(ruleFor(f), f).toBeTruthy();
    });
    // 국가·제품별로 이름이 달라지는 칸은 접두사로 잡는다.
    expect(ruleFor("label_photo_abc")?.label).toBe("제품 라벨 사진");
    expect(ruleFor("cert_US")?.label).toBe("수입 인증 서류");
    expect(ruleFor("logistics_JP")?.label).toBe("물류 계약서·증빙");
    expect(ruleFor("detail_en_VN")?.label).toBe("상세페이지");
    expect(ruleFor("모르는칸")).toBeNull();
  });

  it("여권·거주지 증명은 신분 서류로 표시된다(외부 전송 기준이 달라진다)", () => {
    expect(ruleFor("rep_passport_front")?.identity).toBe(true);
    expect(ruleFor("rep_address_proof")?.identity).toBe(true);
    expect(ruleFor("doc_biz_reg_en")?.identity).toBe(false);
    expect(ruleFor("label_photo_1")?.identity).toBe(false);
  });
});

describe("모델 응답 정제 — 지어낸 값은 버린다", () => {
  it("모르는 사유 코드는 버린다", () => {
    expect(cleanReasons(["unreadable", "코드아님", "masked"])).toEqual(["unreadable", "masked"]);
    expect(cleanReasons("문자열")).toEqual([]);
    expect(cleanReasons(null)).toEqual([]);
  });

  it("중복을 지우고 4개까지만 쓴다", () => {
    expect(cleanReasons(["masked", "masked"])).toEqual(["masked"]);
    expect(cleanReasons([...REASON_CODES]).length).toBeLessThanOrEqual(4);
  });

  it("판정값은 셋 중 하나만 받는다", () => {
    expect(cleanVerdict("reject")).toBe("reject");
    expect(cleanVerdict("REJECT")).toBe("reject");
    expect(cleanVerdict("반려")).toBeNull();
    expect(cleanVerdict(undefined)).toBeNull();
  });

  it("사유 문장은 우리가 쓴 것만 나간다 — 모델 문장을 그대로 띄우지 않는다", () => {
    expect(reasonLines(["unreadable", "없는코드"])).toEqual([REASON_TEXT.unreadable]);
  });

  it("판정 라벨이 사람 말이다", () => {
    expect(VERDICT_LABEL.reject).toContain("반려");
  });
});

describe("기계 검사 — AI 없이도 항상 돈다", () => {
  it("빈 파일에 가까우면 반려", async () => {
    const { mechanicalCheck } = await import("../lib/onb-doc-check");
    const r = mechanicalCheck({ field: "doc_biz_reg_en", mime: "application/pdf", size: 100, bytes: new Uint8Array(100) });
    expect(r.verdict).toBe("reject");
    expect(r.reasons).toContain("too_small_bytes");
  });

  it("해상도 기준이 있는 칸은 작은 사진을 잡는다", async () => {
    const { mechanicalCheck } = await import("../lib/onb-doc-check");
    // 320×240 PNG 헤더(IHDR 까지만 — 판독에는 앞부분만 쓴다).
    const png = Buffer.alloc(40 * 1024);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(320, 16); png.writeUInt32BE(240, 20);
    const r = mechanicalCheck({ field: "rep_passport_front", mime: "image/png", size: png.length, bytes: png });
    expect(r.verdict).toBe("reject");
    expect(r.reasons).toContain("too_small_pixels");
  });

  it("규격을 만족하면 통과", async () => {
    const { mechanicalCheck } = await import("../lib/onb-doc-check");
    const png = Buffer.alloc(80 * 1024);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(1600, 16); png.writeUInt32BE(1200, 20);
    const r = mechanicalCheck({ field: "rep_passport_front", mime: "image/png", size: png.length, bytes: png });
    expect(r.verdict).toBe("pass");
    expect(r.reasons).toEqual([]);
  });
});

describe("AI 로 보낼 수 있는 칸인지", () => {
  const OLD = { ...process.env };
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key-not-real"; });
  afterEach(() => { process.env = { ...OLD }; });

  it("신분 서류는 기본적으로 보내지 않는다 — 켜야 보낸다", async () => {
    const { aiCheckable } = await import("../lib/onb-doc-check");
    delete process.env.ONB_AI_ID_DOCS;
    const off = aiCheckable("rep_passport_front", "image/jpeg", 1000);
    expect(off.ok).toBe(false);
    expect(off.why).toContain("ONB_AI_ID_DOCS");

    process.env.ONB_AI_ID_DOCS = "1";
    expect(aiCheckable("rep_passport_front", "image/jpeg", 1000).ok).toBe(true);
  });

  it("신분 서류가 아니면 키만 있으면 본다", async () => {
    const { aiCheckable } = await import("../lib/onb-doc-check");
    expect(aiCheckable("doc_biz_reg_en", "image/jpeg", 1000).ok).toBe(true);
  });

  it("PDF·대용량·규칙 없는 칸은 건너뛰되 사유를 남긴다(조용히 넘어가지 않는다)", async () => {
    const { aiCheckable } = await import("../lib/onb-doc-check");
    expect(aiCheckable("doc_biz_reg_en", "application/pdf", 1000).why).toContain("이미지가 아님");
    expect(aiCheckable("doc_biz_reg_en", "image/jpeg", 9 * 1024 * 1024).why).toContain("한도");
    expect(aiCheckable("모르는칸", "image/jpeg", 1000).why).toContain("규칙");
  });

  it("키가 없으면 AI 를 쓰지 않는다", async () => {
    const { aiCheckable } = await import("../lib/onb-doc-check");
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiCheckable("doc_biz_reg_en", "image/jpeg", 1000).ok).toBe(false);
  });
});

describe("화면·저장 연결", () => {
  it("업로드 응답에 검수 결과가 실린다", () => {
    const route = read("app/api/apply/upload/route.ts");
    expect(route).toContain("checkDocument");
    expect(route).toContain("saveDocCheck");
    expect(route).toMatch(/return NextResponse\.json\(\{ ok: true,[^}]*check \}\)/);
    // 검수가 실패해도 업로드는 성공이다 — 저장은 이미 끝났다.
    expect(route).toMatch(/catch \(e\) \{\s*console\.error\("\[apply-upload\] 서류 검수 실패/);
  });

  it("신청서가 올린 자리에서 판정을 보여 준다", () => {
    const form = read("app/apply/ApplyForm.tsx");
    expect(form).toContain("DocCheckNote");
    expect(form).toContain("지금 다시 올리면 반려 없이 진행됩니다.");
    // 업로드 실패를 더 이상 묻지 않는다(기존에는 조용히 사라졌다).
    expect(form).toContain('setErr(r.error ?? "업로드하지 못했습니다.")');
  });

  it("관리자 검토 화면에도 같은 판정이 뜬다", () => {
    const rc = read("app/(dash)/onboarding/[customerId]/ReviewClient.tsx");
    expect(rc).toContain("CheckBadge");
    expect(rc).toContain("최종 판단은 담당자가 합니다.");
    expect(rc).toContain("fileIdOf");
  });

  it("저장 표에 서류 내용이 아니라 판정·코드만 남는다", () => {
    const sql = read("migrations/0121_onb_doc_checks.sql");
    expect(sql).toContain("verdict");
    expect(sql).toContain("reasons jsonb");
    expect(sql).toMatch(/CHECK \(verdict IN \('pass','warn','reject'\)\)/);
    // 서류에 적힌 값이나 모델 원문을 담는 칸이 없다.
    expect(sql).not.toMatch(/\b(raw|text_content|extracted|summary|note)\b/);
  });

  it("모델에게 값을 출력하지 말라고 못 박는다", () => {
    const src = read("lib/onb-doc-check.ts");
    expect(src).toContain("절대 출력하지 않는다");
    // 사유 없이 reject 만 오면 사람이 고칠 수 없으므로 낮춘다.
    expect(src).toMatch(/verdict === "reject" && reasons\.length === 0/);
    // 호출 실패를 통과로 바꾸지 않는다.
    expect(src).toMatch(/catch[\s\S]{0,200}verdict: "warn", reasons: \["not_checked"\]/);
  });
});
