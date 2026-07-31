import { listTickets } from "@/lib/cs";
import { humanElapsed } from "@/lib/time";

export const dynamic = "force-dynamic";

const PRIORITY: Record<string, string> = { urgent: "긴급", high: "높음", normal: "보통", low: "낮음" };

// CS 티켓 큐 (15 §5·§6).
export default async function CsPage() {
  const tickets = await listTickets().catch(() => []);
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold mb-1">CS 티켓</h1>
      <p className="text-sm text-muted mb-4">미해결 {tickets.length}건 · SLA 24h(긴급 4h)</p>

      {tickets.length === 0 ? (
        <div className="card p-6 text-sm text-muted">미해결 티켓이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => {
            const overdue = t.sla_due && new Date(t.sla_due).getTime() < Date.now();
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
