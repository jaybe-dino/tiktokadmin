"use client";

// v3.1 개요 좌측 — "브랜드측 담당자" 카드. brand_contacts(14-B) 실데이터.
// + 인물 추가(addContactAction) · 삭제(deleteContactAction) 배선.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addContactAction, deleteContactAction } from "@/app/actions";
import type { BrandContact } from "@/lib/repo/card";

const ROLE_LABEL: Record<string, string> = {
  main: "의사결정자", marketing: "마케팅", logistics: "물류", settlement: "정산", etc: "실무",
};
const AV_COLORS = ["#f472b6", "#fb923c", "#60a5fa", "#34d399", "#a78bfa"];

export default function Brand360Contacts({ brandId, contacts }: { brandId: string; contacts: BrandContact[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");

  return (
    <div className="card">
      <div className="hd">
        <b>브랜드측 담당자</b>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setOpen((o) => !o)}>
          {open ? "닫기" : "+ 인물 추가"}
        </button>
      </div>
      <div className="bd">
        {open && (
          <form
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const form = e.currentTarget;
              start(async () => {
                const r = await addContactAction({
                  brand_id: brandId,
                  name: String(f.get("name") ?? ""),
                  title: String(f.get("title") ?? ""),
                  email: String(f.get("email") ?? "") || undefined,
                  phone: String(f.get("phone") ?? "") || undefined,
                  role: String(f.get("role") ?? "main"),
                  is_primary: f.get("is_primary") === "on",
                });
                setMsg(r.ok ? "담당자 추가됨" : r.error ?? "실패");
                if (r.ok) { form.reset(); setOpen(false); }
                router.refresh();
              });
            }}
          >
            <input name="name" className="f" placeholder="이름 *" required />
            <input name="title" className="f" placeholder="직함 (대표·팀장…)" />
            <input name="email" className="f" placeholder="이메일" />
            <input name="phone" className="f" placeholder="전화" />
            <select name="role" className="f" defaultValue="main">
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" name="is_primary" /> 대표 연락처로 동기
            </label>
            <button className="btn sm pri" style={{ gridColumn: "1 / -1" }} disabled={pending} type="submit">추가</button>
          </form>
        )}
        {contacts.length === 0 && !open && (
          <p className="note">등록된 인물이 없습니다 — 미팅 참석자·메일 담당자를 추가해 두면 발송·정산 연락에 쓰입니다.</p>
        )}
        {contacts.map((c, i) => (
          <div className="row" key={c.id}>
            <span className="av" style={{ background: AV_COLORS[i % AV_COLORS.length] }}>{c.name.slice(0, 1)}</span>
            <div>
              <div className="tt">
                {c.name} {c.title && `${c.title} `}
                <span className="chip" style={{ fontSize: 10 }}>{ROLE_LABEL[c.role] ?? c.role}</span>
                {c.is_primary && <span className="chip grn" style={{ fontSize: 10, marginLeft: 4 }}>대표</span>}
              </div>
              <div className="ss">{[c.email, c.phone, c.note].filter(Boolean).join(" · ") || "연락처 미입력"}</div>
            </div>
            <div className="rt">
              <button
                className="btn sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    if (!confirm(`${c.name} 삭제할까요?`)) return;
                    await deleteContactAction(brandId, c.id);
                    router.refresh();
                  })
                }
              >
                삭제
              </button>
            </div>
          </div>
        ))}
        {msg && <div className="note" style={{ marginTop: 6 }}>{msg}</div>}
      </div>
    </div>
  );
}
