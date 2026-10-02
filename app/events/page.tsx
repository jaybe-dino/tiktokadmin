// 공개 세미나 모집 허브. 로그인 없이 열리고, 게시된 행사만 보인다.
//   초안(status='draft' 또는 publish=false)은 이 목록에 절대 나오지 않는다.
//   포스터가 없으면 임의 이미지를 만들지 않고 글자 카드로 둔다.
import Link from "next/link";
import { listPublicEvents, sevSchemaState, type SevEvent } from "@/lib/seminar-events";
import {
  EVENT_STATUS_LABEL, EVENT_STATUS_TONE, PAST_STATUSES,
  fmtWhen, fmtWhere, eventPath, applyPath, posterSrc,
  isEventStatus,
} from "@/lib/seminar-events-model";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "세미나 모집 — GloveK",
  description: "글로브K가 진행하는 틱톡샵·글로벌 진출 세미나 모집 일정입니다.",
};

export default async function EventsHubPage() {
  const schema = await sevSchemaState();
  const events = schema.ready ? await listPublicEvents().catch(() => null) : [];

  const upcoming = (events ?? []).filter((e) => !(PAST_STATUSES as readonly string[]).includes(e.status));
  const past = (events ?? []).filter((e) => (PAST_STATUSES as readonly string[]).includes(e.status));

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <header style={S.head}>
          <div style={S.badge}>GloveK SEMINAR</div>
          <h1 style={S.h1}>세미나 모집</h1>
          <p style={S.lead}>
            틱톡샵 입점·운영과 해외 진출을 다루는 세미나 일정입니다. 관심 있는 일정의 신청하기를 눌러주세요.
          </p>
        </header>

        {events === null && (
          <div style={S.note}>목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>
        )}
        {events !== null && upcoming.length === 0 && past.length === 0 && (
          <div style={S.note}>현재 공개된 모집 일정이 없습니다. 준비되는 대로 이 페이지에 올립니다.</div>
        )}

        {upcoming.length > 0 && (
          <section>
            <h2 style={S.h2}>예정된 행사</h2>
            <div style={S.grid}>{upcoming.map((e) => <EventCard key={e.id} e={e} />)}</div>
          </section>
        )}

        {past.length > 0 && (
          <section style={{ marginTop: 34 }}>
            <h2 style={S.h2}>지난 행사</h2>
            <div style={S.grid}>{past.map((e) => <EventCard key={e.id} e={e} past />)}</div>
          </section>
        )}
      </div>
    </main>
  );
}

function EventCard({ e, past }: { e: SevEvent; past?: boolean }) {
  const status = isEventStatus(e.status) ? e.status : "upcoming";
  const tone = TONE[EVENT_STATUS_TONE[status]];
  const canApply = e.apply_open && !past && status !== "closed";
  return (
    <article style={{ ...S.card, opacity: past ? 0.72 : 1 }}>
      {e.poster_file_id ? (
        // 포스터는 행사 상세로 이어지는 링크 겸 미리보기다.
        <Link href={eventPath(e.slug)} style={S.posterLink}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={posterSrc(e.poster_file_id)} alt={`${e.title} 포스터`} style={S.poster} />
        </Link>
      ) : (
        <Link href={eventPath(e.slug)} style={{ ...S.posterLink, ...S.posterBlank }}>
          <span style={S.posterBlankText}>{e.title}</span>
        </Link>
      )}
      <div style={S.cardBody}>
        <div style={{ ...S.chip, ...tone }}>{EVENT_STATUS_LABEL[status]}</div>
        <h3 style={S.cardTitle}>
          <Link href={eventPath(e.slug)} style={S.titleLink}>{e.title}</Link>
        </h3>
        <dl style={S.meta}>
          <div style={S.metaRow}><dt style={S.dt}>일시</dt><dd style={S.dd}>{fmtWhen(e)}</dd></div>
          <div style={S.metaRow}><dt style={S.dt}>장소</dt><dd style={S.dd}>{fmtWhere(e)}</dd></div>
          {e.hosts && <div style={S.metaRow}><dt style={S.dt}>주최</dt><dd style={S.dd}>{e.hosts}</dd></div>}
        </dl>
        {e.summary && <p style={S.summary}>{e.summary}</p>}
        <div style={S.actions}>
          {canApply
            ? <Link href={applyPath(e.slug)} style={S.btn}>신청하기</Link>
            : <span style={S.btnOff}>{past ? "종료된 행사" : status === "closed" ? "모집 마감" : "신청 준비 중"}</span>}
          <Link href={eventPath(e.slug)} style={S.btnGhost}>자세히</Link>
        </div>
      </div>
    </article>
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
  page: { minHeight: "100vh", background: "#0f1115", padding: "30px 16px 72px" },
  wrap: { width: "100%", maxWidth: 1040, margin: "0 auto" },
  head: { color: "#fff", marginBottom: 22 },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: ".14em", color: "#9ec1ff", background: "rgba(96,165,250,.14)", borderRadius: 999, padding: "4px 11px" },
  h1: { fontSize: 27, fontWeight: 800, margin: "12px 0 8px", lineHeight: 1.3 },
  lead: { fontSize: 14.5, color: "#aab4c5", lineHeight: 1.75, margin: 0, maxWidth: 640 },
  h2: { fontSize: 15, fontWeight: 800, color: "#dbe3ef", margin: "0 0 12px" },
  note: { background: "#fff", borderRadius: 14, padding: "18px 18px", fontSize: 14, color: "#374151", lineHeight: 1.75 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 },
  card: { background: "#fff", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column" },
  posterLink: { display: "block", textDecoration: "none" },
  // 포스터는 원본 비율 그대로 보여준다 — 임의로 잘라내면 안내 문구가 잘릴 수 있다.
  poster: { display: "block", width: "100%", height: "auto", background: "#f1f3f5" },
  posterBlank: { background: "linear-gradient(135deg,#eef2f7,#dde5f0)", minHeight: 118, display: "flex", alignItems: "center", justifyContent: "center", padding: "18px 16px" },
  posterBlankText: { fontSize: 15, fontWeight: 800, color: "#53627a", textAlign: "center", lineHeight: 1.5 },
  cardBody: { padding: "14px 16px 16px", display: "flex", flexDirection: "column", flex: 1 },
  chip: { alignSelf: "flex-start", fontSize: 11, fontWeight: 800, borderRadius: 999, border: "1px solid", padding: "3px 9px" },
  cardTitle: { fontSize: 16.5, fontWeight: 800, color: "#111", margin: "9px 0 9px", lineHeight: 1.4 },
  titleLink: { color: "inherit", textDecoration: "none" },
  meta: { margin: 0, display: "grid", gap: 4 },
  metaRow: { display: "flex", gap: 8, alignItems: "baseline" },
  dt: { flex: "0 0 34px", fontSize: 11.5, fontWeight: 700, color: "#9aa3af", margin: 0 },
  dd: { margin: 0, fontSize: 12.5, color: "#374151", lineHeight: 1.65, wordBreak: "keep-all" },
  summary: { fontSize: 12.5, color: "#6b7280", lineHeight: 1.7, margin: "10px 0 0" },
  actions: { display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" },
  btn: { flex: "1 1 120px", textAlign: "center", background: "#111827", color: "#fff", borderRadius: 10, padding: "11px 14px", fontSize: 13.5, fontWeight: 800, textDecoration: "none" },
  btnOff: { flex: "1 1 120px", textAlign: "center", background: "#f1f3f5", color: "#8d95a1", borderRadius: 10, padding: "11px 14px", fontSize: 13.5, fontWeight: 700 },
  btnGhost: { flex: "0 0 auto", textAlign: "center", border: "1px solid #dfe3e8", color: "#374151", borderRadius: 10, padding: "11px 14px", fontSize: 13.5, fontWeight: 700, textDecoration: "none" },
};
