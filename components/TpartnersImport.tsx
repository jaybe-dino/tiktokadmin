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

  // 진단·복구
  interface Diag { apps: number; mappings: number; stored: number; mappingsWithFile: number; mappingsMissingFile: number; storedNoMapping: number; urlLinked: number; missingUrlColumns: string[] }
  const [diag, setDiag] = useState<Diag | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagMsg, setDiagMsg] = useState("");

  async function runDiag() {
    setDiagBusy(true); setDiagMsg("");
    try {
      const r = await fetch(`/api/admin/import-drive?mode=diag`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) { setDiagMsg(j.error ?? "진단 실패"); return; }
      setDiag(j.diag); setDiagMsg("진단 완료");
    } catch (e) { setDiagMsg((e as Error).message); }
    finally { setDiagBusy(false); }
  }
  async function runRelink() {
    if (!confirm("저장된 파일을 브랜드 서류 URL에 다시 연결합니다(재다운로드 없음). 진행할까요?")) return;
    setDiagBusy(true); setDiagMsg("");
    try {
      const r = await fetch(`/api/admin/import-drive?mode=relink`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) { setDiagMsg(j.error ?? "복구 실패"); return; }
      const rl = j.relink as { relinked: number; skippedNoColumn: number; missingColumns: string[] };
      setDiagMsg(`재연결 ${rl.relinked}건${rl.skippedNoColumn ? ` · 컬럼없음 스킵 ${rl.skippedNoColumn}(${rl.missingColumns.join(",")})` : ""}. 브랜드 카드에서 확인하세요.`);
      await runDiag();
    } catch (e) { setDiagMsg((e as Error).message); }
    finally { setDiagBusy(false); }
  }

  // 설문 CSV 이관
  interface SvUnmatched { company: string; email: string; candidates: string[]; answers: Record<string, string> }
  interface SvReport { dryRun: boolean; total: number; matched: { company: string; brand: string; by: string; answers: number }[]; created: { company: string; brandId: string }[]; unmatched: SvUnmatched[]; errors: { company: string; error: string }[] }
  const [svFile, setSvFile] = useState<File | null>(null);
  const [svBusy, setSvBusy] = useState(false);
  const [svReport, setSvReport] = useState<SvReport | null>(null);
  const [svMsg, setSvMsg] = useState("");
  // 수동 배정
  const [brandOpts, setBrandOpts] = useState<{ id: string; name: string }[]>([]);
  const [assignSel, setAssignSel] = useState<Record<number, string>>({});
  const [assignedIdx, setAssignedIdx] = useState<Set<number>>(new Set());

  async function loadBrands() {
    if (brandOpts.length) return;
    try { const r = await fetch(`/api/admin/import-survey`, { method: "GET" }); const j = await r.json(); if (j.ok) setBrandOpts(j.brands ?? []); } catch { /* noop */ }
  }
  async function assignOne(idx: number, u: SvUnmatched) {
    const brandId = assignSel[idx];
    if (!brandId) { setSvMsg("배정할 브랜드를 선택하세요."); return; }
    setSvBusy(true); setSvMsg("");
    try {
      const r = await fetch(`/api/admin/import-survey?mode=assign`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, answers: u.answers }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setSvMsg(j.error ?? "배정 실패"); return; }
      setAssignedIdx((s) => new Set(s).add(idx));
      setSvMsg(`"${u.company}" → 브랜드에 설문 저장됨.`);
    } catch (e) { setSvMsg((e as Error).message); }
    finally { setSvBusy(false); }
  }

  async function runSurvey(dryRun: boolean, createMissing = false) {
    if (!svFile) { setSvMsg("CSV 파일을 먼저 선택하세요."); return; }
    if (!dryRun && createMissing && !confirm("매칭 안 된 응답을 모두 '신규 리드'로 생성하고 설문을 붙입니다. 진행할까요?")) return;
    if (!dryRun && !createMissing && !confirm("설문 응답을 각 브랜드에 실제로 저장합니다. 진행할까요?")) return;
    setSvBusy(true); setSvMsg(""); if (dryRun) setSvReport(null);
    try {
      const fd = new FormData();
      fd.set("file", svFile);
      const r = await fetch(`/api/admin/import-survey?dry_run=${dryRun ? 1 : 0}&create_missing=${createMissing ? 1 : 0}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) { setSvMsg(j.error ?? "실패"); return; }
      setSvReport(j.report);
      setAssignedIdx(new Set());
      if ((j.report.unmatched?.length ?? 0) > 0) loadBrands();
      const cr = j.report.created?.length ?? 0;
      setSvMsg(dryRun ? "드라이런 완료 — 매칭 확인 후 '실제 이관'." : `완료 — 매칭 ${j.report.matched.length}건 저장${cr ? ` · 신규 리드 ${cr}건 생성` : ""}.`);
    } catch (e) { setSvMsg((e as Error).message); }
    finally { setSvBusy(false); }
  }

  // Drive 자동 이관(서버가 공개 Drive에서 직접 내려받음)
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveReport, setDriveReport] = useState<Report | null>(null);
  const [driveMsg, setDriveMsg] = useState("");
  const [driveProg, setDriveProg] = useState({ total: 0, done: 0, matched: 0, skipped: 0, failed: 0 });
  const [driveFails, setDriveFails] = useState<string[]>([]);

  async function runDriveRows(dryRun: boolean) {
    if (!dryRun && !confirm("Drive의 신청 데이터를 실제로 브랜드 원장에 반영합니다. 진행할까요?")) return;
    setDriveBusy(true); setDriveMsg(""); setDriveReport(null);
    try {
      const r = await fetch(`/api/admin/import-drive?mode=rows&dry_run=${dryRun ? 1 : 0}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) { setDriveMsg(j.error ?? "실패"); return; }
      setDriveReport(j.report);
      setDriveMsg(dryRun ? "드라이런 완료 — 확인 후 '실제 이관'." : "신청행 이관 완료. 이제 아래 '서류 파일 자동 이관'.");
    } catch (e) { setDriveMsg((e as Error).message); }
    finally { setDriveBusy(false); }
  }

  async function runDriveFiles() {
    if (!confirm("Drive의 서류 파일(약 187개)을 서버가 순차로 내려받아 저장합니다. 진행할까요?")) return;
    setDriveBusy(true); setDriveFails([]);
    let offset = 0, matched = 0, skipped = 0, failed = 0, total = 0;
    const fails: string[] = [];
    setDriveProg({ total: 0, done: 0, matched: 0, skipped: 0, failed: 0 });
    try {
      // next_offset 이 null 이 될 때까지 배치 반복.
      for (let guard = 0; guard < 100; guard++) {
        const r = await fetch(`/api/admin/import-drive?mode=files&offset=${offset}`, { method: "POST" });
        const j = await r.json();
        if (!r.ok || !j.ok) { fails.push(`offset ${offset}: ${j.error ?? "실패"}`); break; }
        total = j.total;
        matched += j.matched; skipped += j.skipped; failed += j.failed;
        for (const it of j.results as { name: string; error?: string }[]) {
          if (it.error) fails.push(`${it.name}: ${it.error}`);
        }
        const done = Math.min(offset + j.count, total);
        setDriveProg({ total, done, matched, skipped, failed });
        setDriveFails([...fails]);
        if (j.next_offset == null) break;
        offset = j.next_offset;
      }
    } catch (e) { fails.push((e as Error).message); setDriveFails([...fails]); }
    finally { setDriveBusy(false); }
  }

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
      {/* 🩺 진단·복구 — 이관했는데 파일이 안 보일 때 */}
      <div className="card" style={{ borderColor: "#f59e0b" }}>
        <div className="card-hd"><b>🩺 이관 진단 · 복구</b><span className="note" style={{ marginLeft: "auto" }}>이관했는데 파일이 안 보이면 여기</span></div>
        <div className="card-bd" style={{ display: "grid", gap: 10 }}>
          <p className="note" style={{ margin: 0 }}>
            <b>진단</b>: 신청·매핑·저장 파일 수와 브랜드 서류 URL 연결 상태를 확인합니다.
            <b> 복구</b>: 이미 저장된 파일을 브랜드 카드(회사정보·온보딩·KYC)에 <b>재다운로드 없이 다시 연결</b>합니다.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={diagBusy} onClick={runDiag}>{diagBusy ? "확인 중…" : "🔍 이관 상태 진단"}</button>
            <button className="btn btn-sm pri" disabled={diagBusy} onClick={runRelink}>🔗 파일 브랜드에 재연결(복구)</button>
            {diagMsg && <span className="note" style={{ alignSelf: "center" }}>{diagMsg}</span>}
          </div>
          {diag && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
              <span className="chip">신청 {diag.apps}</span>
              <span className="chip">파일매핑 {diag.mappings}</span>
              <span className="chip grn">저장파일 {diag.stored}</span>
              <span className={`chip ${diag.mappingsMissingFile > 0 ? "amb" : ""}`}>매핑O·파일X {diag.mappingsMissingFile}</span>
              {diag.storedNoMapping > 0 && <span className="chip red">파일O·매핑X {diag.storedNoMapping}</span>}
              {diag.missingUrlColumns.length > 0 && <span className="chip red">누락컬럼 {diag.missingUrlColumns.length}(마이그레이션 필요)</span>}
            </div>
          )}
          {diag && diag.missingUrlColumns.length > 0 && (
            <div className="note" style={{ color: "var(--bad)", fontSize: 11.5 }}>
              brand_company 에 없는 서류 URL 컬럼: {diag.missingUrlColumns.join(", ")} — 설정 &gt; DB 마이그레이션에서 &lsquo;지금 적용&rsquo; 후 다시 복구하세요.
            </div>
          )}
          {diag && diag.mappings === 0 && diag.apps > 0 && (
            <div className="note" style={{ color: "var(--bad)", fontSize: 11.5 }}>
              파일 매핑이 0건입니다 — 위 1단계 &lsquo;신청행 실제 이관&rsquo;을 <b>한 번 더</b> 실행하면(멱등) 매핑이 생성됩니다. 그 후 2단계 파일 이관을 다시 실행하세요.
            </div>
          )}
        </div>
      </div>

      {/* 📋 설문 CSV 이관 — 각 브랜드에 설문 응답 매칭 */}
      <div className="card" style={{ borderColor: "#10b981" }}>
        <div className="card-hd"><b>📋 설문 응답 CSV 이관</b><span className="note" style={{ marginLeft: "auto" }}>회사명·이메일로 브랜드 매칭</span></div>
        <div className="card-bd" style={{ display: "grid", gap: 10 }}>
          <p className="note" style={{ margin: 0 }}>
            설문 응답 CSV(첫 열: 회사 · 담당자 · 이메일, 이후 문항)를 올리면 <b>각 응답을 브랜드에 매칭</b>해 저장합니다.
            먼저 <b>드라이런</b>으로 매칭 결과를 확인하세요. 저장 후 브랜드360 &gt; 설문 탭에서 열람됩니다.
          </p>
          <input type="file" accept=".csv,text/csv" disabled={svBusy} onChange={(e) => { setSvFile(e.target.files?.[0] ?? null); setSvReport(null); }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={svBusy || !svFile} onClick={() => runSurvey(true)}>{svBusy ? "처리 중…" : "🔍 드라이런(미리보기)"}</button>
            <button className="btn btn-sm pri" disabled={svBusy || !svFile || !svReport} onClick={() => runSurvey(false)}>✅ 매칭건 저장</button>
            <button className="btn btn-sm" disabled={svBusy || !svFile || !svReport} onClick={() => runSurvey(false, true)} title="매칭 안 된 응답을 신규 리드로 생성하고 설문 저장">➕ 매칭건 저장 + 미매칭 신규 리드 생성</button>
            {svMsg && <span className="note" style={{ alignSelf: "center" }}>{svMsg}</span>}
          </div>
          {svReport ? (
            <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="chip">응답 {svReport.total}</span>
                <span className="chip grn">매칭 {svReport.matched.length}</span>
                {svReport.created.length > 0 ? <span className="chip grn">신규 리드 {svReport.created.length}</span> : null}
                <span className={svReport.unmatched.length ? "chip amb" : "chip"}>미매칭 {svReport.unmatched.length}</span>
                {svReport.errors.length > 0 ? <span className="chip red">오류 {svReport.errors.length}</span> : null}
                <span className="note">{svReport.dryRun ? "미리보기(쓰기 없음)" : "실제 반영됨"}</span>
              </div>
              {svReport.unmatched.length > 0 ? (
                <details open>
                  <summary style={{ cursor: "pointer", color: "var(--bad)", fontSize: 12 }}>미매칭 {svReport.unmatched.length}건 — 브랜드를 직접 골라 배정하세요</summary>
                  <div style={{ fontSize: 12, marginTop: 6, display: "grid", gap: 6 }}>
                    {svReport.unmatched.map((u, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                        <span style={{ minWidth: 150 }}><b>{u.company || "(회사명 없음)"}</b><span style={{ color: "var(--ink3)" }}> · {u.email || "-"}</span></span>
                        {assignedIdx.has(i) ? (
                          <span className="chip grn">저장됨 ✓</span>
                        ) : (
                          <>
                            <select className="f" style={{ minWidth: 180, padding: "2px 6px", fontSize: 12 }} value={assignSel[i] ?? ""} onChange={(e) => setAssignSel((s) => ({ ...s, [i]: e.target.value }))}>
                              <option value="">브랜드 선택…{u.candidates.length ? ` (후보: ${u.candidates.join(", ")})` : ""}</option>
                              {brandOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                            <button className="btn btn-sm pri" disabled={svBusy || !assignSel[i]} onClick={() => assignOne(i, u)}>이 브랜드에 저장</button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              {svReport.errors.length > 0 ? (
                <div style={{ color: "var(--bad)" }}>
                  {svReport.errors.map((er, i) => (
                    <div key={i}>{er.company} — {er.error}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ⭐ Drive 자동 이관 — 권장(파일 업로드 불필요) */}
      <div className="card" style={{ borderColor: "var(--acc, #2563eb)" }}>
        <div className="card-hd"><b>⭐ Drive 자동 이관 (권장 · 업로드 불필요)</b></div>
        <div className="card-bd" style={{ display: "grid", gap: 12 }}>
          <p className="note" style={{ margin: 0 }}>공개된 Drive 폴더에서 <b>서버가 직접</b> 신청 데이터·서류 파일을 내려받아 이관합니다. 아래 ①②처럼 파일을 직접 업로드할 필요가 없습니다. AI 토큰 비용은 발생하지 않습니다(단순 데이터 이관).</p>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>1단계 · 신청 데이터</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-sm" disabled={driveBusy} onClick={() => runDriveRows(true)}>{driveBusy ? "처리 중…" : "🔍 드라이런(미리보기)"}</button>
              <button className="btn btn-sm pri" disabled={driveBusy || !driveReport} onClick={() => runDriveRows(false)}>✅ 신청행 실제 이관</button>
              {driveMsg && <span className="note" style={{ alignSelf: "center" }}>{driveMsg}</span>}
            </div>
            {driveReport && (
              <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span className="chip grn">신규 {driveReport.created.length}</span>
                  <span className="chip amb">병합 {driveReport.merged.length}</span>
                  <span className="chip">스킵 {driveReport.skipped.length}</span>
                  <span className="chip">예상 파일 {driveReport.files_expected}</span>
                  {driveReport.errors.length > 0 && <span className="chip red">오류 {driveReport.errors.length}</span>}
                  <span className="note">{driveReport.dryRun ? "미리보기(쓰기 없음)" : "실제 반영됨"}</span>
                </div>
                {driveReport.created.length > 0 && <div><b>신규</b>: {driveReport.created.map((c) => c.brand).join(", ")}</div>}
                {driveReport.merged.length > 0 && <div><b>병합</b>: {driveReport.merged.map((c) => `${c.brand}(${c.matched_by})`).join(", ")}</div>}
                {driveReport.skipped.length > 0 && <div className="note"><b>스킵</b>: {driveReport.skipped.map((c) => `${c.brand}(${c.reason})`).join(", ")}</div>}
                {driveReport.errors.length > 0 && <div style={{ color: "var(--bad)" }}><b>오류</b>: {driveReport.errors.map((e) => `app${e.ext_app_id}: ${e.error}`).join(" · ")}</div>}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>2단계 · 서류 파일 (신청행 이관 후)</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-sm pri" disabled={driveBusy} onClick={runDriveFiles}>{driveBusy ? "내려받는 중…" : "📥 서류 파일 자동 이관 시작"}</button>
            </div>
            {(driveBusy || driveProg.done > 0) && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ height: 10, background: "var(--line)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${driveProg.total ? (driveProg.done / driveProg.total) * 100 : 0}%`, background: "var(--acc, #2563eb)", transition: "width .2s" }} />
                </div>
                <div style={{ fontSize: 12.5 }}>
                  {driveProg.done}/{driveProg.total} · 저장 {driveProg.matched} · 미매칭 {driveProg.skipped} · 실패 {driveProg.failed} {driveBusy ? "· 진행 중…" : "· 완료"}
                </div>
                {driveFails.length > 0 && (
                  <details><summary style={{ cursor: "pointer", color: "var(--bad)", fontSize: 12 }}>실패 {driveFails.length}건</summary>
                    <div style={{ fontSize: 11.5, marginTop: 4 }}>{driveFails.map((f, i) => <div key={i}>{f}</div>)}</div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ① 데이터 (수동 업로드 대안) */}
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
