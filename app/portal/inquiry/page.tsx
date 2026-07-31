import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";
import InquiryForm from "./InquiryForm";

export const dynamic = "force-dynamic";

const STATUS_KO: Record<string, string> = {
  open: "접수", in_progress: "처리중", waiting: "대기", resolved: "해결", closed: "종료",
};

// 포털 문의 (16 §2) — 문의 작성(→cs_tickets) + 이력 + FAQ.
export default async function PortalInquiry() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const tickets = await pq<{ id: string; subject: string; status: string; created_at: string }>(
    s.brand_id, "SELECT id::text, subject, status, created_at FROM cs_tickets WHERE brand_id=$1 ORDER BY created_at DESC LIMIT 20").catch(() => []);
  const faq = await pq<{ question: string; answer: string }>(
    s.brand_id, "SELECT question, answer FROM qna_entries WHERE approved AND ($1 IS NOT NULL) ORDER BY usage_count DESC LIMIT 8").catch(() => []);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>문의</h1>
      <InquiryForm />

      {tickets.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>내 문의 이력</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tickets.map((t) => (
              <div key={t.id} style={{ background: "#fff", borderRadius: 10, padding: 12, display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>{t.subject}</span>
                <span style={{ color: "#888" }}>{STATUS_KO[t.status] ?? t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {faq.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>자주 묻는 질문</h2>
          {faq.map((f, i) => (
            <details key={i} style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 14 }}>{f.question}</summary>
              <p style={{ fontSize: 13, color: "#555", marginTop: 6 }}>{f.answer}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
