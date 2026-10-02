// 행사별 고정 신청 URL(/events/<slug>/apply). 게시·접수 상태를 서버에서 다시 확인한다.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent, eventTaken } from "@/lib/seminar-events";
import { applyBlockers, fmtWhen, fmtWhere, eventPath } from "@/lib/seminar-events-model";
import EventApplyForm from "./EventApplyForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await getPublicEvent(slug).catch(() => null);
  return { title: e ? `${e.title} 신청 — GloveK 세미나` : "세미나 신청 — GloveK" };
}

export default async function EventApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await getPublicEvent(slug).catch(() => null);
  if (!e) notFound();

  const taken = await eventTaken(e.id).catch(() => 0);
  const blockers = applyBlockers({
    status: e.status, publish: e.publish, apply_open: e.apply_open,
    capacity: e.capacity, taken,
  });
  if (blockers.length > 0) {
    return (
      <main style={S.page}>
        <div style={S.card}>
          <h1 style={S.h1}>{e.title}</h1>
          <p style={S.muted}>{blockers[0]}</p>
          <Link href={eventPath(e.slug)} style={S.ghost}>행사 정보 보기</Link>
        </div>
      </main>
    );
  }

  return (
    <EventApplyForm
      e={{
        slug: e.slug, title: e.title,
        when: fmtWhen(e), where: fmtWhere(e),
        countries: e.countries.split(",").map((c) => c.trim()).filter(Boolean),
      }}
    />
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0f1115", padding: "32px 16px 72px", display: "flex", justifyContent: "center" },
  card: { width: "100%", maxWidth: 560, background: "#fff", borderRadius: 18, padding: "28px 26px 26px" },
  h1: { fontSize: 21, fontWeight: 800, color: "#111", margin: "0 0 10px", lineHeight: 1.4 },
  muted: { fontSize: 14, color: "#374151", lineHeight: 1.8, margin: "0 0 14px" },
  ghost: { display: "inline-block", border: "1px solid #dfe3e8", color: "#374151", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, textDecoration: "none" },
};
