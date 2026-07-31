import ScreenHeader from "@/components/ScreenHeader";
import { allBulkSends } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const TK: Record<string, string> = { lead_group: "리드 그룹", filter: "필터 조합", manual: "직접 선택" };
const CH: Record<string, string> = { email: "✉️ 메일", sms: "📱 문자", both: "메일+문자" };
const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "chip-amb" }, queued: { ko: "대기", c: "chip" }, sending: { ko: "발송중", c: "chip" },
  done: { ko: "완료", c: "chip-grn" }, canceled: { ko: "취소", c: "chip-red" },
};

export default async function SendPage() {
  const rows = (await allBulkSends().catch(() => [])) as Record<string, unknown>[];
  return (
    <div>
      <ScreenHeader title="발송 센터" desc="대량·개별 메일/문자 — 수신동의 자동 필터 · 발송 후 카드 기록" />
      <div className="card overflow-x-auto">
        <table className="t">
          <thead><tr><th>제목</th><th>대상</th><th>채널</th><th>진행</th><th>상태</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>발송 이력이 없습니다.</td></tr>}
            {rows.map((s) => (
              <tr key={s.id as string}>
                <td className="font-semibold">{s.title as string}</td>
                <td>{TK[s.target_kind as string] ?? (s.target_kind as string)}</td>
                <td>{CH[s.channel as string] ?? (s.channel as string)}</td>
                <td style={{ color: "var(--ink3)" }}>{(s.sent as number) ?? 0}/{(s.total as number) ?? 0}</td>
                <td><span className={`pill ${ST[s.status as string]?.c ?? ""}`}>{ST[s.status as string]?.ko ?? (s.status as string)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
