import { listTickets } from "@/lib/cs";
import { humanElapsed } from "@/lib/time";
import CsTicketActions from "./CsTicketActions";

export const dynamic = "force-dynamic";

const PRIORITY: Record<string, string> = { urgent: "긴급", high: "높음", normal: "보통", low: "낮음" };
const PRIORITY_OPTS = ["urgent", "high", "normal", "low"];
const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "미해결" },
  { value: "resolved", label: "해결됨" },
  { value: "closed", label: "종료" },
];

// CS 티켓 큐 (15 §5·§6).
export default async function CsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string }>;
}) {
  const sp = await searchParams;
  // 상태 필터: 미해결(기본, resolved/closed 제외) / resolved / closed — @/lib/cs.listTickets 경유.
  const all = await listTickets(sp.status || undefined).catch(() => []);
  // 우선순위 필터: listTickets 미지원 → 결과 배열 정제.
  const tickets = sp.priority ? all.filter((t) => t.priority === sp.priority) : all;

  const qs = (over: { status?: string; priority?: string }) => {
    const params = new URLSearchParams();
    const merged = { status: sp.status, priority: sp.priority, ...over };
    if (merged.status) params.set("status", merged.status);
    if (merged.priority) params.set("priority", merged.priority);
    const s = params.toString();
    return s ? `/cs?${s}` : "/cs";
  };

  const activeStatus = sp.status ?? "";

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold mb-1">CS 티켓</h1>
      <p className="text-sm text-muted mb-4">{tickets.length}건 · SLA 24h(긴급 4h)</p>

      {/* 상태 탭 + 우선순위 필터 */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {STATUS_TABS.map((tab) => (
          <a
            key={tab.value || "open"}
            href={qs({ status: tab.value })}
            className={`pill ${activeStatus === tab.value ? "bg-gray-900 text-white" : "bg-gray-100"}`}
          >
            {tab.label}
          </a>
        ))}
        <form method="GET" className="ml-auto flex items-center gap-2">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <select name="priority" defaultValue={sp.priority ?? ""} className="input" style={{ width: 130, height: 32 }}>
            <option value="">우선순위 전체</option>
            {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
          </select>
          <button className="btn btn-sm" type="submit">적용</button>
        </form>
      </div>

      {tickets.length === 0 ? (
        <div className="card p-6 text-sm text-muted">티켓이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => {
            const overdue = t.sla_due && !t.resolved_at && new Date(t.sla_due).getTime() < Date.now();
            return (
              <div key={t.id} className="card p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`pill ${t.priority === "urgent" ? "bg-red-100 text-bad" : "bg-gray-100"}`}>{PRIORITY[t.priority] ?? t.priority}</span>
                  <span className="font-medium">{t.subject}</span>
                  <span className="text-xs text-muted">{t.brand_name ?? "브랜드 미매칭"} · {t.channel}</span>
                  {overdue && <span className="pill bg-red-100 text-bad">SLA 초과</span>}
                  <span className="ml-auto text-xs text-muted">{humanElapsed(t.created_at)} 전</span>
                </div>
                {t.body && <p className="text-sm text-muted mt-2 line-clamp-2">{t.body}</p>}
                <CsTicketActions id={t.id} status={t.status} priority={t.priority} assignee={t.assignee} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
