"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { attachEmailAction, deleteEmailAction } from "@/app/actions";
import type { BrandEmail } from "@/lib/email-link";

const PART_LABEL: Record<string, string> = {
  intake: "유입", sales: "영업", onboard: "온보딩", ads: "광고", settle: "정산", lead: "파트장", exec: "대표",
};

// 한 메일 행 — 전문(전체 본문)을 접기/펼치기. 타임라인에서 #eml-<id> 로 진입 시 자동 펼침.
function EmailRow({ m, onDelete }: { m: BrandEmail; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const full = m.body_text || m.snippet || "";
  const isLong = full.length > 200;

  // 타임라인에서 이 메일로 점프(b360:tab, anchor=eml-<id>)하면 자동으로 전문 펼침.
  useEffect(() => {
    const onJump = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string; anchor?: string }>).detail;
      if (detail && typeof detail === "object" && detail.anchor === `eml-${m.id}`) setExpanded(true);
    };
    window.addEventListener("b360:tab", onJump);
    return () => window.removeEventListener("b360:tab", onJump);
  }, [m.id]);

  return (
    <div id={`eml-${m.id}`} className="border-b border-[#f6eef4] pb-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={`pill ${m.direction === "out" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
          {m.direction === "out" ? "발신" : m.direction === "in" ? "수신" : "메일"}
        </span>
        {m.source === "sync" && <span className="pill bg-violet-100 text-violet-700" title="공식 메일함에서 자동 수집">동기화</span>}
        {m.owner_part && <span className="pill bg-gray-100 text-gray-600">{PART_LABEL[m.owner_part] ?? m.owner_part}</span>}
        <span className="font-semibold flex-1 truncate">{m.subject || "(제목 없음)"}</span>
        <span className="text-[11px] text-muted whitespace-nowrap">{m.occurred_at.slice(5, 16).replace("T", " ")}</span>
        {m.source !== "sync" && (
          <button className="text-xs text-bad hover:underline" onClick={() => onDelete(m.id)}>삭제</button>
        )}
      </div>
      <div className="text-[11px] text-muted mt-0.5 break-all">{m.from_addr} {m.to_addr ? `→ ${m.to_addr}` : ""}</div>
      {full && (
        <div
          className="text-[12.5px] text-ink mt-1 whitespace-pre-wrap break-words leading-relaxed"
          style={expanded ? undefined : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {full}
        </div>
      )}
      {isLong && (
        <button className="text-[11px] text-pink hover:underline mt-1" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "접기" : "전문 보기"}
        </button>
      )}
    </div>
  );
}

export default function CustomerEmails({ brandId, emails }: { brandId: string; emails: BrandEmail[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold">고객 이메일 <span className="text-sm text-muted font-normal">({emails.length})</span></h2>
        <button className="text-xs text-pink hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "닫기" : "+ 이메일 붙여넣기"}
        </button>
      </div>

      {open && (
        <form
          className="grid grid-cols-2 gap-2 mb-3 p-2 bg-[#fff8fb] rounded-lg"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            await attachEmailAction({
              brandId,
              from: String(f.get("from")) || undefined,
              subject: String(f.get("subject")) || undefined,
              text: String(f.get("text")) || undefined,
              direction: (String(f.get("direction")) as "in" | "out") || undefined,
            });
            setBusy(false);
            (e.target as HTMLFormElement).reset();
            router.refresh();
          }}
        >
          <input name="from" className="input text-xs" placeholder="보낸사람 이메일" />
          <select name="direction" className="input text-xs" defaultValue="in">
            <option value="in">수신(고객→우리)</option>
            <option value="out">발신(우리→고객)</option>
          </select>
          <input name="subject" className="input text-xs col-span-2" placeholder="제목" />
          <textarea name="text" className="input text-xs col-span-2 h-20" placeholder="내용(요약만 저장됩니다)" />
          <button className="btn btn-primary text-xs py-1 col-span-2" type="submit" disabled={busy}>
            {busy ? "저장 중…" : "카드에 연결"}
          </button>
        </form>
      )}

      <div className="space-y-2 max-h-[32rem] overflow-y-auto">
        {emails.length === 0 && <div className="text-sm text-muted">연결된 이메일 없음</div>}
        {emails.map((m) => (
          <EmailRow key={m.id} m={m} onDelete={async (id) => { await deleteEmailAction(brandId, id); router.refresh(); }} />
        ))}
      </div>
    </section>
  );
}
