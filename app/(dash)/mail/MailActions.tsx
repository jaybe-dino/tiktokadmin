"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { assignAction, composeEmailAction } from "@/app/actions";
import { listAssigneesAction, type Assignee } from "./actions";

// 메일 스레드 우측/본문 액션들 — 실제 서버액션에 연결.
//   · AssignOwnerButton: 담당(영업) 이관 → assignAction("owner_sales") 게이트 경유.
//   · DraftReplyButton: AI 답장 초안 생성 → composeEmailAction → email_drafts 적재 → /drafts 에서 승인·발송.

function Msg({ text, ok }: { text: string; ok: boolean }) {
  return (
    <div
      className="note"
      style={{ marginTop: 6, color: ok ? "var(--grn, #16a34a)" : "var(--red, #dc2626)", fontSize: 11 }}
    >
      {text}
    </div>
  );
}

/** 담당(영업) 이관. brandId 없으면(브랜드 미매칭) 비활성. */
export function AssignOwnerButton({ brandId }: { brandId: string | null }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (!brandId) {
    return (
      <button className="btn" type="button" disabled title="브랜드 미매칭 스레드는 이관할 수 없습니다">
        담당 이관
      </button>
    );
  }

  function toggle() {
    setMsg(null);
    setOpen((v) => !v);
    if (!loaded) {
      start(async () => {
        const r = await listAssigneesAction();
        setAssignees(r.assignees);
        setLoaded(true);
        if (!r.ok) setMsg({ text: r.error ?? "목록 로드 실패", ok: false });
      });
    }
  }

  function onPick(adminUserId: string) {
    if (!adminUserId) return;
    start(async () => {
      const r = await assignAction(brandId!, "owner_sales", adminUserId);
      if (r.ok) {
        setMsg({ text: "담당 이관 완료", ok: true });
        setOpen(false);
      } else {
        setMsg({ text: r.error ?? "이관 실패", ok: false });
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column" }}>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button className="btn" type="button" onClick={toggle} disabled={pending}>
          담당 이관
        </button>
        {open && (
          <select
            defaultValue=""
            disabled={pending}
            onChange={(e) => onPick(e.target.value)}
            style={{ fontSize: 12 }}
          >
            <option value="" disabled>
              {loaded ? "이관 대상 선택…" : "불러오는 중…"}
            </option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </span>
      {msg && <Msg text={msg.text} ok={msg.ok} />}
    </span>
  );
}

/** AI 답장 초안 생성 — composeEmailAction 으로 email_drafts 적재 후 /drafts 에서 승인·발송. */
export function DraftReplyButton({ brandId, style }: { brandId: string | null; style?: React.CSSProperties }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [made, setMade] = useState(false);

  if (!brandId) {
    return (
      <button className="btn" style={style} type="button" disabled title="브랜드 미매칭 스레드는 초안을 생성할 수 없습니다">
        🤖 답장 초안 생성
      </button>
    );
  }

  function onClick() {
    setMsg(null);
    start(async () => {
      const r = await composeEmailAction(brandId!, "수신 메일에 대한 답장");
      if (r.ok) {
        setMade(true);
        setMsg({ text: `초안 생성됨${r.subject ? `: ${r.subject}` : ""}`, ok: true });
      } else {
        setMsg({ text: r.error ?? "초안 생성 실패", ok: false });
      }
    });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn grn" style={{ flex: 1, ...style }} type="button" onClick={onClick} disabled={pending}>
          {pending ? "생성 중…" : "🤖 답장 초안 생성"}
        </button>
        {made && (
          <Link href="/drafts" className="btn" style={{ flex: 1, textAlign: "center" }}>
            초안함에서 승인·발송
          </Link>
        )}
      </div>
      {msg && <Msg text={msg.text} ok={msg.ok} />}
    </div>
  );
}
