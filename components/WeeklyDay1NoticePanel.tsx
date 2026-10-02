"use client";
// 1일차 안내에 "틱톡샵 온보딩 주간 슬롯" 문구를 모든 유입 루트에 한 번에 넣고 뺀다.
//   먼저 미리보기(저장 안 함)로 무엇이 바뀌는지 보고, 그다음에 적용한다.
//   이 화면은 문구만 바꾼다 — 발송하지 않고 일정·토글도 건드리지 않는다.
import { useState, useTransition } from "react";
import { day1NoticeAction } from "@/app/(dash)/channels/sequence-actions";
import type { Day1Report } from "@/lib/lead-sequence-day1";
import {
  DAY1_SMS_BLOCK, DAY1_EMAIL_BLOCK, WEEKLY_SLOT_COUNT, WEEKLY_APPLY_URL,
  LMS_MAX_BYTES,
} from "@/lib/weekly-day1-notice";

export default function WeeklyDay1NoticePanel({ canEdit }: { canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [rep, setRep] = useState<Day1Report | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const run = (mode: "apply" | "remove", dryRun: boolean) => start(async () => {
    setErr(""); setMsg("");
    const r = await day1NoticeAction(mode, dryRun);
    if (!r.ok || !r.report) { setErr(r.error ?? "처리 실패"); return; }
    setRep(r.report);
    if (dryRun) {
      setMsg(`미리보기입니다 — 아직 저장하지 않았습니다. 바뀔 루트 ${r.report.changed}개 · 건너뜀 ${r.report.skipped}개`);
    } else if (r.report.mismatch.length) {
      setErr(`저장 후 다시 읽은 값이 다릅니다 — ${r.report.mismatch.join(", ")}. 편집 화면에서 확인해 주세요.`);
    } else {
      setMsg(mode === "apply"
        ? `적용했습니다 — ${r.report.changed}개 루트의 1일차 문구에 들어갔습니다(발송은 하지 않았습니다).`
        : `문구를 뺐습니다 — ${r.report.changed}개 루트.`);
    }
  });

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="hd">
        <b>🗓️ 1일차 안내에 주간 슬롯 문구 넣기</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          모든 유입 루트의 1일차 문자·메일 본문에만 적용 · 2~4일차는 건드리지 않습니다
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        <div className="note" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
          <b>주간 슬롯 {WEEKLY_SLOT_COUNT}개</b>는 운영 방식을 밝히는 문장입니다 —
          시스템이 신청 {WEEKLY_SLOT_COUNT}건에서 접수를 끊거나 자동으로 마감하지 않습니다.
          그래서 마감·선착순·잔여석 같은 표현은 넣지 않습니다.
          이 버튼은 <b>문구만 바꿉니다</b> — 발송하지 않고 일정·발송 토글·수신거부 설정도 건드리지 않습니다.
          신청서 주소: <a href={WEEKLY_APPLY_URL} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>{WEEKLY_APPLY_URL}</a>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>
          <Block title="문자에 붙는 문구" body={DAY1_SMS_BLOCK} />
          <Block title="메일에 들어가는 문구(서명 앞)" body={DAY1_EMAIL_BLOCK} />
        </div>

        {canEdit ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm" disabled={pending} onClick={() => run("apply", true)}>
              {pending ? "확인 중…" : "① 미리보기(저장 안 함)"}
            </button>
            <button className="btn sm pri" disabled={pending || !rep || rep.mode !== "apply" || !rep.dryRun}
              onClick={() => { if (confirm(`모든 유입 루트의 1일차 문자·메일 본문에 문구를 넣습니다.\n발송은 하지 않습니다.\n진행할까요?`)) run("apply", false); }}>
              ② 적용하기
            </button>
            <button className="btn sm" disabled={pending} style={{ color: "#c25400" }}
              onClick={() => run("remove", true)}>되돌리기 미리보기</button>
            <button className="btn sm" disabled={pending || !rep || rep.mode !== "remove" || !rep.dryRun}
              style={{ color: "#e03131" }}
              onClick={() => { if (confirm("1일차 문구에서 주간 슬롯 안내를 뺍니다.\n진행할까요?")) run("remove", false); }}>
              되돌리기 실행
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--ink3)" }}>편집은 파트장·대표만 할 수 있습니다.</div>
        )}

        {err && <div style={{ fontSize: 12.5, color: "#c92a2a" }}>{err}</div>}
        {msg && <div style={{ fontSize: 12.5, color: "#117a44" }}>{msg}</div>}

        {rep && (
          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 12, minWidth: 560 }}>
              <thead><tr>
                <th>유입 루트</th><th>연속 안내</th><th>문자</th><th>메일</th><th>문자 길이</th><th>비고</th>
              </tr></thead>
              <tbody>
                {rep.rows.map((r) => (
                  <tr key={r.channel_id}>
                    <td><b>{r.name}</b><div style={{ color: "var(--ink3)" }}>{r.key}</div></td>
                    <td>{r.seq_enabled ? "켜짐" : <span style={{ color: "var(--ink3)" }}>꺼짐</span>}</td>
                    <td>{mark(r.skip ? false : r.smsChanged, r.send_sms)}</td>
                    <td>{mark(r.skip ? false : r.emailChanged, r.send_email)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.smsBytesBefore} → {r.smsBytesAfter}
                      <span style={{ color: "var(--ink3)" }}> / {LMS_MAX_BYTES}</span>
                    </td>
                    <td style={{ color: r.skip ? "#c25400" : "var(--ink3)" }}>{r.skip || "—"}</td>
                  </tr>
                ))}
                {rep.rows.length === 0 && (
                  <tr><td colSpan={6} style={{ color: "var(--ink3)" }}>1일차 문구가 저장된 유입 루트가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** 바뀜 여부 표시. 그 채널로 발송하지 않는 루트는 흐리게 둔다. */
function mark(changed: boolean, sends: boolean) {
  if (!changed) return <span style={{ color: "var(--ink3)" }}>그대로</span>;
  return <span style={{ color: sends ? "#117a44" : "var(--ink3)" }}>{sends ? "변경" : "변경(미발송 채널)"}</span>;
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 5 }}>{title}</div>
      <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{body}</pre>
    </div>
  );
}
