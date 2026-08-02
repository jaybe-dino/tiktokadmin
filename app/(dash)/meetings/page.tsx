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

// 저장 문자열에서 날짜/시(時)/분 직접 파싱 (타임존 변환 없이 원문 기준)
function parseSlot(s: unknown): { ymd: string; hour: number; min: string } | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return { ymd: m[1], hour: parseInt(m[2], 10), min: m[3] };
}

// "MM-DD HH:MM" 형태의 짧은 표기(원문 기준)
function shortWhen(s: unknown): string {
  const slot = parseSlot(s);
  if (!slot) return "일시 미정";
  return `${slot.ymd.slice(5)} ${String(slot.hour).padStart(2, "0")}:${slot.min}`;
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
                <div className="rt"><button className="btn sm pri">브랜드 연결</button></div>
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
