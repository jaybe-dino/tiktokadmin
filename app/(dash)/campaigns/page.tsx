import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { query } from "@/lib/db";
import CampaignActions from "./CampaignActions";

export const dynamic = "force-dynamic";

// ── 인라인 카운트 헬퍼 (테이블 미적용 시에도 0 반환) ──
async function countBrands(where: string): Promise<number> {
  const rows = (await query(
    `SELECT count(*)::int AS c FROM brands WHERE ${where}`,
  ).catch(() => [])) as Record<string, unknown>[];
  return Number(rows[0]?.c ?? 0);
}

function initial(name?: string | null): string {
  const s = (name ?? "").trim();
  return s ? s.slice(0, 1) : "·";
}

function shortDate(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s ? s.slice(0, 10) : "—";
}

// 발송 이력 상태 라벨
const SEND_ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "chip-amb" },
  queued: { ko: "예약", c: "chip" },
  sending: { ko: "발송중", c: "chip" },
  done: { ko: "완료", c: "chip-grn" },
  canceled: { ko: "취소", c: "chip-red" },
};
const SEND_CH: Record<string, string> = { email: "✉️ 메일", sms: "📱 문자", both: "메일+문자" };
const SEND_TK: Record<string, string> = { lead_group: "리드 그룹", filter: "필터 조합", manual: "직접 선택" };

export default async function CampaignsPage() {
  const [dropped, seminarStale, countryExpand, pastDue, consentRow, winbackRows, sends] =
    await Promise.all([
      // 세그먼트 카운트
      countBrands("state = 'dropped'"),
      countBrands("state = 'seminar' AND stage_entered_at < now() - interval '90 days'"),
      countBrands(
        "state IN ('live_mall','live_onboarding') AND coalesce(array_length(countries,1),0) BETWEEN 1 AND 2",
      ),
      countBrands("pay_status = 'past_due'"),
      // 수신동의 집계 (brand_contacts.marketing_consent)
      query(
        `SELECT count(*) FILTER (WHERE marketing_consent IS TRUE)::int  AS agree,
                count(*) FILTER (WHERE marketing_consent IS FALSE)::int AS deny
           FROM brand_contacts`,
      ).catch(() => [] as Record<string, unknown>[]),
      // 윈백 리스트 (드랍 → 재접촉 예정)
      query(
        `SELECT b.id, b.brand_name, b.memo, b.next_action, b.due_date, b.stage_entered_at,
                b.owner_sales, au.name AS owner_name
           FROM brands b
      LEFT JOIN admin_users au ON au.id = b.owner_sales
          WHERE b.state = 'dropped'
       ORDER BY b.stage_entered_at DESC
          LIMIT 12`,
      ).catch(() => [] as Record<string, unknown>[]),
      // 최근 대량 발송 이력
      query(
        `SELECT id, title, target_kind, channel, status, total, sent, excluded_optout,
                scheduled_at, created_at
           FROM bulk_sends
       ORDER BY created_at DESC
          LIMIT 12`,
      ).catch(() => [] as Record<string, unknown>[]),
    ]);

  const consent = (consentRow as Record<string, unknown>[])[0] ?? {};
  const agree = Number(consent.agree ?? 0);
  const deny = Number(consent.deny ?? 0);
  const wb = winbackRows as Record<string, unknown>[];
  const sendRows = sends as Record<string, unknown>[];

  const segs = [
    {
      key: "winback",
      title: "윈백 — 드랍(예산·보류)",
      sub: "드랍 사유 기반 자동 편성",
      count: dropped,
      cycle: "분기",
      perf: "오픈 42% · 재미팅 2건",
      next: "9/1",
      action: "초안 보기",
      primary: false,
    },
    {
      key: "seminar",
      title: "세미나 미전환 90일+",
      sub: "세미나 신청 후 90일+ 무진행",
      count: seminarStale,
      cycle: "매월 첫 주",
      perf: "오픈 38% · 상담 5건",
      next: "8/4",
      action: "발송",
      primary: true,
    },
    {
      key: "expand",
      title: "운영중 국가추가 후보",
      sub: "운영 중 · 1~2개국 운영",
      count: countryExpand,
      cycle: "분기",
      perf: "제안 3 · 수주 1",
      next: "8/15",
      action: "초안 보기",
      primary: false,
    },
    {
      key: "pastdue",
      title: "past_due 재접촉",
      sub: "결제 연체 · 재결제 유도",
      count: pastDue,
      cycle: "케이스별",
      perf: "—",
      next: "담당 판단",
      action: "발송",
      primary: true,
    },
  ];

  return (
    <div>
      <ScreenHeader
        title="캠페인·윈백"
        desc="수신동의 기반 · 드랍·미전환·확장 후보를 세그먼트로 묶어 정기 재접촉 — AI가 초안, 발송은 승인"
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm">+ 세그먼트</button>
            <button className="btn btn-sm btn-primary">캠페인 초안 생성 (AI)</button>
          </div>
        }
      />

      {/* 수신동의 필터 바 */}
      <div className="bar">
        <span className="chip grn">수신동의 {agree.toLocaleString("ko-KR")}</span>
        <span className="chip red">수신거부 {deny.toLocaleString("ko-KR")} — 발송 자동 제외</span>
        <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: 11.5 }}>
          동의·거부는 설문·메일 하단 링크에서 자동 동기
        </span>
      </div>

      <div className="grid g31 gap-3.5">
        {/* 메인 컬럼 */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* 세그먼트 4종 */}
          <div className="card overflow-x-auto">
            <div className="hd">
              <b>세그먼트 4종</b>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th>세그먼트</th>
                  <th>대상</th>
                  <th>주기</th>
                  <th>최근 발송 성과</th>
                  <th>다음 발송</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {segs.map((s) => (
                  <tr key={s.key}>
                    <td>
                      <b>{s.title}</b>
                      <span className="sub">{s.sub}</span>
                    </td>
                    <td>{s.count}</td>
                    <td>{s.cycle}</td>
                    <td style={{ color: "var(--ink3)" }}>{s.perf}</td>
                    <td>{s.next}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <CampaignActions segment={s.key} channel="email" primary={s.primary} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 윈백 리스트 */}
          <div className="card overflow-x-auto">
            <div className="hd">
              <b>윈백 리스트 (재접촉 예정)</b>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th>브랜드</th>
                  <th>드랍 사유 / 메모</th>
                  <th>드랍일</th>
                  <th>재접촉 예정</th>
                  <th>담당</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {wb.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--ink3)" }}>
                      드랍·보류 브랜드가 없습니다.
                    </td>
                  </tr>
                )}
                {wb.map((r) => {
                  const reason =
                    (r.next_action as string) || (r.memo as string) || "사유 미기재";
                  const ownerName = (r.owner_name as string) || (r.owner_sales as string) || "";
                  return (
                    <tr key={r.id as string}>
                      <td>
                        <Link href={`/brand/${r.id as string}`}>
                          <b>{r.brand_name as string}</b>
                        </Link>
                      </td>
                      <td style={{ color: "var(--ink3)" }}>
                        {reason.length > 40 ? reason.slice(0, 40) + "…" : reason}
                      </td>
                      <td>{shortDate(r.stage_entered_at)}</td>
                      <td>{r.due_date ? shortDate(r.due_date) : "담당 판단"}</td>
                      <td>
                        {ownerName ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span className="av">{initial(ownerName)}</span>
                            {ownerName}
                          </span>
                        ) : (
                          <span style={{ color: "var(--ink3)" }}>미배정</span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-sm">메모</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="note" style={{ margin: "8px 16px 14px" }}>
              드랍 승인 시 사유·재접촉 시점이 자동 등록 — 시점 도래 시 담당 워크큐에 올라옵니다.
              재유입하면 같은 원장 행이 되살아나 이력이 이어집니다.
            </div>
          </div>

          {/* 최근 대량 발송 이력 */}
          <div className="card overflow-x-auto">
            <div className="hd">
              <b>최근 발송 이력</b>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>대상</th>
                  <th>채널</th>
                  <th>진행</th>
                  <th>제외(거부)</th>
                  <th>상태</th>
                  <th>일시</th>
                </tr>
              </thead>
              <tbody>
                {sendRows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--ink3)" }}>
                      발송 이력이 없습니다.
                    </td>
                  </tr>
                )}
                {sendRows.map((s) => {
                  const st = SEND_ST[s.status as string] ?? { ko: s.status as string, c: "" };
                  return (
                    <tr key={s.id as string}>
                      <td className="font-semibold">{s.title as string}</td>
                      <td>{SEND_TK[s.target_kind as string] ?? (s.target_kind as string)}</td>
                      <td>{SEND_CH[s.channel as string] ?? (s.channel as string)}</td>
                      <td style={{ color: "var(--ink3)" }}>
                        {(s.sent as number) ?? 0}/{(s.total as number) ?? 0}
                      </td>
                      <td style={{ color: "var(--ink3)" }}>{(s.excluded_optout as number) ?? 0}</td>
                      <td>
                        <span className={`pill ${st.c}`}>{st.ko}</span>
                      </td>
                      <td style={{ color: "var(--ink3)" }}>
                        {shortDate(s.scheduled_at ?? s.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 사이드 컬럼 */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd">
              <b>발송 규칙</b>
            </div>
            <div className="bd" style={{ fontSize: 12, lineHeight: 1.7 }}>
              수신동의자에게만 발송(거부는 즉시 제외) · AI가 세그먼트별 초안 생성 → 마케팅 담당
              승인 → 발송 · 오픈·클릭·회신이 브랜드 카드 타임라인에 기록되어 재점화 감지.
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <b>승인 대기 캠페인</b>
              <span className="chip amb" style={{ marginLeft: 8 }}>
                1
              </span>
            </div>
            <div className="bd" style={{ fontSize: 12 }}>
              <div className="row">
                <span className="ico i-pur">✉️</span>
                <div>
                  <div className="tt">8월 세미나 안내 (세미나 미전환 {seminarStale}명)</div>
                  <div className="ss">AI 초안 · 개인화: 참석 세미나 주제 · 발송 8/4 09:00</div>
                </div>
                <div className="rt">
                  <button className="btn btn-sm btn-primary">승인·예약</button>
                </div>
              </div>
            </div>
          </div>

          <div className="note">
            수신동의 필터: 모든 발송 대상에서 <b>marketing_consent = false</b> 연락처는 자동
            제외됩니다. 동의 미확인(NULL)은 발송 전 확인 대상으로 분류됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}
