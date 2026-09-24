import Link from "next/link";
import { notFound } from "next/navigation";
import ScreenHeader from "@/components/ScreenHeader";
import { getSeqConfig, listSeqSteps, seqDbError, type SeqStep } from "@/lib/lead-sequence";
import {
  loadSeqSends, getChannelBrief, splitLinks, extractLinks,
  channelResult, CHANNEL_RESULT_LABEL, VIEW_STATUS, viewStatusLabel, PAGE_SIZE,
  type SeqSendRow,
} from "@/lib/lead-sequence-view";
import { kstSlot } from "@/lib/lead-sequence-plan";
import { addrHash, AD_PURPOSE } from "@/lib/ad-optout";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// 유입 키별 연속 안내 "목록보기" — 조회 전용 화면.
//   ① 1~4일차에 무엇이 나가는지(현재 설정 문구·시각·링크)
//   ② 실제 대상별 예정/이력(회차·예정시각·처리시각·문자/메일 각각 결과)
//   설정 변경은 /channels 의 「📅 연속 안내」에서만 한다(여기서는 읽기만).

const KST = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }) : "—";

const TONE: Record<string, { bg: string; fg: string }> = {
  wait: { bg: "#eef2ff", fg: "#3b5bdb" },
  ok: { bg: "#e9f8ef", fg: "#0b7a52" },
  warn: { bg: "#fff4e6", fg: "#c25400" },
  bad: { bg: "#fff5f5", fg: "#c92a2a" },
  off: { bg: "#f1f3f5", fg: "#6b7280" },
};
// 수단별 표시 색 — 대기는 파랑(처리 전), 성공 초록, 실패 빨강, 나머지 회색.
const chColor = (r: string): string =>
  r === "failed" ? "#c92a2a" : r === "sent" ? "#0b7a52" : r === "pending" ? "#3b5bdb" : "var(--ink3)";

const toneOf = (k: string) => TONE[VIEW_STATUS.find((s) => s.key === k)?.tone ?? "off"] ?? TONE.off;

/** 본문 — 줄바꿈 유지 + 링크 클릭 가능 + 길면 제한 높이 안에서 스크롤. */
function Body({ text, max = 260 }: { text: string; max?: number }) {
  if (!text.trim()) return <div style={{ color: "#c92a2a", fontSize: 12 }}>문구가 비어 있습니다 — 이 회차는 발송되지 않습니다.</div>;
  return (
    <div style={{
      maxHeight: max, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
      fontSize: 12.5, lineHeight: 1.7, background: "var(--card)", border: "1px solid var(--line)",
      borderRadius: 8, padding: "10px 12px",
    }}>
      {splitLinks(text).map((p, i) =>
        p.t === "link"
          ? <a key={i} href={p.v} target="_blank" rel="noreferrer" style={{ color: "#1971c2", textDecoration: "underline", wordBreak: "break-all" }}>{p.v}</a>
          : <span key={i}>{p.v}</span>)}
    </div>
  );
}

function StepCard({ step, baseHour, open }: { step: SeqStep; baseHour: number; open: boolean }) {
  const hour = step.send_hour ?? baseHour;
  const links = [...new Set([...extractLinks(step.email_body), ...extractLinks(step.sms_body)])];
  const smsOn = step.send_sms && step.sms_body.trim().length > 0;
  const mailOn = step.send_email && step.email_body.trim().length > 0;
  return (
    <details className="card" open={open} data-testid={`step-${step.day_no}`} style={{ padding: 0 }}>
      {/* 접힌 상태에서도 회차·시각·제목·문자/메일 ON 은 보인다 — 4회차를 한눈에 비교. */}
      <summary style={{ listStyle: "none", cursor: "pointer", padding: "10px 14px", display: "grid", gap: 4 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b>유입 {step.day_no}일차</b>
          <span className="pill" style={{ fontSize: 10 }}>유입일 +{step.day_no}일 · KST {hour}시</span>
          {!step.enabled && <span className="pill" style={{ fontSize: 10, background: "#f1f3f5", color: "#6b7280" }}>회차 꺼짐</span>}
          <span className="pill" style={{ fontSize: 10, background: smsOn ? "#e9f8ef" : "#f1f3f5", color: smsOn ? "#0b7a52" : "#6b7280" }}>문자 {smsOn ? "ON" : "—"}</span>
          <span className="pill" style={{ fontSize: 10, background: mailOn ? "#e9f8ef" : "#f1f3f5", color: mailOn ? "#0b7a52" : "#6b7280" }}>메일 {mailOn ? "ON" : "—"}</span>
          {links.length > 0 && <span className="pill" style={{ fontSize: 10 }}>링크 {links.length}</span>}
          <span className="btn btn-sm" style={{ marginLeft: "auto" }}>내용보기</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink2)", wordBreak: "break-word" }}>
          {step.email_subject.trim() || <span style={{ color: "#c92a2a" }}>메일 제목 없음</span>}
        </div>
      </summary>

      <div className="bd" style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 3 }}>메일 본문</div>
          <Body text={step.email_body} max={300} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 3 }}>문자 본문 <span>({step.sms_body.length}자)</span></div>
          <Body text={step.sms_body} max={200} />
        </div>
        {links.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 3 }}>이 회차에 들어간 링크 {links.length}개</div>
            <div style={{ display: "grid", gap: 3 }}>
              {links.map((l) => (
                <a key={l} href={l} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11.5, color: "#1971c2", wordBreak: "break-all" }}>
                  {l.includes("scheduler.zoom.us") ? "📅 상담 예약 · " : "📖 자료 · "}{l}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function Who({ r }: { r: SeqSendRow }) {
  const name = r.brand_name?.trim();
  return (
    <div style={{ minWidth: 140 }}>
      <Link href={`/brand/${r.brand_id}`} style={{ fontWeight: 600 }}>
        {name || <span style={{ color: "var(--ink3)", fontWeight: 400 }}>(브랜드명 없음)</span>}
      </Link>
      <div style={{ fontSize: 10.5, color: "var(--ink3)" }}>
        {[r.contact_name, r.email, r.phone].filter(Boolean).join(" · ") || "연락처 없음"}
      </div>
    </div>
  );
}

export default async function ChannelSequenceListPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; page?: string; open?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const ch = await getChannelBrief(id).catch(() => null);
  if (!ch) notFound();

  // 설정·회차 문구 — 조회 실패를 빈 값으로 숨기지 않는다.
  let cfg = null, steps: SeqStep[] = [], stepErr = "";
  try {
    cfg = await getSeqConfig(id);
    steps = await listSeqSteps(id, cfg.days);
  } catch (e) { stepErr = seqDbError(e); }

  const sends = await loadSeqSends(id, { status: sp.status, page: sp.page ? Number(sp.page) : 1 });

  // 이 페이지에 나온 대상들의 광고 수신거부 상태(수단별) — 조회 실패는 표시하지 않고 넘어간다.
  const optOut = new Map<string, { kind: string; at: string }[]>();
  if (sends.ok && sends.data.rows.length > 0) {
    const byHash = new Map<string, string[]>();   // 해시 → brand_id 들
    for (const r of sends.data.rows) {
      for (const [kind, addr] of [["email", r.email], ["phone", r.phone]] as const) {
        const h = addrHash(kind, addr ?? "");
        if (!h) continue;
        byHash.set(h, [...(byHash.get(h) ?? []), r.brand_id]);
      }
    }
    if (byHash.size > 0) {
      const rows = await query<{ kind: string; addr_hash: string; opted_out_at: string }>(
        `SELECT kind, addr_hash, opted_out_at::text AS opted_out_at FROM ad_optouts
          WHERE purpose=$1 AND addr_hash = ANY($2::text[])`,
        [AD_PURPOSE, [...byHash.keys()]]).catch(() => []);
      for (const o of rows) {
        for (const bid of byHash.get(o.addr_hash) ?? []) {
          optOut.set(bid, [...(optOut.get(bid) ?? []), { kind: o.kind, at: o.opted_out_at }]);
        }
      }
    }
  }
  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status: sp.status, page: sp.page, open: sp.open, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/channels/${id}/sequence${s ? `?${s}` : ""}`;
  };

  const counts = sends.ok ? sends.data.counts : {};
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  // 예시 예정표 — 오늘 유입 기준(실제 예약이 아니라 설명용).
  const sample = cfg ? steps.map((s) => ({ d: s.day_no, at: kstSlot(new Date(), s.day_no, s.send_hour ?? cfg!.hour) })) : [];

  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title={`${ch.name} — 연속 안내 목록`}
        desc={`유입 소스 「${ch.source}」 · 조회 전용 화면입니다(여기서는 발송·수정하지 않습니다)`}
        right={<Link href="/channels" className="btn btn-sm">← 유입 소스·자동발송</Link>}
      />

      {/* 설정 요약 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="hd" style={{ gap: 8, flexWrap: "wrap" }}>
          <b>발송 구성</b>
          {cfg && (
            <>
              <span className={`chip ${cfg.enabled ? "chip-grn" : "chip-amb"}`}>{cfg.enabled ? "연속 안내 ON" : "OFF"}</span>
              <span className="pill" style={{ fontSize: 10 }}>1~{cfg.days}일차</span>
              <span className="pill" style={{ fontSize: 10 }}>기본 KST {cfg.hour}시</span>
              <span className="pill" style={{ fontSize: 10 }}>{cfg.stopOnProgress ? "단계 진전 시 중단" : "단계 진전에도 계속"}</span>
            </>
          )}
          {ch.test_mode && <span className="pill" style={{ fontSize: 10, background: "#fff4e6", color: "#c25400" }}>🧪 테스트 모드 — 실제 발송 안 함</span>}
          <Link href="/channels" className="btn btn-sm" style={{ marginLeft: "auto" }}>설정 편집 →</Link>
        </div>
        <div className="bd" style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.7 }}>
          유입 <b>다음 날부터</b> 하루 한 회차씩 보냅니다. 유입 즉시 1회 안내는 이 화면이 아니라
          키의 <b>「✏️ 내용」</b>(1회성 자동안내)이 담당합니다.
          {sample.length > 0 && (
            <div style={{ marginTop: 4 }}>
              오늘 유입된다면 → {sample.map((s) => `${s.d}일차 ${KST(s.at.toISOString())}`).join(" / ")}
            </div>
          )}
        </div>
      </div>

      {/* ① 회차별 문구 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 6px" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>회차별 발송 내용</span>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>「내용보기」로 각 회차를 펼칩니다</span>
        <Link href={qs({ open: sp.open === "1" ? undefined : "1" })} className="btn btn-sm" data-testid="toggle-all-steps">
          {sp.open === "1" ? "모두 접기" : "모두 펼치기"}
        </Link>
        <a href="#targets" className="btn btn-sm btn-primary" data-testid="goto-targets" style={{ marginLeft: "auto" }}>
          대상 목록 바로가기 ↓{sends.ok ? ` (${totalAll}건)` : ""}
        </a>
      </div>
      <div className="note" style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.6 }}>
        아래는 <b>지금 저장된 설정값</b>입니다. 발송 당시 본문을 따로 보관하지 않으므로,
        이미 나간 건의 <b>실제 발송 내용과 다를 수 있습니다</b>(문구를 나중에 고친 경우). 실제 발송본이 아닌 <b>현재 설정 참고용</b>입니다.
      </div>
      {stepErr ? (
        <div className="card" style={{ padding: 14, borderColor: "#f3b8b8", background: "#fff5f5", color: "#c92a2a", fontSize: 12.5 }}>
          <b>회차 문구를 불러오지 못했습니다</b>
          <div style={{ marginTop: 4, wordBreak: "break-all" }}>{stepErr}</div>
        </div>
      ) : steps.length === 0 ? (
        <div className="card" style={{ padding: 14, fontSize: 12.5, color: "var(--ink3)" }}>설정된 회차가 없습니다.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {steps.map((s) => <StepCard key={s.day_no} step={s} baseHour={cfg?.hour ?? 10} open={sp.open === "1"} />)}
        </div>
      )}

      {/* ② 대상별 예정·이력 */}
      <div id="targets" style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 6px", scrollMarginTop: 12 }}>
        대상별 예정 · 발송 이력 {sends.ok && <span style={{ fontWeight: 400, color: "var(--ink3)" }}>· 전체 {totalAll}건</span>}
      </div>

      {sends.ok && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <Link href={qs({ status: undefined, page: undefined })}
            className={`pill ${!sp.status ? "chip-grn" : ""}`} style={{ fontSize: 11, border: "1px solid var(--line)" }}>
            전체 {totalAll}
          </Link>
          {VIEW_STATUS.map((s) => (
            <Link key={s.key} href={qs({ status: s.key, page: undefined })}
              className={`pill ${sp.status === s.key ? "chip-grn" : ""}`}
              title={s.desc} style={{ fontSize: 11, border: "1px solid var(--line)" }}>
              {s.label} {counts[s.key] ?? 0}
            </Link>
          ))}
        </div>
      )}

      {!sends.ok ? (
        <div className="card" style={{ padding: 14, borderColor: "#f3b8b8", background: "#fff5f5", color: "#c92a2a", fontSize: 12.5 }}>
          <b>목록을 불러오지 못했습니다</b>
          <div style={{ marginTop: 4, wordBreak: "break-all" }}>{sends.error}</div>
          <div style={{ marginTop: 4, color: "#a04040" }}>빈 목록이 아니라 <b>조회 실패</b>입니다 — 원인을 해결한 뒤 새로고침해 주세요.</div>
        </div>
      ) : sends.data.total === 0 ? (
        <div className="card" style={{ padding: 14, fontSize: 12.5, color: "var(--ink3)" }}>
          {totalAll === 0
            ? "이 키로 예약된 안내가 아직 없습니다 — 연속 안내를 켠 뒤 새로 들어온 리드부터 예약됩니다(기존 리드는 소급 예약하지 않습니다)."
            : `「${viewStatusLabel(sp.status ?? "")}」 상태인 건이 없습니다.`}
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 12, width: "100%" }}>
              <thead>
                <tr>
                  <th>대상</th><th>회차</th><th>예정(KST)</th><th>처리(KST)</th>
                  <th>문자</th><th>메일</th><th>상태</th><th>비고</th>
                </tr>
              </thead>
              <tbody>
                {sends.data.rows.map((r) => {
                  const sms = channelResult("sms", r);
                  const mail = channelResult("email", r);
                  const t = toneOf(r.view_status);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Who r={r} />
                        {(optOut.get(r.brand_id) ?? []).length > 0 && (
                          <div data-testid="ad-optout-flag" style={{ fontSize: 10, color: "#c25400", marginTop: 2 }}>
                            🚫 광고 수신거부 · {[...new Set((optOut.get(r.brand_id) ?? []).map((o) => (o.kind === "email" ? "메일" : "문자")))].join("·")}
                            {" "}{KST((optOut.get(r.brand_id) ?? [])[0].at).slice(0, 16)}
                          </div>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.day_no}일차</td>
                      <td style={{ whiteSpace: "nowrap" }}>{KST(r.due_at)}</td>
                      <td style={{ whiteSpace: "nowrap", color: r.sent_at ? undefined : "var(--ink3)" }}>{KST(r.sent_at)}</td>
                      <td style={{ whiteSpace: "nowrap", color: chColor(sms) }}>{CHANNEL_RESULT_LABEL[sms]}</td>
                      <td style={{ whiteSpace: "nowrap", color: chColor(mail) }}>{CHANNEL_RESULT_LABEL[mail]}</td>
                      <td><span className="pill" style={{ fontSize: 10, background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>{viewStatusLabel(r.view_status)}</span></td>
                      <td style={{ color: "var(--ink3)", maxWidth: 220, wordBreak: "break-word" }}>{r.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", fontSize: 11.5, color: "var(--ink3)" }}>
            <span>
              {(sends.data.page - 1) * PAGE_SIZE + 1}–{Math.min(sends.data.page * PAGE_SIZE, sends.data.total)} / {sends.data.total}건
            {sp.status === "queued" ? " · 가까운 예정 순" : " · 최근 순"}
              {sends.data.pages > 1 ? ` · ${sends.data.page}/${sends.data.pages} 쪽` : ""}
            </span>
            {sends.data.pages > 1 && (
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {sends.data.page > 1 && <Link href={qs({ page: sends.data.page - 1 })} className="btn btn-sm">‹ 이전</Link>}
                {sends.data.page < sends.data.pages && <Link href={qs({ page: sends.data.page + 1 })} className="btn btn-sm">다음 ›</Link>}
              </span>
            )}
          </div>
        </>
      )}

      <div className="note" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.7 }}>
        · <b>발송 대기</b>는 <b>아직 처리 전</b>이라는 뜻입니다 — 제외된 것이 아니며, 예정 시각이 되면 처리됩니다.
        실제로 무엇이 나갈지는 처리 시점의 설정·연락처에 따라 정해지므로 여기서 미리 단정하지 않습니다.<br />
        · <b>발송(접수)</b>은 문자·메일이 <b>공급자(알리고·Resend)에 접수</b>된 상태입니다. 수신자가 실제로 받았는지(도달·열람)는 확인하지 않습니다.<br />
        · 한쪽만 나간 건은 <b>부분 실패</b>로 따로 표시합니다 — 완료로 뭉뚱그리지 않습니다.<br />
        · <b>대상 아님</b>은 <b>처리했으나</b> 그 수단이 대상이 아니었다는 뜻입니다(회차에서 껐거나 연락처·문구 없음). 처리 전 대기와 다릅니다.<br />
        · <b>중단</b>은 처리 전에 취소된 건입니다(단계 진전·수신거부·드랍 등). 사유는 비고에 있습니다.<br />
        · 이 화면에서는 발송·재발송·취소를 하지 않습니다. 남은 회차 중단은 /channels 의 「📅 연속 안내」에서 합니다.
      </div>
    </div>
  );
}
