import Link from "next/link";
import { CsvImportForm, ManualAddForm } from "@/components/ImportForms";
import { query, queryOne } from "@/lib/db";
import { SOURCE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
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
function fmtDate(v: unknown): string {
  if (!v) return "—";
  try {
    return new Date(v as string).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export default async function ImportPage() {
  const NOTEST = "coalesce(is_test,false)=false";

  const [weekTotal, adWeek, adTotal] = await Promise.all([
    count(`SELECT count(*) c FROM brands WHERE ${NOTEST} AND created_at > now()-interval '7 days'`),
    count(`SELECT count(*) c FROM brands WHERE ${NOTEST} AND source IN ('meta_ads','expo','referrer') AND created_at > now()-interval '7 days'`),
    count(`SELECT count(*) c FROM brands WHERE ${NOTEST} AND source IN ('meta_ads','expo','referrer')`),
  ]);

  const lastAd = await queryOne<{ created_at: string }>(
    `SELECT created_at FROM brands WHERE ${NOTEST} AND source IN ('meta_ads','expo','referrer') ORDER BY created_at DESC LIMIT 1`,
  ).catch(() => null);

  const srcRows = (await query<{ source: string; c: string }>(
    `SELECT source, count(*) c FROM brands WHERE ${NOTEST} AND created_at > now()-interval '7 days' GROUP BY source ORDER BY c DESC`,
  ).catch(() => [])) as { source: string; c: string }[];

  const recent = (await query(
    `SELECT id, brand_name, source, contact_name, created_at
       FROM brands WHERE ${NOTEST}
      ORDER BY created_at DESC LIMIT 8`,
  ).catch(() => [])) as Row[];

  const srcSummary = srcRows.length
    ? srcRows.slice(0, 3).map((r) => `${SOURCE_LABELS[r.source] ?? r.source ?? "기타"} ${num(r.c)}건`).join(" · ")
    : "이번 주 유입 없음";

  return (
    <div>
      <div className="ph">
        <div>
          <h1>리드 가져오기</h1>
          <p>사이트 폼을 거치지 않는 유입(광고·박람회·소개)의 3경로 — 어느 경로든 중복 판정 후 원장에 1행으로. 같은 이메일/전화/사업자번호는 자동 병합됩니다.</p>
        </div>
      </div>

      <div className="grid g3">
        {/* ① 광고·자동 유입 현황 */}
        <div className="card">
          <div className="hd">
            <b>① 광고·자동 유입</b>
            <span className={`chip ${adTotal > 0 ? "grn" : ""}`}>{adTotal > 0 ? "유입 있음" : "대기"}</span>
          </div>
          <div className="bd">
            <div className="kv">
              <dt>마지막 수신</dt>
              <dd style={lastAd ? { color: "var(--ok)", fontWeight: 700 } : { color: "var(--ink3)" }}>
                {lastAd ? `● ${ago(lastAd.created_at)}` : "수신 기록 없음"}
              </dd>
              <dt>이번 주</dt>
              <dd>{adWeek}건 (광고·박람회·소개)</dd>
              <dt>누적</dt>
              <dd>{adTotal}건</dd>
              <dt>이번 주 경로</dt>
              <dd>{srcSummary}</dd>
            </div>
            <hr className="hr" />
            <div className="note">수신 즉시: 원장 등록 → 사전분석 → Slack 유입 카드. UTM 자동 기록. 메타 Lead Ads 웹훅 연결 시 이 카드로 자동 집계됩니다.</div>
          </div>
        </div>

        {/* ② CSV 업로드 */}
        <div className="card">
          <div className="hd"><b>② CSV 업로드 (대량)</b></div>
          <div className="bd">
            <CsvImportForm />
            <div className="note" style={{ marginTop: "10px" }}>
              업로드 후 <b>미리보기 → 중복 병합 → 반영</b>. 파일해시+행번호 멱등키로 재업로드 안전. 이 그룹은 <b>발송 센터</b>의 대량 메일·문자 대상으로 바로 선택할 수 있어요.
            </div>
          </div>
        </div>

        {/* ③ 수동 등록 */}
        <div className="card">
          <div className="hd">
            <b>③ 수동 등록</b>
            <span style={{ color: "var(--ink3)", fontSize: "11px" }}>최소 정보 강제</span>
          </div>
          <div className="bd">
            <ManualAddForm />
          </div>
        </div>
      </div>

      {/* 가드레일 */}
      <div className="card" style={{ marginTop: "14px", borderColor: "#fecaca" }}>
        <div className="hd" style={{ background: "linear-gradient(90deg,#fff7f7,#fff)" }}>
          <b>🛡️ 등록 이후 가드레일 — 리드는 등록되는 순간부터 감시됩니다</b>
          <div className="rt">
            <Link className="btn sm" href="/queue">워크큐 →</Link>
            <Link className="btn sm" href="/monitor">SLA 모니터 →</Link>
          </div>
        </div>
        <div className="bd">
          <div className="grid g4">
            <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: 800, color: "var(--acc)" }}>STEP 0 · 등록 즉시 (자동)</div>
              <div style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.6 }}>중복 판정 → 원장 1행 → <b>사전분석 브리프</b> → Slack 유입 카드 → <b>SLA 타이머 시작</b></div>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: 800, color: "var(--warn)" }}>당일 · 담당 수락</div>
              <div style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.6 }}>배정 카드에서 수락 — 미수락 리드는 <b>다음날 아침 에이전트가 전원 앞에서 지적</b></div>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: 800, color: "var(--warn)" }}>48시간 · 첫 컨택</div>
              <div style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.6 }}>컨택 기록이 없으면 <b>T1 — 매일 담당 DM 반복</b> · 기록해야만 타이머 리셋</div>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: 800, color: "var(--danger)" }}>7일 · 방치 차단</div>
              <div style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.6 }}><b>T2 파트장 채널</b> → +5일 T3 대표 적색 목록 · 미전환 30일+는 캠페인·윈백 세그먼트로 자동 편입</div>
            </div>
          </div>
          <div className="note" style={{ marginTop: "10px" }}>결론: <b>어떤 리드도 조용히 사라질 수 없습니다.</b> CSV로 대량 등록해도 전 건이 이 사다리를 각자 탑니다 — 담당자가 할 일은 "수락"과 "컨택 기록" 두 가지뿐이고, 나머지 추적은 시스템이 합니다.</div>
        </div>
      </div>

      {/* 최근 가져온 리드 (실데이터) */}
      <div className="card" style={{ marginTop: "14px" }}>
        <div className="hd">
          <b>최근 가져온 리드</b>
          <span className="chip">최근 7일 {weekTotal}건</span>
        </div>
        <div className="bd">
          {recent.length === 0 ? (
            <div className="note">아직 가져온 리드가 없습니다. 위 3경로 중 하나로 등록하면 여기 표시됩니다.</div>
          ) : (
            recent.map((r) => (
              <div className="row" key={String(r.id)}>
                <span className="ico i-blu">🧾</span>
                <div>
                  <div className="tt">
                    <Link href={`/brand/${String(r.id)}`}>{String(r.brand_name ?? "(이름 없음)")}</Link>
                  </div>
                  <div className="ss">
                    {SOURCE_LABELS[String(r.source ?? "")] ?? String(r.source ?? "기타")}
                    {r.contact_name ? ` · ${String(r.contact_name)}` : ""} · {fmtDate(r.created_at)}
                  </div>
                </div>
                <div className="rt">
                  <Link className="btn sm" href={`/brand/${String(r.id)}`}>360 →</Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
