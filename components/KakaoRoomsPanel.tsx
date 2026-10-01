"use client";
// 카카오 수집 관리 — 방↔브랜드 연결, 수집 상태, 실행 기록.
//   · 방을 브랜드에 연결하기 전에는 그 방의 대화가 저장되지 않는다(임의 연결 금지).
//   · 수집기가 실제로 보내 저장된 적이 없으면 "수집기 미연결"로 적는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { kakaoOverviewAction, kakaoLinkRoomAction, kakaoSetStatusAction, kakaoSetNoteAction, type KakaoOverview } from "@/app/(dash)/kakao/actions";

type Res = { ok: boolean; error?: string; note?: string };
function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async <T extends Res>(fn: () => Promise<T>, after?: () => void) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.note ?? "완료") : (r.error ?? "처리하지 못했습니다.") });
      if (r.ok) after?.();
      return r;
    } catch (e) {
      setMsg({ ok: false, text: `오류 — ${(e as Error).message}` });
      return { ok: false, error: (e as Error).message } as T;
    } finally { setBusy(false); }
  }, []);
  return { busy, msg, run };
}
const kst = (v: string | null) => (v ? new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "—");
const STATUS_LABEL: Record<string, string> = { pending: "확인 대기", linked: "연결됨", ignored: "수집 제외" };
const Msg = ({ m }: { m: { ok: boolean; text: string } }) => (
  <div style={{ marginTop: 6, fontSize: 12, color: m.ok ? "#0b7a52" : "#c92a2a" }}>{m.text}</div>
);

export default function KakaoRoomsPanel() {
  const [ov, setOv] = useState<KakaoOverview | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await kakaoOverviewAction();
    setLoading(false);
    if (!r.ok || !r.data) { setErr(r.error ?? "불러오지 못했습니다."); return; }
    setErr(""); setOv(r.data);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  if (loading && !ov) return <div className="note">불러오는 중…</div>;
  if (err) return <div className="note" style={{ color: "#c92a2a" }}>{err}</div>;
  if (!ov) return null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <div className="hd">
          <b>🔌 수집기 연결 상태</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>PC 수집기가 보내오면 받아 저장합니다 — 이 화면에서 고객에게 보내는 것은 없습니다.</span>
        </div>
        <div className="bd" style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
          <div>
            <span className={`cellchip ${ov.collectorConfigured ? "cc-ok" : "cc-no"}`}>
              수집 비밀키 {ov.collectorConfigured ? "설정됨" : "미설정"}
            </span>
            <span style={{ marginLeft: 8, color: "var(--ink3)", fontSize: 11.5 }}>
              환경변수 <code>{ov.secretEnv}</code>
            </span>
          </div>
          {!ov.collectorConfigured && (
            <div className="note" style={{ color: "#c25400" }}>
              비밀키가 설정되지 않아 수집 요청을 모두 거부합니다. 담당자가 값을 만들어 배포 환경변수에
              넣어야 수집기가 붙을 수 있습니다(값은 이 화면에서 만들지 않습니다).
            </div>
          )}
          {!ov.schemaReady ? (
            <div className="note" style={{ color: "#c25400" }}>
              {ov.schemaError} — 설정 &gt; 마이그레이션에서 <b>{ov.migration}</b> 만 단독 적용하세요.
            </div>
          ) : (
            <div className="note" style={{ fontSize: 11.5 }}>
              엔드포인트 <code>POST /api/kakao/ingest</code> · 헤더 <code>x-kakao-secret</code> ·
              본문 <code>{"{ room_key, room_name, agent, messages:[{ external_id, at, author, text }] }"}</code><br />
              처음 보는 방은 <b>확인 대기</b>로만 등록되고 대화는 저장되지 않습니다 — 아래에서 브랜드를 연결해야 저장이 시작됩니다.
            </div>
          )}
        </div>
      </div>

      {ov.schemaReady && (
        <>
          <div className="card" data-testid="kakao-rooms">
            <div className="hd">
              <b>💬 카카오 방 ↔ 브랜드</b>
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                확인 대기 {ov.rooms.filter((r) => r.status === "pending").length} ·
                연결됨 {ov.rooms.filter((r) => r.status === "linked").length} ·
                제외 {ov.rooms.filter((r) => r.status === "ignored").length}
              </span>
            </div>
            <div className="bd" style={{ display: "grid", gap: 8 }}>
              {ov.rooms.length === 0 ? (
                <div className="note">
                  아직 수집기에서 알려온 방이 없습니다 — PC 수집기가 연결되면 여기에 방이 나타납니다.
                </div>
              ) : ov.rooms.map((r) => (
                <RoomRow key={r.id} room={r} brands={ov.brands} canWrite={ov.canWrite} onDone={reload} />
              ))}
            </div>
          </div>

          <div className="card">
            <div className="hd"><b>📥 수집 실행 기록</b></div>
            <div className="bd">
              {ov.runs.length === 0 ? <div className="note">수집 요청이 아직 없습니다.</div> : (
                <div style={{ maxHeight: 280, overflow: "auto" }}>
                  <table className="t" style={{ fontSize: 11.5 }}>
                    <thead><tr><th>시각</th><th>방</th><th>수집기</th><th>받음</th><th>저장</th><th>중복</th><th>보류</th><th>실패</th><th>상태</th><th>사유</th></tr></thead>
                    <tbody>
                      {ov.runs.map((x) => (
                        <tr key={x.id}>
                          <td>{kst(x.created_at)}</td>
                          <td>{x.room_key || "—"}</td>
                          <td>{x.agent || "—"}</td>
                          <td>{x.received}</td>
                          <td>{x.stored}</td>
                          <td>{x.duplicate}</td>
                          <td>{x.skipped}</td>
                          <td style={{ color: x.failed ? "#c92a2a" : undefined }}>{x.failed}</td>
                          <td style={{ color: x.status === "error" || x.status === "rejected" ? "#c92a2a" : undefined }}>{x.status}</td>
                          <td style={{ color: "var(--ink3)" }}>{x.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RoomRow({ room, brands, canWrite, onDone }: {
  room: KakaoOverview["rooms"][number];
  brands: { id: string; name: string }[]; canWrite: boolean; onDone: () => void;
}) {
  const a = useAction();
  const brand = useRef<HTMLSelectElement>(null);
  const note = useRef<HTMLInputElement>(null);
  const chip = room.status === "linked" ? "cc-ok" : room.status === "ignored" ? "cc-no" : "cc-warn";

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
        <b>{room.roomName || room.roomKey}</b>
        <span className={`cellchip ${chip}`}>{STATUS_LABEL[room.status] ?? room.status}</span>
        {room.brandName && <span className="chip" style={{ fontSize: 10.5 }}>{room.brandName}</span>}
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          마지막 대화 {kst(room.lastMessageAt)} · 저장 {room.storedCount}건 ·
          {room.lastIngestAt ? ` 마지막 저장 ${kst(room.lastIngestAt)}` : " 수집기에서 받은 기록 없음"}
        </span>
        {room.lastError && <span style={{ color: "#c92a2a", fontSize: 11 }}>{room.lastError}</span>}
      </div>
      {canWrite && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select className="f" ref={brand} defaultValue={room.brandId ?? ""} style={{ fontSize: 12, minWidth: 200 }}>
            <option value="">— 연결 안 함(저장하지 않음) —</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn sm pri" disabled={a.busy}
            onClick={() => {
              const v = brand.current?.value ?? "";
              if (v && !confirm(`이 방의 대화를 '${brands.find((b) => b.id === v)?.name ?? ""}' 기록으로 저장합니다.\n방과 브랜드가 맞는지 확인했나요?`)) return;
              void a.run(() => kakaoLinkRoomAction(room.id, v || null), onDone);
            }}>연결 저장</button>
          {room.status !== "ignored" ? (
            <button className="btn sm" disabled={a.busy} style={{ color: "#c25400" }}
              onClick={() => void a.run(() => kakaoSetStatusAction(room.id, "ignored"), onDone)}>수집 제외</button>
          ) : (
            <button className="btn sm" disabled={a.busy}
              onClick={() => void a.run(() => kakaoSetStatusAction(room.id, "pending"), onDone)}>제외 해제</button>
          )}
          <input className="f" ref={note} defaultValue={room.note} placeholder="메모(어떤 방인지)" style={{ flex: 1, minWidth: 180, fontSize: 12 }} />
          <button className="btn sm" disabled={a.busy}
            onClick={() => void a.run(() => kakaoSetNoteAction(room.id, note.current?.value ?? ""), onDone)}>메모 저장</button>
        </div>
      )}
      {a.msg && <Msg m={a.msg} />}
    </div>
  );
}
