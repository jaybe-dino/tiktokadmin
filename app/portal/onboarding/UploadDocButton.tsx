"use client";
import { useRef, useState, useTransition } from "react";
import { uploadDocAction } from "./actions";

// v3.1 s-portal — 서류 행의 "업로드" 버튼. 파일 선택 즉시 서버액션 접수.
export default function UploadDocButton({ itemKey, submitted }: { itemKey: string; submitted?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("item_key", itemKey);
    fd.set("file", file);
    start(async () => {
      const r = await uploadDocAction(fd);
      setErr(r.ok ? null : (r.error ?? "업로드에 실패했습니다."));
      if (ref.current) ref.current.value = "";
    });
  }

  return (
    <>
      <input ref={ref} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.zip" onChange={onPick} />
      <button type="button" className="btn sm pri" disabled={pending} onClick={() => ref.current?.click()}>
        {pending ? "업로드 중…" : submitted ? "다시 업로드" : "업로드"}
      </button>
      {err && <span style={{ fontSize: 11, color: "#b91c1c", marginLeft: 6 }}>{err}</span>}
    </>
  );
}
