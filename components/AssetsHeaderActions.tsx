"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerAssetAction, syncAssetsAction } from "@/app/(dash)/assets/actions";

type Toast = { t: string; bad: boolean } | null;

export default function AssetsHeaderActions({ kindLabel }: { kindLabel: Record<string, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const kinds = Object.keys(kindLabel);

  function sync() {
    setToast(null);
    startTransition(async () => {
      const res = await syncAssetsAction();
      if (res.ok) {
        setToast({ t: `색인 새로고침 · ${res.count ?? 0}건`, bad: false });
        router.refresh();
      } else {
        setToast({ t: res.error || "새로고침 실패", bad: true });
      }
    });
  }

  function submitUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setToast(null);
    startTransition(async () => {
      const res = await registerAssetAction({
        kind: String(f.get("kind") || "etc"),
        filename: String(f.get("filename") || ""),
        external_url: String(f.get("external_url") || ""),
      });
      if (res.ok) {
        form.reset();
        setOpen(false);
        setToast({ t: "색인 등록 완료", bad: false });
        router.refresh();
      } else {
        setToast({ t: res.error || "등록 실패", bad: true });
      }
    });
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
      {toast && (
        <span className="chip" style={{ background: toast.bad ? "#fee2e2" : "#dcfce7", color: toast.bad ? "#b91c1c" : "#166534" }}>
          {toast.t}
        </span>
      )}
      <button className="btn" type="button" disabled={pending} onClick={sync} title="색인 건수를 다시 집계합니다(외부 스토리지 동기화 아님)">
        {pending ? "새로고침 중…" : "🔄 색인 새로고침"}
      </button>
      <button className="btn pri" type="button" disabled={pending} onClick={() => { setToast(null); setOpen(true); }} title="파일 링크(드라이브 URL 등)를 색인 등록합니다">
        + 링크 색인
      </button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,36,64,.28)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}
          onClick={() => setOpen(false)}
        >
          <div className="modal" style={{ width: 460, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <b>+ 링크 색인 등록</b>
              <span className="x" onClick={() => setOpen(false)}>✕</span>
            </div>
            <form onSubmit={submitUpload}>
              <div className="mb" style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>
                  원본은 드라이브 1곳에만 저장하고 색인에는 링크만 등록됩니다(복제 없음).
                </div>
                <input name="filename" className="f" placeholder="파일명 *" required />
                <select name="kind" className="f" defaultValue="etc">
                  {kinds.map((k) => <option key={k} value={k}>{kindLabel[k] ?? k}</option>)}
                </select>
                <input name="external_url" className="f" placeholder="드라이브/원본 링크 (https://…) *" type="url" required />
              </div>
              <div className="mf">
                <button className="btn" type="button" onClick={() => setOpen(false)}>취소</button>
                <button className="btn pri" type="submit" disabled={pending}>{pending ? "등록 중…" : "색인에 등록"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
