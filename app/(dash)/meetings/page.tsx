import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = { scheduled: "예약", received: "수신", ready: "완료", unmatched: "매칭필요", no_show: "노쇼", canceled: "취소", error: "오류" };

// 상태 → 캘린더 블록 색상(.mtg.a 파랑 / .b 초록 / .c 주황)
function mtgClass(status: string): "a" | "b" | "c" {
  if (status === "ready" || status === "received") return "b";
  if (status === "no_show" || status === "canceled" || status === "error") return "c";
  return "a";
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 이번 주 월~금 (서버에서 계산)
function weekDays(): { ymd: string; label: string; isToday: boolean }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay(); // 0=일 .. 6=토
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon);
  const todayYmd = fmt(today);
  const names = ["월", "화", "수", "목", "금"];
  const out: { ymd: string; label: string; isToday: boolean }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ymd = fmt(d);
    out.push({ ymd, label: `${names[i]} ${d.getDate()}${ymd === todayYmd ? " (오늘)" : ""}`, isToday: ymd === todayYmd });
  }
  return out;
}

// 저장 문자열에서 날짜/시(時) 직접 파싱 (타임존 변환 없이 원문 기준 배치)
function parseSlot(s: unknown): { ymd: string; hour: number } | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2})/.exec(s);
  if (!m) return null;
  return { ymd: m[1], hour: parseInt(m[2], 10) };
}

const HOURS = Array.from({ length: 11 }, (_, i) => i + 9); // 09~19시

export default async function MeetingsPage() {
  const rows = (await query(
    `SELECT m.id, m.topic, m.status, m.followup_status, m.scheduled_at, m.started_at,
        b.brand_name, b.id AS brand_id
       FROM meetings m LEFT JOIN brands b ON b.id=m.brand_id
      ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC LIMIT 200`,
  ).catch(() => [])) as Record<string, unknown>[];

  const days = weekDays();
  const weekYmds = days.map((d) => d.ymd);
  const rangeLabel = weekYmds.length ? `${weekYmds[0].slice(5)} – ${weekYmds[4].slice(5)}` : "";

  // 셀 버킷: key = `${dayIdx}-${hour}`
  const cells = new Map<string, Record<string, unknown>[]>();
  for (const m of rows) {
    const slot = parseSlot(m.scheduled_at);
    if (!slot) continue;
    const dayIdx = weekYmds.indexOf(slot.ymd);
    if (dayIdx < 0) continue;
    if (slot.hour < HOURS[0] || slot.hour > HOURS[HOURS.length - 1]) continue;
    const key = `${dayIdx}-${slot.hour}`;
    const arr = cells.get(key) ?? [];
    arr.push(m);
    cells.set(key, arr);
  }
  const weekCount = [...cells.values()].reduce((n, a) => n + a.length, 0);

  return (
    <div>
      <ScreenHeader
        title="미팅 캘린더"
        desc={`총 ${rows.length}건 · 이번 주 ${weekCount}건 · Zoom 웹훅 연동 시 자동 적재`}
        right={<b style={{ fontSize: 13 }}>{rangeLabel}</b>}
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
                    const label = `${(m.brand_name as string) || "미매칭"} · ${(m.topic as string) || "미팅"}`;
                    const cls = `mtg ${mtgClass(m.status as string)}`;
                    return m.brand_id ? (
                      <Link key={m.id as string} href={`/brand/${m.brand_id}`} className={cls} title={label}>{label}</Link>
                    ) : (
                      <div key={m.id as string} className={cls} title={label}>{label}</div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 전체 목록 */}
      <div className="card overflow-x-auto" style={{ marginTop: 14 }}>
        <div className="card-hd"><b>전체 미팅</b></div>
        <div className="card-bd">
          <table className="t">
            <thead><tr><th>주제</th><th>브랜드</th><th>일시</th><th>상태</th><th>팔로업</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>미팅이 없습니다.</td></tr>}
              {rows.map((m) => (
                <tr key={m.id as string}>
                  <td className="font-semibold">{(m.topic as string) || "제목 없음"}</td>
                  <td>{m.brand_id ? <Link href={`/brand/${m.brand_id}`} className="hover:underline">{m.brand_name as string}</Link> : <span style={{ color: "var(--warn)" }}>매칭 필요</span>}</td>
                  <td style={{ color: "var(--ink3)" }}>{m.scheduled_at ? new Date(m.scheduled_at as string).toLocaleString("ko-KR") : "—"}</td>
                  <td><span className="pill chip">{ST[m.status as string] ?? (m.status as string)}</span></td>
                  <td>{m.followup_status && m.followup_status !== "none" ? <span className="pill chip-grn">{m.followup_status as string}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
