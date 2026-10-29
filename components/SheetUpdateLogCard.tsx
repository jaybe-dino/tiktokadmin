"use client";
// 수동 시트 갱신 기록 카드 — 대표 전용.
//
//   이 카드는 Google Sheets 를 갱신하지 않는다. 시트 갱신과 readback 은 사람이
//   연결 도구로 끝낸 뒤, "그 작업이 있었다" 는 이력만 여기서 남긴다.
//   제출은 /api/admin/sheets-ledger/updates 를 평소 UI 와 같은 fetch 로 호출한다.
import { useEffect, useState } from "react";

interface Row {
  id: string;
  recordedAt: string;
  sourceCollectedAt: string;
  sourceCount: number;
  updatedRows: number;
  appendedRows: number;
  verifiedRows: number;
  actor: string;
}

const API = "/api/admin/sheets-ledger/updates";

/** 입력칸의 "YYYY-MM-DDTHH:mm"(KST 벽시계) → 시간대를 명시한 ISO. */
export function kstLocalToIso(local: string): string {
  // datetime-local 은 시간대를 담지 않는다. KST 로 읽었다는 사실을 +09:00 으로 못 박는다.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return "";
  return `${local}:00+09:00`;
}

/** 시간대 명시 ISO → 보기용 KST 문자열. */
function isoToKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} `
    + `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default function SheetUpdateLogCard() {
  // 한 번의 작업에는 하나의 작업 번호. 재시도해도 같은 번호를 쓰고,
  // 성공한 뒤에만 새 번호를 만든다(같은 작업이 두 줄로 남지 않게).
  const [runId, setRunId] = useState("");
  const [collectedAt, setCollectedAt] = useState("");
  const [sourceCount, setSourceCount] = useState("");
  const [updatedRows, setUpdatedRows] = useState("");
  const [appendedRows, setAppendedRows] = useState("");
  const [verifiedRows, setVerifiedRows] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRunId(crypto.randomUUID());
    void load();
  }, []);

  async function load() {
    const res = await fetch(API, { headers: { accept: "application/json" } }).catch(() => null);
    if (!res) { setMsg("최근 기록을 읽지 못했습니다."); return; }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) { setMsg(body?.error ?? "최근 기록을 읽지 못했습니다."); return; }
    setRows(body.rows as Row[]);
  }

  const iso = kstLocalToIso(collectedAt);

  async function submit() {
    setMsg("");
    if (!iso) { setMsg("수집시각을 KST 로 입력해 주세요."); return; }
    setBusy(true);
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId,
        sourceCollectedAt: iso,
        sourceCount: Number(sourceCount),
        updatedRows: Number(updatedRows),
        appendedRows: Number(appendedRows),
        verifiedRows: Number(verifiedRows),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res) { setMsg("기록 요청이 전송되지 않았습니다. 다시 시도해 주세요."); return; }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const detail = Array.isArray(body?.issues)
        ? body.issues.map((i: { field: string; message: string }) => `${i.field}: ${i.message}`).join(" / ")
        : "";
      setMsg([body?.error ?? `기록 실패(HTTP ${res.status})`, detail].filter(Boolean).join(" — "));
      return;
    }
    setMsg(body.duplicate ? "같은 작업으로 이미 기록돼 있습니다." : "기록했습니다.");
    setRunId(crypto.randomUUID());        // 성공 후에만 새 작업 번호
    await load();
  }

  return (
    <div className="card">
      <div className="card-hd">
        <b>수동 시트 갱신 기록</b>
        <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>대표 전용</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        <div className="note" style={{ fontSize: 12 }}>
          이 카드는 시트를 갱신하지 않습니다. 연결 도구로 원장 → 시트 갱신과 readback 을
          끝낸 뒤, 그 작업 이력만 남기는 곳입니다.
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span>수집시각 (KST)</span>
          <input className="f" type="datetime-local" value={collectedAt}
            onChange={(e) => setCollectedAt(e.target.value)} />
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>
            {iso ? `저장 값: ${iso} (KST = UTC+09:00)` : "KST 벽시계로 입력하면 +09:00 을 붙여 저장합니다."}
          </span>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span>대상 건수</span>
            <input className="f" type="number" min={1} value={sourceCount}
              onChange={(e) => setSourceCount(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span>검증 건수</span>
            <input className="f" type="number" min={0} value={verifiedRows}
              onChange={(e) => setVerifiedRows(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span>기존 갱신</span>
            <input className="f" type="number" min={0} value={updatedRows}
              onChange={(e) => setUpdatedRows(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span>신규 추가</span>
            <input className="f" type="number" min={0} value={appendedRows}
              onChange={(e) => setAppendedRows(e.target.value)} />
          </label>
        </div>

        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? "기록 중…" : "기록"}
        </button>
        {msg && <div className="note" style={{ fontSize: 12 }}>{msg}</div>}

        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--ink2)" }}>최근 기록</span>
          {rows.length === 0
            ? <div className="note" style={{ fontSize: 12 }}>아직 기록이 없습니다.</div>
            : rows.map((r) => (
              <div key={r.id} style={{ fontSize: 12, color: "var(--ink2)" }}>
                {isoToKst(r.recordedAt)} · 수집 {isoToKst(r.sourceCollectedAt)} ·
                {" "}대상 {r.sourceCount} / 갱신 {r.updatedRows} / 신규 {r.appendedRows} /
                {" "}검증 {r.verifiedRows}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
