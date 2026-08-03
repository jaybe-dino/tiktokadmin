"use client";

// v3.1 서류·물류 탭 — 서류 체크리스트(doc_items · 상태 클릭 토글) + 물류 계약 현황(logistics_contracts).
// 물류계약은 어드민 원장(logistics_contracts)에 기록 — apply/glovek 원본은 읽기전용, 보정값 우선.
// upsertLogisticsFullAction: 기존 upsertLogisticsAction 에 없던 시작일·계약서 링크(note)까지 저장(기존 컬럼 범위).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { docCheckAction } from "@/app/actions";
import { upsertLogisticsFullAction } from "@/app/(dash)/brand360/actions";
import type { LogisticsContract } from "@/lib/repo/card";

interface DocItem { item_key: string; label: string; done: boolean; source: string }

const LOGI_STATUS: Record<string, { label: string; cls: string }> = {
  none: { label: "미착수", cls: "cc-no" },
  negotiating: { label: "협의 중", cls: "cc-warn" },
  contracted: { label: "계약", cls: "cc-ing" },
  active: { label: "가동", cls: "cc-ok" },
  expired: { label: "만료", cls: "cc-exp" },
};
const COUNTRY_FLAG: Record<string, string> = { US: "🇺🇸", VN: "🇻🇳", TH: "🇹🇭", MY: "🇲🇾", SG: "🇸🇬", PH: "🇵🇭" };

export default function Brand360Docs({ brandId, docItems, done, total, logistics }: {
  brandId: string; docItems: DocItem[]; done: number; total: number; logistics: LogisticsContract[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");

  return (
    <div className="grid g2" style={{ gap: 14 }}>
      {/* ── 서류 체크리스트 ── */}
      <div className="card">
        <div className="hd">
          <b>서류 체크리스트</b>
          {total > 0 ? (
            <span className="chip">{done}/{total}</span>
          ) : (
            <span style={{ color: "var(--ink3)", fontSize: 11.5 }}>계약 완료 시 자동 생성 — 현재 단계에선 미생성</span>
          )}
        </div>
        <div className="bd">
          {docItems.length === 0 ? (
            <div className="note">
              이 브랜드는 아직 <b>계약 전</b>이라 체크리스트가 없습니다. 계약 완료로 이동하면 계약형태·국가에 맞는 서류 템플릿이 자동 생성됩니다.
            </div>
          ) : (
            <table className="t">
              <thead>
                <tr><th>항목</th><th>상태</th><th>출처</th></tr>
              </thead>
              <tbody>
                {docItems.map((it) => (
                  <tr key={it.item_key}>
                    <td>{it.label}</td>
                    <td>
                      <button
                        type="button"
                        className={`cellchip ${it.done ? "cc-ok" : "cc-no"}`}
                        style={{ cursor: it.source === "apply_step" ? "not-allowed" : "pointer", border: "none" }}
                        disabled={pending || it.source === "apply_step"}
                        title={it.source === "apply_step" ? "apply 동기 항목 — 여기서 변경 불가" : "클릭해 완료/대기 전환"}
                        onClick={() =>
                          start(async () => {
                            const r = await docCheckAction(brandId, it.item_key, !it.done);
                            if (!r.ok) setMsg(r.error ?? "실패");
                            router.refresh();
                          })
                        }
                      >
                        {it.done ? "완료" : "대기"}
                      </button>
                    </td>
                    <td>{it.source === "apply_step" ? "apply 동기 🔒" : it.source || "어드민 입력"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
        </div>
      </div>

      {/* ── 물류 계약 현황 ── */}
      <div className="card">
        <div className="hd">
          <b>물류 계약 현황</b>
          <div className="rt"><button className="btn sm" onClick={() => setOpen((o) => !o)}>{open ? "닫기" : "+ 등록·갱신"}</button></div>
        </div>
        <div className="bd">
          {open && (
            <form
              style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                start(async () => {
                  const r = await upsertLogisticsFullAction({
                    brand_id: brandId,
                    country: String(f.get("country") ?? "US"),
                    provider: String(f.get("provider") ?? ""),
                    status: String(f.get("status") ?? "none"),
                    warehouse_region: String(f.get("warehouse_region") ?? ""),
                    start_date: String(f.get("start_date") ?? "") || null,
                    end_date: String(f.get("end_date") ?? "") || null,
                    note: String(f.get("note") ?? "") || undefined,
                  });
                  setMsg(r.ok ? "물류 계약 저장됨" : r.error ?? "실패");
                  if (r.ok) { form.reset(); setOpen(false); }
                  router.refresh();
                });
              }}
            >
              <select name="country" className="f" style={{ width: 90 }}>
                {Object.keys(COUNTRY_FLAG).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input name="provider" className="f" style={{ flex: 1, minWidth: 120 }} placeholder="3PL/창고" />
              <input name="warehouse_region" className="f" style={{ width: 110 }} placeholder="지역" />
              <select name="status" className="f" style={{ width: 100 }} defaultValue="negotiating">
                {Object.entries(LOGI_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input name="start_date" className="f" style={{ width: 130 }} type="date" title="계약 시작일" />
              <input name="end_date" className="f" style={{ width: 130 }} type="date" title="계약 종료일" />
              <input name="note" className="f" style={{ flex: 1, minWidth: 180 }} placeholder="계약서/서류 링크(드라이브 URL)·메모" />
              <button className="btn sm pri" disabled={pending} type="submit">저장</button>
            </form>
          )}
          {logistics.length === 0 ? (
            <p className="note">등록된 물류 계약이 없습니다.</p>
          ) : (
            <table className="t">
              <thead>
                <tr><th>국가</th><th>3PL/창고</th><th>상태</th><th>계약 기간</th><th>계약서</th></tr>
              </thead>
              <tbody>
                {logistics.map((l) => {
                  const st = LOGI_STATUS[l.status] ?? { label: l.status, cls: "cc-no" };
                  const link = /^https?:\/\//.test(l.note ?? "") ? l.note : null;
                  return (
                    <tr key={l.id}>
                      <td>{COUNTRY_FLAG[l.country] ?? ""} {l.country}</td>
                      <td>{[l.provider, l.warehouse_region].filter(Boolean).join(" · ") || "미정"}</td>
                      <td><span className={`cellchip ${st.cls}`}>{st.label}</span></td>
                      <td>{l.start_date || l.end_date ? `${l.start_date?.slice(0, 10) ?? "?"} ~ ${l.end_date?.slice(0, 10) ?? "?"}` : "—"}</td>
                      <td>
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" style={{ color: "var(--acc)", fontWeight: 700 }}>링크 ↗</a>
                        ) : (
                          <span title={l.note || undefined}>{l.note ? "메모" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="note" style={{ marginTop: 10 }}>서류 단계 게이트는 물류 계약 상태와 동기됩니다 — 계약 없으면 셋업 이동 불가.</div>
        </div>
      </div>
    </div>
  );
}
