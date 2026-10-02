// 공개 행사 상세. 게시된 행사만 열린다 — 초안 slug 로 들어오면 404.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent, eventTaken } from "@/lib/seminar-events";
import {
  EVENT_STATUS_LABEL, EVENT_STATUS_TONE, applyBlockers, applyPath,
  fmtWhen, fmtWhere, isEventStatus, posterSrc, APPLY_NOT_CONFIRMED_NOTICE,
} from "@/lib/seminar-events-model";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await getPublicEvent(slug).catch(() => null);
  if (!e) return { title: "세미나 모집 — GloveK" };
  return { title: `${e.title} — GloveK 세미나`, description: e.summary || undefined };
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await getPublicEvent(slug).catch(() => null);
  if (!e) notFound();

  const taken = await eventTaken(e.id).catch(() => 0);
  const blockers = applyBlockers({
    status: e.status, publish: e.publish, apply_open: e.apply_open,
    capacity: e.capacity, taken,
  });
  const status = isEventStatus(e.status) ? e.status : "upcoming";
  const tone = TONE[EVENT_STATUS_TONE[status]];

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/events" style={S.back}>← 전체 일정</Link>
        <div style={S.card}>
          {e.poster_file_id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterSrc(e.poster_file_id)} alt={`${e.title} 포스터`} style={S.poster} />
          )}
          <div style={S.body}>
            <div style={{ ...S.chip, ...tone }}>{EVENT_STATUS_LABEL[status]}</div>
            <h1 style={S.h1}>{e.title}</h1>
            {e.summary && <p style={S.lead}>{e.summary}</p>}

            <dl style={S.meta}>
              <Row k="일시" v={fmtWhen(e)} />
              <Row k="장소" v={fmtWhere(e)} />
              {e.hosts && <Row k="주최" v={e.hosts} />}
              {e.countries && <Row k="관심 국가" v={e.countries.split(",").map((c) => c.trim()).filter(Boolean).join(" · ")} />}
              {e.capacity != null && <Row k="정원" v={`${e.capacity}명`} />}
              {e.show_online_url && e.online_url && (
                <Row k="참가 링크" v={<a href={e.online_url} target="_blank" rel="noreferrer" style={S.link}>{e.online_url}</a>} />
              )}
            </dl>

            {e.detail_md && <div style={S.detail}>{e.detail_md}</div>}

            {blockers.length === 0 ? (
              <>
                <Link href={applyPath(e.slug)} style={S.btn}>신청하기</Link>
                <p style={S.sub}>{APPLY_NOT_CONFIRMED_NOTICE}</p>
              </>
            ) : (
              <div style={S.off}>{blockers[0]}</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={S.metaRow}>
      <dt style={S.dt}>{k}</dt>
      <dd style={S.dd}>{v}</dd>
    </div>
  );
}

const TONE: Record<string, React.CSSProperties> = {
  gray: { color: "#4b5563", background: "#f1f3f5", borderColor: "#e3e6ea" },
  blue: { color: "#1d4ed8", background: "#eef4ff", borderColor: "#d6e2ff" },
  green: { color: "#117a44", background: "#eafaf1", borderColor: "#c9ecd8" },
  orange: { color: "#9a5b00", background: "#fff6e6", borderColor: "#f3e0b5" },
  red: { color: "#b02020", background: "#fff0f0", borderColor: "#f5d2d2" },
};

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0f1115", padding: "26px 16px 72px" },
  wrap: { width: "100%", maxWidth: 720, margin: "0 auto" },
  back: { display: "inline-block", color: "#9ec1ff", fontSize: 13, textDecoration: "none", marginBottom: 14 },
  card: { background: "#fff", borderRadius: 18, overflow: "hidden" },
  poster: { display: "block", width: "100%", height: "auto", background: "#f1f3f5" },
  body: { padding: "24px 22px 26px" },
  chip: { display: "inline-block", fontSize: 11, fontWeight: 800, borderRadius: 999, border: "1px solid", padding: "3px 9px" },
  h1: { fontSize: 23, fontWeight: 800, color: "#111", margin: "11px 0 10px", lineHeight: 1.35 },
  lead: { fontSize: 14.5, color: "#374151", lineHeight: 1.75, margin: "0 0 16px" },
  meta: { margin: "0 0 16px", display: "grid", gap: 7, borderTop: "1px solid #eef0f3", paddingTop: 14 },
  metaRow: { display: "flex", gap: 10, alignItems: "baseline" },
  dt: { flex: "0 0 64px", fontSize: 12, fontWeight: 700, color: "#9aa3af", margin: 0 },
  dd: { margin: 0, fontSize: 13.5, color: "#374151", lineHeight: 1.7, wordBreak: "keep-all" },
  link: { color: "#1d4ed8", wordBreak: "break-all" },
  detail: { fontSize: 13.5, color: "#374151", lineHeight: 1.85, whiteSpace: "pre-wrap", borderTop: "1px solid #eef0f3", paddingTop: 14, marginBottom: 6 },
  btn: { display: "block", textAlign: "center", background: "#111827", color: "#fff", borderRadius: 12, padding: "14px 18px", fontSize: 15, fontWeight: 800, textDecoration: "none", marginTop: 16 },
  sub: { fontSize: 11.5, color: "#9aa3af", lineHeight: 1.7, margin: "10px 0 0", textAlign: "center" },
  off: { marginTop: 16, textAlign: "center", background: "#f1f3f5", color: "#6b7280", borderRadius: 12, padding: "14px 18px", fontSize: 14, fontWeight: 700 },
};
