// 브랜드별 대화 타임라인 — PM 이 "무엇을 근거로 판단했는지"를 되짚을 수 있어야 한다.
//   원칙:
//     · 세 가지를 따로 말한다 — (a) DB 조회 가능 여부 (b) 자동 수집 설정 여부 (c) 실제 최근 수신.
//       SQL 이 성공했다는 것은 (a)뿐이다. 그것만으로 "외부 수집 연결됨"이라 적지 않는다.
//       설정을 확인할 수 없으면 "수집 상태 미확인"이다.
//     · 대화 없음 / 조회 실패 / 수집 미연결을 절대 섞지 않는다.
//     · 100% 추적이라고 적지 않는다.
//     · 페이지 처리·검색은 DB 에서 한다(UNION + COUNT + OFFSET) — JS 로 잘라 과거를 숨기지 않는다.
//     · 검색은 본문 전체를 대상으로 한다(미리보기 400자가 아니다).
//     · 본문은 고객·외부가 쓴 비신뢰 자료다. 지시문으로 해석하지 않고 그대로 보여주기만 한다.
import { query, queryOne } from "./db";

export type CommChannel = "email" | "email_linked" | "meeting" | "meeting_note" | "note" | "comment" | "manual" | "slack" | "kakao";

/** (a) DB 에서 읽을 수 있는지. */
export type QueryState = "ok" | "error" | "absent";
/** (b) 자동 수집(외부 연동) 설정 상태. */
export type IngestState =
  | "configured"      // 외부 수집이 설정돼 있다
  | "off"             // 외부 수집이 꺼져 있다
  | "unknown"         // 설정을 확인하지 못했다 — "연결됨"이라 말할 수 없다
  | "internal"        // 외부 수집 개념이 없는 내부 기록(사람이 직접 남긴다)
  | "none";           // 자동 수집 경로가 아예 없다(수동 등록만)

export interface ChannelStatus {
  channel: CommChannel;
  label: string;
  query: QueryState;
  queryNote: string;
  ingest: IngestState;
  ingestNote: string;
  /** 이 채널의 건수 — query!=='ok' 면 null(0 과 구분). */
  count: number | null;
  /** 실제 최근 수신 시각 — query!=='ok' 면 null. */
  latestAt: string | null;
}

export interface CommItem {
  id: string;
  channel: CommChannel;
  channelLabel: string;
  occurredAt: string;
  direction: "in" | "out" | "internal" | "unknown";
  author: string;
  title: string;
  /** 목록용 미리보기. 전체 본문은 bodyFull 로 펼친다. */
  preview: string;
  /** 원문 전체(권한 확인을 통과한 조회에서만 담긴다). 링크가 없는 기록도 이걸로 확인한다. */
  bodyFull: string;
  hasMore: boolean;
  sourceUrl: string | null;
  sourceLabel: string;
}

export interface CommTimeline {
  items: CommItem[];
  channels: ChannelStatus[];
  /** 검색 조건을 적용한 전체 건수(DB COUNT). */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** 조회 실패 채널이 하나라도 있으면 true. */
  partial: boolean;
  /** 수집 설정을 확인하지 못한 채널이 있으면 true. */
  ingestUnknown: boolean;
  rangeNote: string;
}

export const PM_COMMS_PAGE_SIZE = 25;
const PREVIEW_LEN = 400;

const CH_LABEL: Record<CommChannel, string> = {
  email: "이메일(Gmail 수집)", email_linked: "이메일(수기 연결)", meeting: "Zoom 회의 전사",
  meeting_note: "회의록(사람 작성)", note: "내부 기록", comment: "협업 코멘트",
  manual: "수동 등록 대화", slack: "Slack", kakao: "카카오톡",
};

/**
 * 채널별 원본 SQL 조각 — 공통 모양으로 맞춘다.
 *   컬럼: id, occurred_at, direction, author, title, body, source_url, source_label
 *   ※ 조각은 코드에 고정돼 있고 외부 입력이 섞이지 않는다(파라미터만 바인딩).
 */
interface SourceDef {
  channel: CommChannel;
  /** 이 채널이 없으면(마이그레이션 미적용) absent 로 처리한다. */
  table: string;
  sql: string;
}

const SOURCES: SourceDef[] = [
  {
    channel: "email", table: "email_messages",
    // 수기 연결(brand_emails)과 같은 메일은 한 번만 — message_id 로 중복 제거.
    sql: `SELECT 'email-' || m.id::text AS id, m.sent_at AS occurred_at,
                 CASE WHEN m.direction IN ('in','out') THEN m.direction ELSE 'unknown' END AS direction,
                 COALESCE(m.from_addr,'') AS author,
                 COALESCE(NULLIF(m.subject,''),'(제목 없음)') AS title,
                 COALESCE(NULLIF(m.body_text,''), COALESCE(m.snippet,'')) AS body,
                 CASE WHEN m.gmail_msg_id <> '' THEN 'https://mail.google.com/mail/u/0/#all/' || m.gmail_msg_id END AS source_url,
                 'Gmail 수집(email_messages)' AS source_label
            FROM email_messages m
           WHERE m.brand_id = $1
             AND NOT EXISTS (SELECT 1 FROM brand_emails be
                              WHERE be.brand_id = m.brand_id AND be.message_id = m.gmail_msg_id)`,
  },
  {
    channel: "email_linked", table: "brand_emails",
    sql: `SELECT 'elink-' || e.id::text AS id, e.occurred_at,
                 e.direction,
                 COALESCE(e.from_addr,'') AS author,
                 COALESCE(NULLIF(e.subject,''),'(제목 없음)') AS title,
                 COALESCE(e.snippet,'') AS body,
                 CASE WHEN COALESCE(e.message_id,'') <> '' THEN 'https://mail.google.com/mail/u/0/#all/' || e.message_id END AS source_url,
                 '수기 연결 메일(brand_emails)' AS source_label
            FROM brand_emails e WHERE e.brand_id = $1`,
  },
  {
    channel: "meeting", table: "meetings",
    sql: `SELECT 'meeting-' || t.id::text AS id, COALESCE(t.started_at, t.created_at) AS occurred_at,
                 'internal' AS direction, COALESCE(t.host_email,'') AS author,
                 COALESCE(NULLIF(t.topic,''),'(제목 없음)') AS title,
                 COALESCE(NULLIF(t.transcript,''), COALESCE(t.summary_md,'')) AS body,
                 NULLIF(t.recording_share_url,'') AS source_url,
                 CASE WHEN COALESCE(t.transcript,'') <> '' THEN 'Zoom 전사(meetings.transcript)'
                      WHEN COALESCE(t.summary_md,'') <> '' THEN 'Zoom 회의 요약(원문 아님)'
                      ELSE 'Zoom 회의(전사·요약 없음)' END AS source_label
            FROM meetings t WHERE t.brand_id = $1`,
  },
  {
    channel: "meeting_note", table: "meeting_notes",
    sql: `SELECT 'mnote-' || n.id::text AS id, (n.note_date::timestamptz + interval '9 hours') AS occurred_at,
                 'internal' AS direction, COALESCE(n.created_by,'') AS author,
                 COALESCE(NULLIF(n.title,''),'회의록') AS title,
                 n.body AS body, NULLIF(n.file_url,'') AS source_url,
                 '사람이 작성한 회의록(meeting_notes)' AS source_label
            FROM meeting_notes n WHERE n.brand_id = $1`,
  },
  {
    channel: "note", table: "brand_sources",
    sql: `SELECT 'note-' || s.id::text AS id, s.occurred_at,
                 'internal' AS direction,
                 COALESCE(s.payload->>'by','') AS author,
                 CASE WHEN s.event = 'contact_logged'
                        THEN '접촉 기록' || COALESCE(' · ' || (s.payload->>'channel'), '')
                      ELSE '내부 메모' END AS title,
                 COALESCE(s.payload->>'text', s.payload->>'note', '') AS body,
                 NULLIF(s.source_url,'') AS source_url,
                 '내부 기록(brand_sources · ' || s.site || ')' AS source_label
            FROM brand_sources s
           WHERE s.brand_id = $1 AND s.event IN ('note','memo','contact_logged')`,
  },
  {
    channel: "comment", table: "comments",
    sql: `SELECT 'cmt-' || c.id::text AS id, c.created_at AS occurred_at,
                 'internal' AS direction, c.author, '협업 코멘트' AS title,
                 c.body, NULL::text AS source_url, '브랜드360 코멘트(comments)' AS source_label
            FROM comments c WHERE c.brand_id = $1`,
  },
  {
    channel: "manual", table: "pm_manual_comms",
    sql: `SELECT 'manual-' || p.id::text AS id, p.occurred_at,
                 'unknown' AS direction, p.author,
                 COALESCE(NULLIF(p.source_label,''),'수동 등록 대화') AS title,
                 p.body, NULLIF(p.source_url,'') AS source_url,
                 '사람이 등록한 원문(' || p.channel || ')' AS source_label
            FROM pm_manual_comms p WHERE p.brand_id = $1`,
  },
];

/** 이 표가 실제로 있는지 — 없으면 absent(마이그레이션 미적용)로 구분한다. */
async function tablesPresent(names: string[]): Promise<Set<string>> {
  const rows = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])`, [names]);
  return new Set(rows.map((r) => r.table_name));
}

/** 자동 수집 설정 상태 — 환경설정을 읽을 수 없으면 unknown 이다. */
async function ingestStates(): Promise<Record<CommChannel, { state: IngestState; note: string }>> {
  const base: Record<CommChannel, { state: IngestState; note: string }> = {
    email: { state: "unknown", note: "수집 상태 미확인" },
    email_linked: { state: "internal", note: "사람이 브랜드에 연결한 메일" },
    meeting: { state: "unknown", note: "수집 상태 미확인" },
    meeting_note: { state: "internal", note: "사람이 직접 작성" },
    note: { state: "internal", note: "내부 기록" },
    comment: { state: "internal", note: "내부 협업 기록" },
    manual: { state: "internal", note: "사람이 등록한 원문" },
    slack: { state: "none", note: "자동 수집 경로가 없습니다 — 원문 수동 등록만 가능합니다." },
    kakao: { state: "none", note: "자동 수집 경로가 없습니다 — 원문 수동 등록만 가능합니다." },
  };

  // 메일: Gmail 서비스계정 + 동기화 켠 계정이 있어야 수집된다.
  try {
    const { env } = await import("./env");
    const hasSa = Boolean(env.gmail.saKeyJson);
    const on = await queryOne<{ n: string }>(
      "SELECT count(*)::text n FROM admin_users WHERE COALESCE(gmail_sync_enabled,false) = true AND active");
    const cnt = Number(on?.n ?? 0);
    base.email = hasSa && cnt > 0
      ? { state: "configured", note: `Gmail 수집 설정됨 · 동기화 계정 ${cnt}명` }
      : { state: "off", note: hasSa ? "Gmail 동기화를 켠 계정이 없습니다" : "Gmail 서비스계정(GOOGLE_SA_KEY_JSON) 미설정" };
  } catch (e) {
    base.email = { state: "unknown", note: `수집 상태 미확인 — ${(e as Error).message.slice(0, 100)}` };
  }

  // 회의: Zoom 웹훅 시크릿이 있어야 녹화·전사 이벤트가 들어온다.
  try {
    const { env } = await import("./env");
    base.meeting = env.zoom.webhookSecret
      ? { state: "configured", note: "Zoom 웹훅 시크릿 설정됨" }
      : { state: "off", note: "ZOOM_WEBHOOK_SECRET 미설정 — 녹화·전사 웹훅이 거부됩니다" };
  } catch (e) {
    base.meeting = { state: "unknown", note: `수집 상태 미확인 — ${(e as Error).message.slice(0, 100)}` };
  }

  return base;
}

interface RawRow {
  id: string; occurred_at: string; direction: string; author: string;
  title: string; body: string; source_url: string | null; source_label: string;
}

/**
 * 브랜드의 대화를 DB 에서 직접 페이지 처리해 가져온다.
 *   · 채널별 상태(조회/수집/최근성)를 따로 계산한다.
 *   · 검색은 제목·작성자·본문 전체를 대상으로 한다(ILIKE).
 *   · 조회 실패한 채널은 UNION 에서 빼고 "확인 실패"로 표시한다 — 나머지는 계속 보여준다.
 *   ※ 호출 전에 브랜드 접근 권한을 반드시 확인해야 한다(pm-access.brandAccess).
 */
export async function brandCommTimeline(brandId: string, opts: {
  q?: string; page?: number; pageSize?: number; channels?: CommChannel[];
} = {}): Promise<CommTimeline> {
  const pageSize = Math.max(5, Math.min(200, opts.pageSize ?? PM_COMMS_PAGE_SIZE));
  const q = (opts.q ?? "").trim();
  const like = q ? `%${q}%` : null;

  const present = await tablesPresent(SOURCES.map((s) => s.table)).catch(() => null);
  const ingest = await ingestStates();

  const wanted = opts.channels && opts.channels.length
    ? SOURCES.filter((s) => opts.channels!.includes(s.channel))
    : SOURCES;

  // 채널별 건수·최근 시각 — 각각 따로 물어 실패를 격리한다.
  const stats = new Map<CommChannel, { query: QueryState; queryNote: string; count: number | null; latestAt: string | null }>();
  const usable: SourceDef[] = [];
  for (const s of SOURCES) {
    if (present && !present.has(s.table)) {
      stats.set(s.channel, { query: "absent", queryNote: `표(${s.table})가 없습니다 — 마이그레이션 미적용`, count: null, latestAt: null });
      continue;
    }
    try {
      const r = await queryOne<{ n: string; latest: string | null }>(
        `SELECT count(*)::text AS n, max(occurred_at)::text AS latest FROM (${s.sql}) x`, [brandId]);
      stats.set(s.channel, { query: "ok", queryNote: "", count: Number(r?.n ?? 0), latestAt: r?.latest ?? null });
      if (wanted.some((w) => w.channel === s.channel)) usable.push(s);
    } catch (e) {
      stats.set(s.channel, {
        query: "error", queryNote: `조회 실패 — ${(e as Error).message.slice(0, 140)}`, count: null, latestAt: null,
      });
    }
  }

  let items: CommItem[] = [];
  let total = 0;
  let unionError: string | null = null;

  if (usable.length > 0) {
    const union = usable.map((s) => `(${s.sql})`).join("\n UNION ALL \n");
    const search = like
      ? `WHERE (u.title ILIKE $2 OR u.body ILIKE $2 OR u.author ILIKE $2 OR u.source_label ILIKE $2)`
      : "";
    try {
      const cnt = await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM (${union}) u ${search}`, like ? [brandId, like] : [brandId]);
      total = Number(cnt?.n ?? 0);

      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(Math.max(1, opts.page ?? 1), pageCount);
      const off = (page - 1) * pageSize;
      const args: unknown[] = like ? [brandId, like, pageSize, off] : [brandId, pageSize, off];
      const rows = await query<RawRow>(
        `SELECT u.id, u.occurred_at::text AS occurred_at, u.direction, u.author, u.title,
                u.body, u.source_url, u.source_label
           FROM (${union}) u ${search}
          ORDER BY u.occurred_at DESC NULLS LAST, u.id DESC
          LIMIT ${like ? "$3" : "$2"} OFFSET ${like ? "$4" : "$3"}`, args);

      items = rows.map((r) => {
        const body = (r.body ?? "").trim();
        const flat = body.replace(/\s+/g, " ");
        const ch = (r.id.split("-")[0] ?? "") as string;
        const channel: CommChannel =
          ch === "email" ? "email" : ch === "elink" ? "email_linked" : ch === "meeting" ? "meeting"
          : ch === "mnote" ? "meeting_note" : ch === "note" ? "note" : ch === "cmt" ? "comment" : "manual";
        return {
          id: r.id, channel, channelLabel: CH_LABEL[channel],
          occurredAt: r.occurred_at,
          direction: (["in", "out", "internal"].includes(r.direction) ? r.direction : "unknown") as CommItem["direction"],
          author: r.author ?? "",
          title: r.title ?? "",
          preview: flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN)}…` : flat,
          bodyFull: body,
          hasMore: flat.length > PREVIEW_LEN,
          sourceUrl: r.source_url,
          sourceLabel: r.source_label,
        };
      });
    } catch (e) {
      unionError = (e as Error).message.slice(0, 160);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pageCount);

  const channels: ChannelStatus[] = [
    ...SOURCES.map((s): ChannelStatus => {
      const st = stats.get(s.channel)!;
      const ing = ingest[s.channel];
      return {
        channel: s.channel, label: CH_LABEL[s.channel],
        query: st.query, queryNote: st.queryNote || (st.count === 0 ? "조회됨 · 기록된 대화 없음" : ""),
        ingest: ing.state, ingestNote: ing.note,
        count: st.count, latestAt: st.latestAt,
      };
    }),
    ...(["slack", "kakao"] as const).map((c): ChannelStatus => ({
      channel: c, label: CH_LABEL[c], query: "absent", queryNote: "저장된 대화가 없습니다",
      ingest: ingest[c].state, ingestNote: ingest[c].note, count: null, latestAt: null,
    })),
  ];

  const partial = channels.some((c) => c.query === "error") || Boolean(unionError);
  const ingestUnknown = channels.some((c) => c.ingest === "unknown");
  const noteParts = [
    `조회 가능 ${channels.filter((c) => c.query === "ok").length}채널`,
    `자동 수집 설정됨 ${channels.filter((c) => c.ingest === "configured").length}`,
    `수집 미연결 ${channels.filter((c) => c.ingest === "none").length}`,
  ];
  if (ingestUnknown) noteParts.push(`수집 상태 미확인 ${channels.filter((c) => c.ingest === "unknown").length}`);
  if (channels.some((c) => c.query === "error")) noteParts.push(`조회 실패 ${channels.filter((c) => c.query === "error").length}`);
  if (unionError) noteParts.push(`목록 조회 실패 — ${unionError}`);
  noteParts.push("전 기간 대상(페이지 처리는 DB에서 수행)");

  return {
    items, channels, total, page, pageSize, pageCount,
    partial, ingestUnknown,
    rangeNote: noteParts.join(" · "),
  };
}
