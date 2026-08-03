import { query, queryOne } from "@/lib/db";
import { CsvUploadCard, ManualRegisterCard } from "./ImportCards";

export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v ?? 0);

async function count(sql: string): Promise<number> {
  const r = await queryOne<{ c: string }>(sql).catch(() => null);
  return num(r?.c);
}
function ago(v: unknown): string {
  if (!v) return "수신 기록 없음";
  const t = new Date(v as string).getTime();
  if (Number.isNaN(t)) return "수신 기록 없음";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default async function ImportPage() {
  const NOTEST = "coalesce(is_test,false)=false";

  const [metaWeekNew, metaWeekMerged, lastMeta, campRows, groupRows] = await Promise.all([
    count(`SELECT count(*) c FROM brands WHERE ${NOTEST} AND source='meta_ads' AND created_at > now()-interval '7 days'`),
    count(
      `SELECT count(*) c FROM brand_sources s JOIN brands b ON b.id=s.brand_id
        WHERE b.source='meta_ads' AND coalesce(b.is_test,false)=false
          AND s.created_at > now()-interval '7 days'
          AND s.created_at > b.created_at + interval '1 minute'`,
    ),
    queryOne<{ created_at: string }>(
      `SELECT created_at FROM brands WHERE ${NOTEST} AND source='meta_ads' ORDER BY created_at DESC LIMIT 1`,
    ).catch(() => null),
    query<{ camp: string }>(
      `SELECT DISTINCT s.payload->'utm'->>'campaign' AS camp
         FROM brand_sources s JOIN brands b ON b.id=s.brand_id
        WHERE b.source='meta_ads' AND coalesce(b.is_test,false)=false
          AND coalesce(s.payload->'utm'->>'campaign','') <> ''
        LIMIT 5`,
    ).catch(() => [] as { camp: string }[]),
    query<{ name: string; n: string }>(
      `SELECT lead_group AS name, count(*) n FROM brands
        WHERE lead_group IS NOT NULL AND lead_group <> ''
        GROUP BY lead_group ORDER BY MAX(created_at) DESC LIMIT 20`,
    ).catch(() => [] as { name: string; n: string }[]),
  ]);

  const metaWeek = metaWeekNew + metaWeekMerged;
  const connected = Boolean(lastMeta);
  const camps = campRows.map((r) => r.camp).filter(Boolean);
  const campSummary = camps.length
    ? `${camps[0]}${camps.length > 1 ? ` 외 ${camps.length - 1}개` : ""}`
    : "캠페인 기록 없음";
  const groups = groupRows.map((g) => ({ name: String(g.name), n: num(g.n) }));
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  return (
    <div>
      <div className="ph">
        <div>
          <h1>리드 가져오기</h1>
          <p>사이트 폼을 거치지 않는 유입(광고·박람회·소개)의 3경로 — 어느 경로든 중복 판정 후 원장에 1행으로.</p>
        </div>
      </div>

      <div className="grid g3">
        {/* ① 메타 Lead Ads 자동 수신 */}
        <div className="card">
          <div className="hd">
            <b>① 메타 Lead Ads 자동 수신</b>
            <span className={`chip ${connected ? "grn" : ""}`}>{connected ? "연결됨" : "대기"}</span>
          </div>
          <div className="bd">
            <div className="kv">
              <dt>웹훅 상태</dt>
              <dd style={connected ? { color: "var(--ok)", fontWeight: 700 } : { color: "var(--ink3)" }}>
                {connected ? `● 정상 (마지막 수신 ${ago(lastMeta?.created_at)})` : "수신 대기 — 연결 시 자동 집계"}
              </dd>
              <dt>이번 주</dt>
              <dd>{metaWeek}건 수신 · 중복 {metaWeekMerged}건 병합</dd>
              <dt>캠페인</dt>
              <dd>{campSummary}</dd>
            </div>
            <hr className="hr" />
            <div className="note">수신 즉시: 원장 등록 → 사전분석 → Slack 유입 카드. UTM 자동 기록.</div>
          </div>
        </div>

        {/* ② CSV 업로드 */}
        <div className="card">
          <div className="hd"><b>② CSV 업로드</b></div>
          <div className="bd">
            <CsvUploadCard today={today} groups={groups} />
          </div>
        </div>

        {/* ③ 수동 등록 */}
        <div className="card">
          <div className="hd">
            <b>③ 수동 등록</b>
            <span style={{ color: "var(--ink3)", fontSize: "11px" }}>최소 정보 강제</span>
          </div>
          <div className="bd">
            <ManualRegisterCard today={today} groups={groups} />
          </div>
        </div>
      </div>
    </div>
  );
}
