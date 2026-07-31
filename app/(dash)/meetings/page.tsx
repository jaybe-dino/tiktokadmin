import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allMeetings } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = { scheduled: "예약", received: "수신", ready: "완료", unmatched: "매칭필요", no_show: "노쇼", canceled: "취소", error: "오류" };

export default async function MeetingsPage() {
  const rows = (await allMeetings().catch(() => [])) as Record<string, unknown>[];
  return (
    <div>
      <ScreenHeader title="미팅 캘린더" desc={`총 ${rows.length}건 · Zoom 웹훅 연동 시 자동 적재`} />
      <div className="card overflow-x-auto">
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
                <td>{m.followup_status !== "none" ? <span className="pill chip-grn">{m.followup_status as string}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
