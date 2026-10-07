// 세미나 공개 신청 — 배선 감사(DB 없이).
//   "공개 화면은 로그인 없이", "관리 화면은 기존 인증으로만", "접속 링크는 공개 경로에 없음",
//   "발송 OFF", "기존 세미나·발송 설정 미변경" 같은 약속이 코드에 실제로 박혀 있는지 본다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** 설명 주석을 걷어낸 실제 코드만 남긴다(주석에 쓴 단어로 감사가 틀리지 않게). */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const sqlOf = (p: string) => read(p).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

const MIGRATION = "../migrations/0113_seminar_apply_2026.sql";
const LIB = "../lib/seminar-apply.ts";
const MODEL = "../lib/seminar-apply-model.ts";
const ADMIN_MODEL = "../lib/seminar-apply-admin-model.ts";
const PUBLIC_ACTIONS = "../app/seminar-apply/actions.ts";
const PUBLIC_FORM = "../app/seminar-apply/SeminarApplyForm.tsx";
const ADMIN_ACTIONS = "../app/(dash)/seminar-apply-admin/actions.ts";
const ADMIN_PANEL = "../components/SeminarApplyAdminPanel.tsx";
const MIDDLEWARE = "../middleware.ts";

describe("경로·권한", () => {
  it("공개 신청 경로는 로그인 없이 열린다", () => {
    const m = code(MIDDLEWARE);
    expect(m).toContain('pathname.startsWith("/seminar-apply")');
  });

  it("관리 경로는 공개 허용 목록에서 빠진다", () => {
    const m = code(MIDDLEWARE);
    // 공개 허용을 적은 두 곳(포털 호스트·일반 호스트) 모두에서 관리 경로를 제외한다.
    const excl = m.match(/!pathname\.startsWith\("\/seminar-apply-admin"\)/g) ?? [];
    expect(excl.length).toBe(2);
  });

  it("관리 화면은 관리자 폴더 안에 있어 기존 인증을 그대로 쓴다", () => {
    expect(() => read("../app/(dash)/seminar-apply-admin/page.tsx")).not.toThrow();
    expect(code("../app/(dash)/seminar-apply-admin/page.tsx")).toContain("currentUser");
  });

  it("관리 서버액션은 모든 입구에서 권한을 확인한다", () => {
    const a = code(ADMIN_ACTIONS);
    const exported = [...a.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(8);
    // 각 액션 본문이 me()/editor()/zoomer() 중 하나로 시작하는지 본다.
    for (const name of exported) {
      const i = a.indexOf(`export async function ${name}`);
      const body = a.slice(i, i + 600);
      expect(/await (me|editor|zoomer)\(\)/.test(body), name).toBe(true);
    }
  });

  it("쓰기 액션은 읽기 권한(me)만으로 통과하지 않는다", () => {
    const a = code(ADMIN_ACTIONS);
    for (const name of ["sapSetStatusAction", "sapSetNoteAction", "sapSetActiveAction",
      "sapSetCapAction", "sapLinkBrandAction", "sapWithdrawAdsAction",
      "sapAddTestAction", "sapDeleteTestAction"]) {
      const i = a.indexOf(`export async function ${name}`);
      expect(i, name).toBeGreaterThan(-1);
      expect(/await editor\(\)/.test(a.slice(i, i + 400)), name).toBe(true);
    }
    // 접속 링크는 대표만.
    const z = a.indexOf("export async function sapSetZoomAction");
    expect(/await zoomer\(\)/.test(a.slice(z, z + 400))).toBe(true);
  });
});

describe("접속 링크 비공개", () => {
  it("공개 서버액션은 zoom 칼럼을 돌려주지 않는다", () => {
    const a = code(PUBLIC_ACTIONS);
    expect(a).not.toMatch(/zoom/i);
    expect(a).toContain("listPublicSessions");
  });

  it("공개 회차 조회 SQL 에 zoom 칼럼이 없다", () => {
    const l = code(LIB);
    const i = l.indexOf("export async function listPublicSessions");
    const body = l.slice(i, l.indexOf("export", i + 10));
    expect(body).not.toMatch(/zoom/i);
  });

  it("공개 화면(폼)에 zoom 링크를 그리는 코드가 없다", () => {
    expect(code(PUBLIC_FORM)).not.toMatch(/zoom_url|zoomUrl/i);
  });

  it("CSV 머리글·본문에 접속 링크 칼럼이 없다", () => {
    const m = code(ADMIN_MODEL);
    // 링크 칼럼도, 링크 값을 읽는 코드도 없다(초안 함수 이름에만 Zoom 이 들어간다).
    expect(m).not.toContain("zoom_url");
    expect(m).not.toMatch(/https?:\/\/[^'"`\s]*zoom/i);
    const i = m.indexOf("export function csvOfRegs");
    const end = m.indexOf("export interface Draft", i);
    expect(m.slice(i, end > i ? end : m.length)).not.toMatch(/zoom/i);
  });

  it("권한이 없으면 관리 화면에도 링크 값을 실어 보내지 않는다", () => {
    expect(code(ADMIN_ACTIONS)).toContain("canZoom ? s :");
  });
});

describe("접수 ≠ 선정", () => {
  it("저장 기본 상태는 submitted 이고 선착순 자동선정 코드가 없다", () => {
    const s = sqlOf(MIGRATION);
    expect(s).toContain("status text NOT NULL DEFAULT 'submitted'");
    expect(s).toContain("CHECK (status IN ('submitted','selected','waitlisted','not_selected','cancelled'))");
    const l = code(LIB);
    // 제출 경로가 'selected' 를 쓰지 않는다.
    const i = l.indexOf("export async function submitApplication");
    const body = l.slice(i, l.indexOf("export interface SelectResult", i));
    expect(body).not.toContain("'selected'");
    expect(body).not.toContain('"selected"');
  });

  it("접수 경로에 정원 검사가 없다(무제한 접수)", () => {
    const l = code(LIB);
    const i = l.indexOf("export async function submitApplication");
    const body = l.slice(i, l.indexOf("export interface SelectResult", i));
    expect(body).not.toContain("select_cap");
  });

  it("선정 상한은 선정 경로에서 트랜잭션으로 강제한다", () => {
    const l = code(LIB);
    const i = l.indexOf("export async function setRegStatus");
    const body = l.slice(i, i + 2600);
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("select_cap");
    expect(body).toContain("status='selected'");
    expect(body).toContain('next === "selected" && selected >= cap');
  });

  it("상한을 차지하는 상태는 선정뿐이고 기존 좌석 정책을 바꾸지 않는다", () => {
    expect(code(MODEL)).toContain('CAP_STATUSES: SapStatus[] = ["selected"]');
    // 기존 세미나 모집 허브의 REG_OCCUPYING 은 그대로 둔다.
    expect(code("../lib/seminar-events-model.ts"))
      .toContain('REG_OCCUPYING: readonly RegStatus[] = ["applied", "confirmed", "attended"]');
  });
});

describe("발송 OFF", () => {
  it("마이그레이션이 발송·자동접수메일을 OFF 로 넣는다", () => {
    const s = sqlOf(MIGRATION);
    expect(s).toContain("send_enabled boolean NOT NULL DEFAULT false");
    expect(s).toContain("auto_ack_enabled boolean NOT NULL DEFAULT false");
  });

  it("신청·관리 코드가 메일·문자 모듈을 쓰지 않는다", () => {
    for (const p of [LIB, MODEL, ADMIN_MODEL, PUBLIC_ACTIONS, ADMIN_ACTIONS, PUBLIC_FORM, ADMIN_PANEL]) {
      const c = code(p);
      for (const bad of ["./mailer", "@/lib/mailer", "./sms", "@/lib/sms",
        "sendEmail", "sendSms", "seminar-transport", "sendSeminarMessage"]) {
        expect(c.includes(bad), `${p} → ${bad}`).toBe(false);
      }
    }
  });

  it("안내문은 초안만 만들고 보내지 않는다", () => {
    const m = code(ADMIN_MODEL);
    expect(m).toContain("draftSelectedMail");
    expect(m).toContain("draftZoomMail");
    expect(m).not.toMatch(/send|발송하/i);
    // Zoom 초안에 링크 원문을 심지 않는다.
    expect(m).not.toContain("zoom_url");
  });

  it("기존 발송·cron 설정 표를 건드리지 않는다", () => {
    const forbidden = ["seminar_config", "seminar_sends", "seminar_templates", "seminar_sessions",
      "seminar_targets", "lead_sequence", "welcome_config", "ad_optouts", "ad_recipients",
      "sev_events", "sev_registrations"];
    for (const p of [LIB, MODEL, ADMIN_MODEL, PUBLIC_ACTIONS, ADMIN_ACTIONS]) {
      const c = code(p);
      for (const t of forbidden) expect(c.includes(t), `${p} → ${t}`).toBe(false);
    }
    // 마이그레이션도 기존 표를 바꾸지 않는다(ALTER/DROP 없음).
    const s = sqlOf(MIGRATION);
    expect(s).not.toMatch(/\bALTER TABLE\b/i);
    expect(s).not.toMatch(/\bDROP\b/i);
  });

  it("brands 원장은 읽기만 한다", () => {
    const l = code(LIB);
    const writes = l.match(/(UPDATE|INSERT INTO|DELETE FROM)\s+brands/gi) ?? [];
    expect(writes).toEqual([]);
    expect(l).toContain("FROM brands");   // 후보 조회·존재 확인은 한다
  });
});

describe("개인정보", () => {
  it("동의 3종을 따로 저장하고 버전·시각을 남긴다", () => {
    const s = sqlOf(MIGRATION);
    for (const col of ["consent_required", "consent_required_at", "consent_optional",
      "consent_optional_at", "consent_ads", "consent_ads_at", "consent_version"]) {
      expect(s, col).toContain(col);
    }
    expect(s).toContain("CONSTRAINT sap_reg_required_consent CHECK (consent_required)");
    expect(s).toContain("CREATE TABLE IF NOT EXISTS sap_consent_events");
  });

  it("동의 만료 시점을 저장한다", () => {
    const s = sqlOf(MIGRATION);
    expect(s).toContain("consent_required_expires_at");
    expect(s).toContain("consent_ads_expires_at");
    expect(s).toContain("consent_ads_withdrawn_at");
  });

  it("만료만으로 자동 삭제하는 코드가 없다", () => {
    const l = code(LIB);
    // 보유기간 상태는 세기만 한다.
    const i = l.indexOf("export async function expiryState");
    const body = l.slice(i, i + 900);
    expect(body).not.toMatch(/DELETE|TRUNCATE/i);
    // 지우는 코드는 합성 데이터용 하나뿐이다.
    const deletes = l.match(/DELETE FROM \w+/g) ?? [];
    expect(deletes).toEqual(["DELETE FROM sap_registrations"]);
    expect(l).toContain("WHERE is_test = true");
  });

  it("주민번호·주소·파일 업로드 칼럼이 없다", () => {
    const s = sqlOf(MIGRATION);
    for (const bad of ["resident", "ssn", "rrn", "jumin", "file_id", "upload", "poster"]) {
      expect(s.toLowerCase().includes(bad), bad).toBe(false);
    }
    // 신청자 주소는 받지 않는다(운영자 주소 칼럼만 설정에 있다).
    expect(s).toContain("org_address");
    expect(s).not.toMatch(/^\s{2}address\b/m);
  });

  it("실제 운영자·문의처를 쓰고 사업자번호는 비워 둔다", () => {
    const s = sqlOf(MIGRATION);
    expect(s).toContain("'디노스튜디오'");
    expect(s).toContain("허정발");
    expect(s).toContain("'chief@dinostudio.kr'");
    expect(s).toContain("'010-5663-1273'");
    expect(s).toContain("org_biz_no text NOT NULL DEFAULT ''");
  });

  it("동의 체크는 모두 꺼진 상태로 시작한다", () => {
    const f = code(PUBLIC_FORM);
    // 초기 상태에 어떤 동의도 true 로 두지 않는다.
    expect(f).toContain("useState<SapFormInput>({ targetCountries: [] })");
    expect(f).not.toMatch(/consent\w*:\s*true/);
    expect(f).not.toMatch(/wantsConsult:\s*true/);
    expect(f).toContain("Boolean(v.consentRequired)");
  });

  it("중복 응답에 기존 신청자 정보를 담지 않는다", () => {
    const l = code(LIB);
    expect(l).toContain("return { ok: true, already: true, saved: false };");
  });

  it("관리 목록은 가린 연락처를 쓴다", () => {
    const p = code(ADMIN_PANEL);
    expect(p).toContain("maskEmail(r.email)");
    expect(p).toContain("maskPhone(r.phone)");
  });

  it("IP 원문을 저장하지 않는다", () => {
    const l = code(LIB);
    expect(l).toContain("createHash");
    const i = l.indexOf("function rateBucket");
    expect(l.slice(i, i + 300)).toContain('update(`sap:${ip}`)');
    const s = sqlOf(MIGRATION);
    expect(s).not.toMatch(/\bip\b\s+text/i);
  });

  it("주소창 쿼리로는 출처만 읽는다", () => {
    const f = code(PUBLIC_FORM);
    const i = f.indexOf("new URLSearchParams");
    const body = f.slice(i, i + 400);
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "campaign_id"]) {
      expect(body, key).toContain(key);
    }
    for (const bad of ["email", "phone", "name"]) {
      expect(body.includes(`q.get("${bad}`), bad).toBe(false);
    }
  });
});

describe("한 페이지 신청", () => {
  it("단계 이동(스텝) 없이 한 화면에서 끝낸다", () => {
    const f = code(PUBLIC_FORM);
    expect(f).not.toContain("setStep");
    expect(f).not.toContain("StepBar");
    // 제출 버튼은 본문과 고정 바 두 곳이고, 둘 다 같은 submit 을 부른다.
    expect((f.match(/onClick=\{submit\}/g) ?? []).length).toBe(2);
  });

  it("필수 항목이 모두 한 화면에 있다", () => {
    const f = code(PUBLIC_FORM);
    for (const label of ["희망 회차", "회사명", "브랜드명", "담당자명", "직무",
      "업무 이메일", "연락처", "상품 카테고리", "현재 해외진출 단계", "희망 국가"]) {
      expect(f.includes(label), label).toBe(true);
    }
  });

  it("빠진 항목은 화면에서도 사라졌다", () => {
    const f = code(PUBLIC_FORM);
    for (const gone of ["해외 매출 구간", "수출 시작 예정", "희망 지원 분야",
      "현재 판매 채널", "현재 판매 국가", "사업자번호"]) {
      expect(f.includes(gone), gone).toBe(false);
    }
  });
});

describe("봇·검증", () => {
  it("미끼 입력과 서버 검증이 모두 있다", () => {
    expect(code(LIB)).toContain("clean(input.trap, 200)");
    expect(code(LIB)).toContain("formBlockers(input)");
    expect(code(MODEL)).toContain("export function formBlockers");
  });

  it("속도 제한이 제출 경로에 걸려 있다", () => {
    const l = code(LIB);
    const i = l.indexOf("export async function submitApplication");
    expect(l.slice(i, i + 1600)).toContain("rateOk(");
  });

  it("공개 경로는 is_test 를 받지 않는다", () => {
    const a = code(PUBLIC_ACTIONS);
    expect(a).not.toContain("isTest");
  });
});

describe("회차 데이터", () => {
  it("확정된 4회차가 KST 11:00~12:00(UTC 02:00~03:00)로 들어간다", () => {
    const s = sqlOf(MIGRATION);
    for (const d of ["2026-10-13", "2026-10-16", "2026-10-20", "2026-10-23"]) {
      expect(s).toContain(`'${d}T02:00:00Z', '${d}T03:00:00Z'`);
    }
    expect(s).toContain("select_cap int NOT NULL DEFAULT 30");
  });

  it("Zoom 실링크를 마이그레이션에 넣지 않는다", () => {
    const s = sqlOf(MIGRATION);
    expect(s).not.toMatch(/zoom\.us|https?:\/\/[^']*zoom/i);
    expect(s).toContain("zoom_url text NOT NULL DEFAULT ''");
  });
});
