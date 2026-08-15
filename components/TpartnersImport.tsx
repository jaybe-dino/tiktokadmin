"use client";

// tpartners 이관 UI — 터미널 없이 파일 업로드로. 대표·파트장 전용.
//   ① schema_and_data.sql 업로드 → 드라이런(미리보기) → 실제 이관
//   ② 서류 파일(187개) 드래그/선택 → 브라우저가 하나씩 업로드(SHA256 검증)
import { useState } from "react";

interface Report {
  dryRun: boolean; total: number;
  created: { ext_app_id: number; brand: string }[];
  merged: { ext_app_id: number; brand: string; matched_by: string }[];
  skipped: { ext_app_id: number; brand: string; reason: string }[];
  files_expected: number;
  errors: { ext_app_id: number; error: string }[];
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function TpartnersImport() {
  const [sqlFile, setSqlFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [msg, setMsg] = useState("");

  // 파일 업로드 진행
  const [fileBusy, setFileBusy] = useState(false);
  const [prog, setProg] = useState({ total: 0, done: 0, matched: 0, skipped: 0, failed: 0 });
  const [failList, setFailList] = useState<string[]>([]);

  async function runSql(dryRun: boolean) {
    if (!sqlFile) { setMsg("schema_and_data.sql 파일을 먼저 선택하세요."); return; }
    if (!dryRun && !confirm("실제로 브랜드 원장에 반영합니다. 진행할까요? (드라이런으로 먼저 확인 권장)")) return;
    setBusy(true); setMsg(""); setReport(null);
    try {
      const fd = new FormData();
      fd.set("file", sqlFile);
      const r = await fetch(`/api/admin/import-tpartners?dry_run=${dryRun ? 1 : 0}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) { setMsg(j.error ?? "실패"); return; }
      setReport(j.report);
      setMsg(dryRun ? "드라이런 완료 — 아래 결과 확인 후 '실제 이관'." : "이관 완료.");
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function runFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setFileBusy(true); setFailList([]);
    setProg({ total: list.length, done: 0, matched: 0, skipped: 0, failed: 0 });
    let matched = 0, skipped = 0, failed = 0;
    const fails: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      try {
        const buf = await f.arrayBuffer();
        const sha = await sha256Hex(buf);
        const fd = new FormData();
        fd.set("file", f); fd.set("filename", f.name); fd.set("sha256", sha);
        const r = await fetch("/api/admin/import-file", { method: "POST", body: fd });
        const j = await r.json();
        if (j.matched === true) matched++;
        else if (j.matched === false) skipped++;
        else { failed++; fails.push(`${f.name}: ${j.error ?? "실패"}`); }
      } catch (e) { failed++; fails.push(`${f.name}: ${(e as Error).message}`); }
      setProg({ total: list.length, done: i + 1, matched, skipped, failed });
    }
    setFailList(fails);
    setFileBusy(false);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ① 데이터 */}
      <div className="card">
        <div className="card-hd"><b>① 데이터 이관 (schema_and_data.sql)</b></div>
        <div className="card-bd" style={{ display: "grid", gap: 10 }}>
          <p className="note" style={{ margin: 0 }}>번들 안의 <code>db/schema_and_data.sql</code> 파일을 선택하세요. 먼저 <b>드라이런</b>으로 미리보기(쓰기 없음) 후 실제 이관.</p>
          <input type="file" accept=".sql,text/plain" onChange={(e) => { setSqlFile(e.target.files?.[0] ?? null); setReport(null); }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={busy || !sqlFile} onClick={() => runSql(true)}>{busy ? "처리 중…" : "🔍 드라이런(미리보기)"}</button>
            <button className="btn btn-sm pri" disabled={busy || !sqlFile || !report} onClick={() => runSql(false)}>✅ 실제 이관</button>
            {msg && <span className="note" style={{ alignSelf: "center" }}>{msg}</span>}
          </div>

          {report && (
            <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span className="chip grn">신규 {report.created.length}</span>
                <span className="chip amb">병합 {report.merged.length}</span>
                <span className="chip">스킵 {report.skipped.length}</span>
                <span className="chip">예상 파일 {report.files_expected}</span>
                {report.errors.length > 0 && <span className="chip red">오류 {report.errors.length}</span>}
                <span className="note">{report.dryRun ? "미리보기(쓰기 없음)" : "실제 반영됨"}</span>
              </div>
              {report.created.length > 0 && <div><b>신규</b>: {report.created.map((c) => c.brand).join(", ")}</div>}
              {report.merged.length > 0 && <div><b>병합</b>: {report.merged.map((c) => `${c.brand}(${c.matched_by})`).join(", ")}</div>}
              {report.skipped.length > 0 && <div className="note"><b>스킵</b>: {report.skipped.map((c) => `${c.brand}(${c.reason})`).join(", ")}</div>}
              {report.errors.length > 0 && <div style={{ color: "var(--bad)" }}><b>오류</b>: {report.errors.map((e) => `app${e.ext_app_id}: ${e.error}`).join(" · ")}</div>}
            </div>
          )}
        </div>
      </div>

      {/* ② 파일 */}
      <div className="card">
        <div className="card-hd"><b>② 서류 파일 이관 (uploads 187개)</b></div>
        <div className="card-bd" style={{ display: "grid", gap: 10 }}>
          <p className="note" style={{ margin: 0 }}>①을 <b>실제 이관</b>한 뒤에 하세요(파일↔브랜드 매칭 필요). 번들의 <code>uploads/</code> 폴더 안 파일을 <b>전부 선택</b>하면 브라우저가 하나씩 올리며 SHA256을 검증합니다.</p>
          <input type="file" multiple disabled={fileBusy} onChange={(e) => runFiles(e.target.files)} />
          {(fileBusy || prog.done > 0) && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ height: 10, background: "var(--line)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%`, background: "var(--acc, #2563eb)", transition: "width .2s" }} />
              </div>
              <div style={{ fontSize: 12.5 }}>
                {prog.done}/{prog.total} · 저장 {prog.matched} · 미매칭 {prog.skipped} · 실패 {prog.failed} {fileBusy ? "· 업로드 중…" : "· 완료"}
              </div>
              {failList.length > 0 && (
                <details><summary style={{ cursor: "pointer", color: "var(--bad)", fontSize: 12 }}>실패 {failList.length}건</summary>
                  <div style={{ fontSize: 11.5, marginTop: 4 }}>{failList.map((f, i) => <div key={i}>{f}</div>)}</div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
