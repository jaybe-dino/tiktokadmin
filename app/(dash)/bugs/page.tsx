import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { listBugReports, BUG_STATUS } from "@/lib/bug-reports";
import BugManage from "./BugManage";

export const dynamic = "force-dynamic";

const ST = Object.fromEntries(BUG_STATUS.map((s) => [s.key, s]));

function fmt(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default async function BugsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const reports = await listBugReports(status);
  const counts = await listBugReports("all");
  const openN = counts.filter((r) => r.status === "open").length;

  return (
    <div>
      <ScreenHeader
        title="기능오류 제보"
        desc={`화면 우하단 '기능오류 제보' 버튼으로 수집 — 스크린샷·URL·브라우저 정보 포함. 신규 ${openN}건 · 전체 ${counts.length}건`}
      />

      <div className="bar" style={{ marginBottom: 12, gap: 6 }}>
        {[{ k: "open", l: "신규" }, { k: "triaged", l: "확인" }, { k: "in_progress", l: "진행중" }, { k: "resolved", l: "해결" }, { k: "wontfix", l: "보류" }, { k: "all", l: "전체" }].map((t) => (
          <Link key={t.k} href={`/bugs?status=${t.k}`} className={`chip ${status === t.k ? "chip-grn" : ""}`} style={{ border: "1px solid var(--line)" }}>{t.l}</Link>
        ))}
      </div>

      {reports.length === 0 ? (
        <div className="card" style={{ padding: 20, color: "var(--ink3)" }}>해당 상태의 제보가 없습니다.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {reports.map((r) => {
            const st = ST[r.status] ?? { label: r.status, cls: "cc-no" };
            const meta = r.meta ?? {};
            return (
              <div key={r.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className={`cellchip ${st.cls}`}>{st.label}</span>
                  <span style={{ fontSize: 11, color: "var(--ink3)" }}>{fmt(r.created_at)} · {r.reporter ?? "익명"}</span>
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ fontSize: 11.5, color: "var(--acc)", wordBreak: "break-all" }}>{r.url}</a>}
                </div>
                <div style={{ marginTop: 8, fontSize: 13.5, whiteSpace: "pre-wrap" }}>{r.description}</div>

                {r.has_image && (
                  <a href={`/api/bug-report/${r.id}/image`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/bug-report/${r.id}/image`} alt="스크린샷" style={{ maxWidth: 360, maxHeight: 240, borderRadius: 8, border: "1px solid var(--line)" }} />
                  </a>
                )}

                <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink3)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {r.viewport && <span>뷰포트 {r.viewport}</span>}
                  {typeof meta.screen === "string" && <span>화면 {meta.screen}</span>}
                  {typeof meta.language === "string" && <span>언어 {meta.language}</span>}
                  {typeof meta.platform === "string" && meta.platform && <span>{meta.platform}</span>}
                  {r.user_agent && <span title={r.user_agent} style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>UA: {r.user_agent}</span>}
                </div>

                <BugManage id={r.id} status={r.status} devNote={r.dev_note} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
