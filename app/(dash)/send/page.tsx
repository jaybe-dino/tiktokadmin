import ScreenHeader from "@/components/ScreenHeader";
import { allBulkSends } from "@/lib/repo/global";
import { smsRemain } from "@/lib/sms";
import SmsSender from "@/components/SmsSender";

export const dynamic = "force-dynamic";

const TK: Record<string, string> = { lead_group: "리드 그룹", filter: "필터 조합", manual: "직접 선택" };
const CH: Record<string, string> = { email: "✉️ 메일", sms: "📱 문자", both: "메일+문자" };
const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "chip-amb" }, queued: { ko: "대기", c: "chip" }, sending: { ko: "발송중", c: "chip" },
  done: { ko: "완료", c: "chip-grn" }, canceled: { ko: "취소", c: "chip-red" },
};

export default async function SendPage() {
  const rows = (await allBulkSends().catch(() => [])) as Record<string, unknown>[];
  const remain = await smsRemain().catch(() => ({ ok: false, message: "" as string }));
  return (
    <div>
      <ScreenHeader title="발송 센터" desc="대량·개별 메일/문자 — 수신동의 자동 필터 · 발송 후 카드 기록" />

      <div className="grid gap-3.5 mb-4" style={{ gridTemplateColumns: "1fr 340px" }}>
        <div>
          {remain.ok && (
            <div className="grid grid-cols-3 gap-3.5 mb-3.5">
              <div className="tile"><div className="tile-k">SMS 잔여</div><div className="tile-v">{(remain as { sms?: number }).sms ?? 0}</div></div>
              <div className="tile"><div className="tile-k">LMS 잔여</div><div className="tile-v">{(remain as { lms?: number }).lms ?? 0}</div></div>
              <div className="tile"><div className="tile-k">MMS 잔여</div><div className="tile-v">{(remain as { mms?: number }).mms ?? 0}</div></div>
            </div>
          )}
          {!remain.ok && <div className="note mb-3.5">Aligo 문자 잔여건수 미표시 — ALIGO_API_KEY·ALIGO_USER_ID·ALIGO_SENDER 환경변수 설정 후 표시됩니다.</div>}
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
        <SmsSender />
      </div>
    </div>
  );
}
