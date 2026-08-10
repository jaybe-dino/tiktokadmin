"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SmsSender from "@/components/SmsSender";
import { composeEmailAction } from "@/app/actions";
import {
  draftBulkCopyAction,
  sendTestToSelfAction,
  createBulkSendAction,
  runBulkNowAction,
} from "@/app/(dash)/send/actions";

type Row = Record<string, unknown>;
type LeadGroup = { name: string; n: number; created: string };
type BrandOpt = { id: string; name: string; contact: string; email: string };

const CH: Record<string, string> = { email: "✉️ 메일", sms: "📱 문자", both: "메일+문자" };
const TK: Record<string, string> = { lead_group: "리드 그룹", filter: "필터 조합", manual: "직접 선택" };
const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "cc-warn" },
  queued: { ko: "대기", c: "cc-ing" },
  sending: { ko: "발송중", c: "cc-ing" },
  done: { ko: "완료", c: "cc-ok" },
  canceled: { ko: "취소", c: "cc-no" },
};

function fmt(v: unknown): string {
  const s = String(v ?? "");
  return s ? s.slice(0, 16).replace("T", " ") : "-";
}
function fmtDate(v: unknown): string {
  const s = String(v ?? "");
  return s ? s.slice(0, 10) : "";
}

const GRID: React.CSSProperties = { gap: 14 };

type Msg = { ok: boolean; text: string } | null;

export default function SendCenter({
  sends,
  leadGroups,
  brands,
  mailOk = false,
  smsOk = false,
  canRunNow = false,
}: {
  sends: Row[];
  leadGroups: LeadGroup[];
  brands: BrandOpt[];
  mailOk?: boolean;
  smsOk?: boolean;
  canRunNow?: boolean;
}) {
  const [tab, setTab] = useState<"mail" | "sms" | "log">("mail");

  return (
    <div>
      <div className="tabs mb-4">
        <button className={tab === "mail" ? "on" : ""} onClick={() => setTab("mail")}>
          ✉️ 메일 발송
        </button>
        <button className={tab === "sms" ? "on" : ""} onClick={() => setTab("sms")}>
          📱 문자 발송
        </button>
        <button className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>
          발송 관리 · 채널 정책
        </button>
      </div>

      {tab === "mail" && <MailTab leadGroups={leadGroups} brands={brands} />}
      {tab === "sms" && <SmsTab leadGroups={leadGroups} />}
      {tab === "log" && <LogTab sends={sends} canRunNow={canRunNow} mailOk={mailOk} smsOk={smsOk} />}
    </div>
  );
}

/* ───────────── 탭1 · 메일 (좌 2.1 / 우 1) ───────────── */
function MailTab({ leadGroups, brands }: { leadGroups: LeadGroup[]; brands: BrandOpt[] }) {
  const router = useRouter();
  const [group, setGroup] = useState(leadGroups[0]?.name ?? "");
  const [template, setTemplate] = useState("박람회 환영 + 세미나 초대");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [drafting, startDraft] = useTransition();
  const [testing, startTest] = useTransition();
  const [sending, startSend] = useTransition();

  function aiDraft() {
    setMsg(null);
    startDraft(async () => {
      const r = await draftBulkCopyAction({ channel: "email", template });
      if (r.ok) {
        if (r.subject) setSubject(r.subject);
        if (r.body) setBody(r.body);
        setMsg({ ok: true, text: "AI 초안을 채웠습니다. 내용을 검토 후 발송하세요." });
      } else setMsg({ ok: false, text: r.error ?? "실패" });
    });
  }
  function testSend() {
    setMsg(null);
    startTest(async () => {
      const r = await sendTestToSelfAction({ subject, body });
      setMsg(r.ok ? { ok: true, text: r.info ?? "테스트 발송 완료" } : { ok: false, text: r.error ?? "실패" });
    });
  }
  function bulkSend() {
    setMsg(null);
    startSend(async () => {
      const r = await createBulkSendAction({
        channel: "email",
        leadGroup: group,
        title: subject || undefined,
        subject,
        body,
      });
      if (r.ok) {
        setMsg({
          ok: true,
          text: `발송 등록 완료 · 대상 ${r.total}명 (미동의 제외 ${r.excludedOptout} · 연락처없음 ${r.excludedNoContact})`,
        });
        router.refresh();
      } else setMsg({ ok: false, text: r.error ?? "실패" });
    });
  }

  const busy = drafting || testing || sending;

  return (
    <div className="grid g31" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-hd">
          <b>대량 메일</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>대상 → 작성 → 검토·발송</span>
        </div>
        <div className="card-bd">
          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 1 · 대상 그룹</b>
          <div className="radio sel" style={{ marginTop: 8 }}>
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>리드 등록 날짜 그룹</b>
              <select
                className="f"
                style={{ marginTop: 6 }}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                {leadGroups.length === 0 ? (
                  <option value="">등록된 리드 그룹 없음</option>
                ) : (
                  leadGroups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {fmtDate(g.created)} · {g.name} ({g.n}명)
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div className="radio" style={{ opacity: 0.55 }} title="준비 중 — 현재는 리드 그룹 기준으로 발송됩니다">
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>필터 조합</b> <span className="chip" style={{ fontSize: 10 }}>준비 중</span>
              <div className="tagz" style={{ marginTop: 6 }}>
                <span className="chip">상태: 리드·담당자배정</span>
                <span className="chip">마지막 접촉 30일+</span>
                <Link className="btn sm" href="/customers">고객목록에서 필터</Link>
              </div>
            </div>
          </div>
          <div className="radio" style={{ opacity: 0.55 }} title="준비 중">
            <span className="rb" />
            <div>
              <b>직접 선택</b> <span className="chip" style={{ fontSize: 10 }}>준비 중</span>{" "}
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>검색·체크 / 목록 붙여넣기</span>
            </div>
          </div>
          <div className="note" style={{ margin: "8px 0 14px" }}>
            대상 선택 시 <b style={{ color: "var(--ok)" }}>수신동의 보유 대상만</b> 자동 필터 · 거부·연락처
            없음 <b style={{ color: "var(--danger)" }}>자동 제외</b>
          </div>

          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 2 · 메일 작성</b>
          <label className="f">발신 계정</label>
          <div className="note" style={{ marginTop: 2 }}>
            발신은 <b>설정 → 회사 공용 메일함</b>의 <b>기본 발신 메일함</b>에서 나갑니다 (개인 메일 사용 불가).
            메일함별 발신은 설정에서 관리하세요.
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <select className="f" value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option>박람회 환영 + 세미나 초대</option>
              <option>미팅 예약 안내</option>
              <option>빈 문서</option>
            </select>
            <button
              className="btn sm"
              style={{ whiteSpace: "nowrap" }}
              onClick={aiDraft}
              disabled={busy}
            >
              {drafting ? "생성 중…" : "AI 초안 생성"}
            </button>
          </div>
          <input
            className="f"
            style={{ marginTop: 6 }}
            placeholder="제목 — 예: [GloveK] {브랜드명}님, 반가웠습니다"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            className="f"
            rows={3}
            style={{ marginTop: 6 }}
            placeholder="{담당자명}님, ... 개인화 변수를 활용해 본문을 작성하세요."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>
            개인화 변수: {"{브랜드명} {담당자명} {설문링크}"} · 회신은 발신 계정으로
            수신 → 시스템이 전량 수집해 카드에 연결
          </div>

          <hr className="hr" />
          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 3 · 검토·발송</b>
          <div className="kv" style={{ marginTop: 8, fontSize: 12 }}>
            <dt>발송 시각</dt>
            <dd>즉시 / 예약</dd>
            <dt>발송 후</dt>
            <dd style={{ color: "var(--ok)" }}>전원 고객카드 히스토리에 컨택 기록 + 방치 알림 리셋</dd>
          </div>
          {msg && (
            <div
              className="note"
              style={{ marginTop: 12, color: msg.ok ? "var(--ok)" : "var(--danger)" }}
            >
              {msg.text}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" style={{ flex: 1 }} onClick={testSend} disabled={busy || !body}>
              {testing ? "발송 중…" : "테스트 발송 (나에게)"}
            </button>
            <button
              className="btn pri"
              style={{ flex: 1 }}
              onClick={bulkSend}
              disabled={busy || !group || !body}
            >
              {sending ? "등록 중…" : "대량 발송 실행"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", alignContent: "start", ...GRID }}>
        <IndividualMail brands={brands} />
        <div className="card">
          <div className="card-hd">
            <b>그룹 목록</b>
          </div>
          <div className="card-bd" style={{ paddingTop: 6, fontSize: 12 }}>
            {leadGroups.length === 0 ? (
              <div className="note">리드 그룹 데이터가 없습니다.</div>
            ) : (
              leadGroups.map((g) => (
                <div className="row" key={g.name}>
                  <span className="ico i-blu">📅</span>
                  <div>
                    <div className="tt">
                      {fmtDate(g.created)} · {g.name}
                    </div>
                    <div className="ss">{g.n}명</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 개별 메일 (AI 초안 → 초안함) ── */
function IndividualMail({ brands }: { brands: BrandOpt[] }) {
  const [brandId, setBrandId] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function compose() {
    setMsg(null);
    start(async () => {
      const r = await composeEmailAction(brandId);
      setMsg(
        r.ok
          ? { ok: true, text: `초안 생성 완료 — 초안함에서 검토·발송하세요.` }
          : { ok: false, text: r.error ?? "실패" },
      );
    });
  }

  return (
    <div className="card">
      <div className="card-hd">
        <b>개별 메일</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>고객카드에서도 [✉️ 메일]로 호출</span>
      </div>
      <div className="card-bd">
        <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          <option value="">브랜드 · 담당자 선택</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.contact ? ` · ${b.contact}` : ""}
            </option>
          ))}
        </select>
        <button
          className="btn pri"
          style={{ width: "100%", marginTop: 8 }}
          onClick={compose}
          disabled={pending || !brandId}
        >
          {pending ? "AI 초안 생성 중…" : "✉️ 개별 메일 작성"}
        </button>
        {msg && (
          <div className="note" style={{ marginTop: 8, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>
            {msg.text}
            {msg.ok && (
              <>
                {" "}
                <Link href="/drafts" style={{ color: "var(--acc)" }}>
                  초안함 열기 →
                </Link>
              </>
            )}
          </div>
        )}
        <div className="note" style={{ marginTop: 8 }}>
          AI가 카드 맥락(단계·최근 미팅·메일 스레드)으로 초안을 생성해 초안함에 저장 · 승인 시 발송·카드
          히스토리 기록
        </div>
      </div>
    </div>
  );
}

/* ───────────── 탭2 · 문자 (좌 2.1 / 우 1) ───────────── */
function SmsTab({ leadGroups }: { leadGroups: LeadGroup[] }) {
  const router = useRouter();
  const [group, setGroup] = useState(leadGroups[0]?.name ?? "");
  const [template, setTemplate] = useState("세미나 D-1 리마인드");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();

  function aiDraft() {
    setMsg(null);
    startDraft(async () => {
      const r = await draftBulkCopyAction({ channel: "sms", template });
      if (r.ok) {
        if (r.body) setBody(r.body);
        setMsg({ ok: true, text: "AI 문자 초안을 채웠습니다." });
      } else setMsg({ ok: false, text: r.error ?? "실패" });
    });
  }
  function bulkSend() {
    setMsg(null);
    startSend(async () => {
      const r = await createBulkSendAction({ channel: "sms", leadGroup: group, body });
      if (r.ok) {
        setMsg({
          ok: true,
          text: `문자 발송 등록 완료 · 대상 ${r.total}명 (미동의 제외 ${r.excludedOptout} · 번호없음 ${r.excludedNoContact})`,
        });
        router.refresh();
      } else setMsg({ ok: false, text: r.error ?? "실패" });
    });
  }

  const busy = drafting || sending;

  return (
    <div className="grid g31" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-hd">
          <b>대량 문자</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>알림톡 우선 · 실패 시 SMS 폴백</span>
        </div>
        <div className="card-bd">
          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 1 · 대상 그룹</b>
          <div className="radio sel" style={{ marginTop: 8 }}>
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>리드 등록 날짜 그룹</b>
              <select
                className="f"
                style={{ marginTop: 6 }}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                {leadGroups.length === 0 ? (
                  <option value="">등록된 리드 그룹 없음</option>
                ) : (
                  leadGroups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {fmtDate(g.created)} · {g.name} ({g.n}명)
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div className="radio" style={{ opacity: 0.5 }}>
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>필터 조합</b>{" "}
              <span className="pill" style={{ fontSize: 10, marginLeft: 4 }}>준비 중</span>
            </div>
          </div>
          <div className="radio" style={{ opacity: 0.5 }}>
            <span className="rb" />
            <div>
              <b>직접 선택</b>{" "}
              <span className="pill" style={{ fontSize: 10, marginLeft: 4 }}>준비 중</span>
            </div>
          </div>
          <div className="note" style={{ margin: "8px 0 14px" }}>
            대상 중 번호 보유·수신동의 <b style={{ color: "var(--ok)" }}>대상만 발송</b> · 미보유 자동
            제외
          </div>

          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 2 · 문자 작성</b>
          <label className="f">발신 번호 (서버 설정 ALIGO_SENDER 고정 — 변경은 관리자 환경변수)</label>
          <input className="f" value="회사 지정 발신번호 (ALIGO_SENDER)" disabled readOnly style={{ opacity: 0.7 }} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <select className="f" value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option>세미나 D-1 리마인드</option>
              <option>미팅 확인</option>
              <option>일반 SMS (템플릿 자유)</option>
            </select>
            <button
              className="btn sm"
              style={{ whiteSpace: "nowrap" }}
              onClick={aiDraft}
              disabled={busy}
            >
              {drafting ? "생성 중…" : "AI 초안 생성"}
            </button>
          </div>
          <textarea
            className="f"
            rows={3}
            style={{ marginTop: 6 }}
            placeholder="[GloveK] {담당자명}님, ... 개인화 변수 활용 · 회신은 지정 번호로"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>
            알림톡 템플릿은 사전 승인 필요 — 새 템플릿은 등록 후 1~2일
          </div>
          {msg && (
            <div className="note" style={{ marginTop: 12, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>
              {msg.text}
            </div>
          )}
          <button
            className="btn pri"
            style={{ width: "100%", marginTop: 12 }}
            onClick={bulkSend}
            disabled={busy || !group || !body}
          >
            {sending ? "등록 중…" : "대량 문자 발송 실행"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", alignContent: "start", ...GRID }}>
        <div className="card">
          <div className="card-hd">
            <b>개별 문자</b>
            <span style={{ color: "var(--ink3)", fontSize: 11 }}>Aligo · 발신 지정 번호 고정</span>
          </div>
          <div className="card-bd">
            <SmsSender />
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <b>문자 회신 인박스</b>
            <span className="pill" style={{ fontSize: 10, marginLeft: 6 }}>준비 중</span>
          </div>
          <div className="card-bd" style={{ paddingTop: 6, fontSize: 12 }}>
            <div className="note">인바운드 문자 수집 연동 예정 — 현재는 회신이 표시되지 않습니다.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 탭3 · 발송 관리·채널 정책 (좌 2.1 / 우 1) ───────────── */
function LogTab({ sends, canRunNow, mailOk, smsOk }: { sends: Row[]; canRunNow?: boolean; mailOk?: boolean; smsOk?: boolean }) {
  const [running, startRun] = useTransition();
  const [runMsg, setRunMsg] = useState("");
  const queuedCount = sends.filter((s) => s.status === "queued" || s.status === "sending").length;
  return (
    <div className="grid g31" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-hd">
          <b>통합 발송 관리 — 메일·문자 전체</b>
          {canRunNow && (
            <button
              className="btn btn-sm btn-primary"
              style={{ marginLeft: "auto" }}
              disabled={running || queuedCount === 0}
              title="대기(queued)·발송중 배치를 지금 즉시 발송 — 크론(10분) 대기 없이"
              onClick={() =>
                startRun(async () => {
                  setRunMsg("");
                  const r = await runBulkNowAction();
                  setRunMsg(
                    r.ok
                      ? `발송 실행: 성공 ${r.sent ?? 0} · 실패 ${r.failed ?? 0} · 완료건 ${r.done ?? 0}`
                      : r.error ?? "실행 실패",
                  );
                })
              }
            >
              {running ? "발송 중…" : `지금 발송${queuedCount ? ` (${queuedCount})` : ""}`}
            </button>
          )}
        </div>
        {runMsg && (
          <div className="note" style={{ margin: "8px 16px 0", color: "var(--ok)" }}>{runMsg}</div>
        )}
        <div className="overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>일시</th>
                <th>채널</th>
                <th>구분</th>
                <th>제목/템플릿</th>
                <th>대상</th>
                <th>진행</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {sends.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--ink3)" }}>
                    발송 이력이 없습니다.
                  </td>
                </tr>
              )}
              {sends.map((s) => {
                const st = ST[String(s.status)] ?? { ko: String(s.status ?? "-"), c: "cc-no" };
                return (
                  <tr key={String(s.id)}>
                    <td>{fmt(s.created_at)}</td>
                    <td>{CH[String(s.channel)] ?? String(s.channel ?? "-")}</td>
                    <td>{TK[String(s.target_kind)] ?? String(s.target_kind ?? "-")}</td>
                    <td className="font-semibold">{String(s.title ?? "-")}</td>
                    <td style={{ color: "var(--ink3)" }}>{Number(s.total ?? 0)}</td>
                    <td style={{ color: "var(--ink3)" }}>
                      {Number(s.sent ?? 0)}/{Number(s.total ?? 0)}
                    </td>
                    <td>
                      <span className={`cellchip ${st.c}`}>{st.ko}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 16px" }} className="note">
          모든 행의 발송 결과는 대상 브랜드의 <b>360 타임라인에 컨택 기록으로 등재</b>됩니다 —
          발송·오픈·회신이 고객 히스토리로 남습니다.
        </div>
      </div>

      <div style={{ display: "grid", alignContent: "start", ...GRID }}>
        <div className="card" style={{ borderColor: "#fca5a5" }}>
          <div className="card-hd">
            <b>발신 채널 정책 (전 직원)</b>
          </div>
          <div className="card-bd" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            ① 메일은 <b>회사 이메일(@dinostudio.kr)로만</b> 발신 — 개인 메일 사용 금지
            <br />② 문자는 <b>회사 지정 번호로만</b> — 개인 휴대폰으로 고객 연락 금지
            <br />③ 회사 채널의 <b>수신·발신 전량을 시스템이 수집</b>해 고객카드에 연결 — 개인 채널을
            쓰면 기록이 누락되고 방치 알림이 오작동
            <br />④ 위반 시 기록 공백은 담당자 책임 — 반드시 발송 센터/카드 모달로만 발송
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <b>수집 연동 상태</b>
          </div>
          <div className="card-bd" style={{ fontSize: 12 }}>
            <div className="row">
              <span className="ico i-grn">✉️</span>
              <div>
                <div className="tt">메일 발송 (Gmail 위임 / Resend)</div>
                <div className="ss">아웃바운드 발신 구성</div>
              </div>
              <div className="rt">
                <span className={`chip ${mailOk ? "grn" : ""}`}>{mailOk ? "구성됨" : "미설정"}</span>
              </div>
            </div>
            <div className="row">
              <span className="ico i-grn">📱</span>
              <div>
                <div className="tt">문자 발송 (ALIGO)</div>
                <div className="ss">아웃바운드 발신 구성</div>
              </div>
              <div className="rt">
                <span className={`chip ${smsOk ? "grn" : ""}`}>{smsOk ? "구성됨" : "미설정"}</span>
              </div>
            </div>
            <div className="note" style={{ margin: "6px 0 0", fontSize: 11 }}>
              ※ 발신(아웃바운드) 구성 여부만 표시 — 인바운드 수신 웹훅 실시간 헬스체크는 준비 중.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
