import ScreenHeader from "@/components/ScreenHeader";
import { listAgentViews, recentRuns } from "@/lib/agents";
import { aiEnabled } from "@/lib/ai";
import AgentControls from "./AgentControls";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { deterministic: "규칙", ai: "AI" };

export default async function AgentsPage() {
  const [agents, runs] = await Promise.all([
    listAgentViews().catch(() => []),
    recentRuns(30).catch(() => []),
  ]);
  const ai = aiEnabled();

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="AI 에이전트"
        desc="업무 효율 자동화 — 규칙 에이전트는 즉시 동작, AI 에이전트는 ANTHROPIC_API_KEY 필요. 상태변경·발송은 제안/초안까지만(사람 승인)."
        right={<span className={`chip ${ai ? "chip-grn" : "chip-amb"}`}>{ai ? "AI 활성" : "AI 키 미설정(규칙만)"}</span>}
      />

      <div className="card mb-4">
        <div className="card-hd"><b>에이전트 {agents.length}종</b></div>
        <table className="t">
          <thead><tr><th>에이전트</th><th>종류</th><th>스케줄</th><th>최근 실행</th><th>결과</th><th>제어</th></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.key}>
                <td>
                  <div className="font-semibold">{a.label}</div>
                  <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{a.desc}</div>
                </td>
                <td><span className={`pill ${a.kind === "ai" ? "chip" : "chip-grn"}`}>{KIND_LABEL[a.kind]}</span></td>
                <td style={{ color: "var(--ink3)" }}>{a.schedule}</td>
                <td style={{ color: "var(--ink3)" }}>{a.last_run ? new Date(a.last_run).toLocaleString("ko-KR") : "—"}</td>
                <td className="text-[12px]">
                  {a.last ? <span className={a.last.status === "error" ? "text-bad" : ""}>{a.last.summary || a.last.status}</span> : "—"}
                </td>
                <td><AgentControls agentKey={a.key} enabled={a.enabled} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-hd"><b>최근 실행 로그</b></div>
        <table className="t">
          <thead><tr><th>시각</th><th>에이전트</th><th>트리거</th><th>상태</th><th>조치</th><th>요약</th></tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={6} style={{ color: "var(--ink3)" }}>실행 로그가 없습니다. [지금 실행]으로 테스트하세요.</td></tr>}
            {runs.map((r, i) => (
              <tr key={i}>
                <td style={{ color: "var(--ink3)" }}>{new Date(r.started_at).toLocaleString("ko-KR")}</td>
                <td>{r.agent}</td>
                <td><span className="pill chip">{r.triggered_by}</span></td>
                <td><span className={`pill ${r.status === "ok" ? "chip-grn" : r.status === "error" ? "chip-red" : "chip-amb"}`}>{r.status}</span></td>
                <td>{r.actions}</td>
                <td className="text-[12px]">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
