"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { assignAction, composeEmailAction } from "@/app/actions";
import { listAssigneesAction, listBrandOptionsAction, connectThreadToBrandAction, type Assignee, type BrandOption } from "./actions";

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

/** 미매칭 스레드 → 브랜드 수동 연결. 연결 시 상대 주소를 별칭 등록해 향후 자동 매칭. */
export function ConnectBrandButton({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function toggle() {
    setMsg(null);
    setOpen((v) => !v);
    if (!loaded) {
      start(async () => {
        const r = await listBrandOptionsAction();
        setBrands(r.brands);
        setLoaded(true);
        if (!r.ok) setMsg({ text: r.error ?? "브랜드 목록 로드 실패", ok: false });
      });
    }
  }

  function onPick(brandId: string) {
    if (!brandId) return;
    start(async () => {
      const r = await connectThreadToBrandAction(threadId, brandId);
      if (r.ok) {
        setMsg({ text: `브랜드 연결 완료 (${r.moved ?? 0}건)`, ok: true });
        setOpen(false);
        router.refresh();
      } else {
        setMsg({ text: r.error ?? "연결 실패", ok: false });
      }
    });
  }

  const filtered = q.trim()
    ? brands.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase()))
    : brands;

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={toggle} disabled={pending}>
          🔗 브랜드 연결
        </button>
        {open && (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="브랜드 검색…"
              style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--line)", borderRadius: 6, width: 130 }}
            />
            <select
              defaultValue=""
              disabled={pending}
              onChange={(e) => onPick(e.target.value)}
              style={{ fontSize: 12, maxWidth: 180 }}
            >
              <option value="" disabled>
                {loaded ? "브랜드 선택…" : "불러오는 중…"}
              </option>
              {filtered.slice(0, 200).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
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
