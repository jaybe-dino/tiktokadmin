import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { query } from "@/lib/db";
import ConnectBrand from "./ConnectBrand";
import MeetingEditor, { type CalendarMeeting } from "./MeetingEditor";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = { scheduled: "예약", received: "수신", ready: "완료", unmatched: "매칭필요", no_show: "노쇼", canceled: "취소", error: "오류" };

// 상태 → 캘린더 블록 색상(.mtg.a 파랑 / .b 초록 / .c 주황)
function mtgClass(status: string): "a" | "b" | "c" {
  if (status === "ready" || status === "received") return "b";
  if (status === "no_show" || status === "canceled" || status === "error") return "c";
  return "a";
}

// UTC 자정 Date(달력날짜 표현)를 YYYY-MM-DD 로. (요일·주간 계산은 KST 달력날짜를 UTC 로 다룬다.)
function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// 저장 문자열에서 날짜/시(時)/분 직접 파싱 (타임존 변환 없이 원문 기준)
// 타임존 안전 — timestamptz 문자열을 KST 기준 달력날짜·시각으로 변환한다.
//   (서버/DB 세션 TZ 가 UTC 여도 항상 한국시간 기준으로 배치·표시. sales#8)
const _kstFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
function parseSlot(s: unknown): { ymd: string; hour: number; min: string } | null {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const part of _kstFmt.formatToParts(d)) p[part.type] = part.value;
  if (!p.year) return null;
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0; // en-CA 는 자정을 24 로 줄 수 있음
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour, min: p.minute };
}

// "MM-DD HH:MM" 형태의 짧은 표기(원문 기준)
function shortWhen(s: unknown): string {
  const slot = parseSlot(s);
  if (!slot) return "일시 미정";
  return `${slot.ymd.slice(5)} ${String(slot.hour).padStart(2, "0")}:${slot.min}`;
}

// 이번 주 월~금 (서버에서 계산)
function weekDays(): { ymd: string; label: string; isToday: boolean }[] {
  // KST 기준 '오늘' 달력날짜를 UTC 자정 Date 로 표현(요일·날짜 산술은 UTC 로).
  const [ty, tm, td] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).split("-").map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, td));
  const dow = today.getUTCDay(); // 0=일 .. 6=토
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setUTCDate(today.getUTCDate() + diffToMon);
  const todayYmd = fmt(today);
  const names = ["월", "화", "수", "목", "금"];
  const out: { ymd: string; label: string; isToday: boolean }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + i);
    const ymd = fmt(d);
    out.push({ ymd, label: `${names[i]} ${d.getUTCDate()}${ymd === todayYmd ? " (오늘)" : ""}`, isToday: ymd === todayYmd });
  }
  return out;
}

const HOURS = Array.from({ length: 11 }, (_, i) => i + 9); // 09~19시

export default async function MeetingsPage() {
  // 지정인(호스트) 이름 + 참석자·줌링크(0019)까지 조회 — 캘린더 블록·수정 레이어에 사용.
  const rows = (await query(
    `SELECT m.id, m.topic, m.status, m.followup_status, m.scheduled_at, m.started_at,
        m.host_email, m.zoom_join_url, m.attendees,
        b.brand_name, b.id AS brand_id, hu.name AS host_name
       FROM meetings m
       LEFT JOIN brands b ON b.id=m.brand_id
       LEFT JOIN LATERAL (
         SELECT au.name FROM admin_users au
          WHERE au.id = m.host_email
             OR (au.zoom_email IS NOT NULL AND m.host_email IS NOT NULL
                 AND lower(au.zoom_email) = lower(m.host_email))
          LIMIT 1
       ) hu ON true
      ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC LIMIT 200`,
  ).catch(() => [])) as Record<string, unknown>[];

  // 매칭 필요 미팅의 브랜드 연결용 옵션(존재하는 브랜드만).
  const brandOptions = (await query(
    `SELECT id, brand_name FROM brands ORDER BY brand_name ASC LIMIT 500`,
  ).catch(() => [])) as { id: string; brand_name: string }[];
  const brandList = brandOptions.map((b) => ({ id: b.id, name: b.brand_name || "(이름 없음)" }));

  const days = weekDays();
  const weekYmds = days.map((d) => d.ymd);
  const rangeLabel = weekYmds.length ? `${weekYmds[0].slice(5)} – ${weekYmds[4].slice(5)}` : "";

  // 셀 버킷: key = `${dayIdx}-${hour}`
  const cells = new Map<string, Record<string, unknown>[]>();
  // 그리드(월~금·09~19시) 밖이라 셀에 안 들어가는 예약 미팅 — 사라지지 않게 별도 목록으로. (sales#9)
  const offGrid: { m: Record<string, unknown>; slot: { ymd: string; hour: number; min: string } }[] = [];
  for (const m of rows) {
    const slot = parseSlot(m.scheduled_at);
    if (!slot) continue;
    const dayIdx = weekYmds.indexOf(slot.ymd);
    const inHours = slot.hour >= HOURS[0] && slot.hour <= HOURS[HOURS.length - 1];
    if (dayIdx < 0 || !inHours) {
      // 예약/수신 등 유효 상태이면서 이번 주 그리드 밖(주말·시간외·다음 주 등)만 별도 노출.
      if (m.status === "scheduled" || m.status === "received" || m.status === "ready") {
        offGrid.push({ m, slot });
      }
      continue;
    }
    const key = `${dayIdx}-${slot.hour}`;
    const arr = cells.get(key) ?? [];
    arr.push(m);
    cells.set(key, arr);
  }
  const weekCount = [...cells.values()].reduce((n, a) => n + a.length, 0);
  offGrid.sort((a, b) => String(a.m.scheduled_at).localeCompare(String(b.m.scheduled_at)));

  // 하단 3분할 카드용 파생 목록 (실데이터 기반)
  const pipeline = rows
    .filter((m) => m.status === "received" || m.status === "ready" || (m.followup_status && m.followup_status !== "none"))
    .slice(0, 6);
  const unmatched = rows.filter((m) => !m.brand_id || m.status === "unmatched").slice(0, 6);
  const noshow = rows.filter((m) => m.status === "no_show" || m.status === "canceled" || m.status === "error").slice(0, 6);

  return (
    <div>
      <ScreenHeader
        title="미팅 캘린더"
        desc="줌 예약이 잡히는 순간 자동 등록 · 호스트→담당 매핑 · D-1 리마인더 · 노쇼 감지"
        right={
          <div className="bar" style={{ margin: 0 }}>
            <b style={{ fontSize: 13 }}>{rangeLabel}</b>
            <span style={{ color: "var(--ink3)", fontSize: 12 }}>이번 주 {weekCount}건 · 총 {rows.length}건</span>
          </div>
        }
      />

      {/* 주간 캘린더 그리드 */}
      <div className="cal">
        <div className="h" style={{ borderLeft: "none" }}></div>
        {days.map((d) => (
          <div key={d.ymd} className="h" style={d.isToday ? { color: "var(--acc)" } : undefined}>{d.label}</div>
        ))}
        {HOURS.map((h) => (
          <div key={`row-${h}`} style={{ display: "contents" }}>
            <div className="tm">{String(h).padStart(2, "0")}:00</div>
            {days.map((d, dayIdx) => {
              const items = cells.get(`${dayIdx}-${h}`) ?? [];
              return (
                <div key={`${d.ymd}-${h}`} className="c">
                  {items.map((m) => {
                    // 지정인(호스트)별 표시 유지 + 클릭 시 참석자·일시 수정 레이어.
                    const meeting: CalendarMeeting = {
                      id: m.id as string,
                      topic: (m.topic as string) || "",
                      status: m.status as string,
                      brand_id: (m.brand_id as string) ?? null,
                      brand_name: (m.brand_name as string) ?? null,
                      scheduled_at: (m.scheduled_at as string) ?? null,
                      host_email: (m.host_email as string) ?? null,
                      host_name: (m.host_name as string) ?? null,
                      zoom_join_url: (m.zoom_join_url as string) ?? null,
                      attendees: (m.attendees as { name?: string; email: string }[]) ?? [],
                    };
                    return (
                      <MeetingEditor
                        key={m.id as string}
                        meeting={meeting}
                        cls={`mtg ${mtgClass(m.status as string)}`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 그리드 밖(주말·시간외·다음 주 등) 예약 미팅 — 캘린더에서 누락되지 않도록 별도 노출 */}
      {offGrid.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="hd">
            <b>그리드 밖 미팅 {offGrid.length}건</b>
            <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: 6 }}>주말·09~19시 외·다른 주 예약</span>
          </div>
          <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {offGrid.map(({ m, slot }) => (
              <div key={m.id as string} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                <span className="pill" style={{ fontVariantNumeric: "tabular-nums" }}>{slot.ymd} {String(slot.hour).padStart(2, "0")}:{slot.min}</span>
                <b>{(m.brand_name as string) || (m.topic as string) || "(미지정)"}</b>
                <span style={{ color: "var(--ink3)" }}>{ST[m.status as string] ?? (m.status as string)}</span>
                {m.brand_id ? <Link href={`/brand/${m.brand_id}`} style={{ color: "var(--acc)", marginLeft: "auto" }}>열기 →</Link> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 하단 3분할: 처리 파이프라인 · 매칭 필요 · 노쇼·취소 */}
      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="hd"><b>처리 파이프라인</b></div>
          <div className="bd" style={{ fontSize: 12 }}>
            {pipeline.length === 0 && <div style={{ color: "var(--ink3)" }}>처리 중인 미팅이 없습니다.</div>}
            {pipeline.map((m) => {
              const done = m.status === "ready";
              const tt = `${(m.brand_name as string) || "미매칭"} (${shortWhen(m.scheduled_at)})`;
              const ss = done
                ? "전사→요약→접촉기록 완료 · 팔로업 승인 대기"
                : `요약 처리 중 · 상태: ${ST[m.status as string] ?? (m.status as string)}`;
              const inner = (
                <>
                  <span className={`ico ${done ? "i-grn" : "i-pur"}`}>{done ? "✅" : "⏳"}</span>
                  <div>
                    <div className="tt">{tt}</div>
                    <div className="ss">{ss}</div>
                  </div>
                </>
              );
              return m.brand_id ? (
                <Link key={m.id as string} href={`/brand/${m.brand_id}`} className="row" style={{ textDecoration: "none", color: "inherit" }}>{inner}</Link>
              ) : (
                <div key={m.id as string} className="row">{inner}</div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="hd"><b>매칭 필요</b>{unmatched.length > 0 && <span className="chip red">{unmatched.length}</span>}</div>
          <div className="bd" style={{ fontSize: 12 }}>
            {unmatched.length === 0 && <div style={{ color: "var(--ink3)" }}>매칭이 필요한 미팅이 없습니다.</div>}
            {unmatched.map((m) => (
              <div key={m.id as string} className="row">
                <span className="ico i-red">❓</span>
                <div>
                  <div className="tt">{(m.topic as string) || "제목 없음"}</div>
                  <div className="ss">{shortWhen(m.scheduled_at)} · 참가자 이메일이 원장에 없음 — 수동 연결 필요</div>
                </div>
                <div className="rt"><ConnectBrand meetingId={m.id as string} brands={brandList} /></div>
              </div>
            ))}
            {unmatched.length > 0 && <div className="note">토픽에 [브랜드명]을 넣으면 자동 매칭률이 올라갑니다</div>}
          </div>
        </div>

        <div className="card">
          <div className="hd"><b>노쇼·취소</b>{noshow.length > 0 && <span className="chip amb">{noshow.length}</span>}</div>
          <div className="bd" style={{ fontSize: 12 }}>
            {noshow.length === 0 && <div style={{ color: "var(--ink3)" }}>노쇼·취소된 미팅이 없습니다.</div>}
            {noshow.map((m) => (
              <div key={m.id as string} className="row">
                <span className="ico i-amb">🚫</span>
                <div>
                  <div className="tt">{(m.brand_name as string) || "미매칭"} — {ST[m.status as string] ?? (m.status as string)}</div>
                  <div className="ss">{shortWhen(m.scheduled_at)} · 24h 녹화 미수신 자동 감지 → 재예약 메일 발송</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
