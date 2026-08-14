"use client";
// 기능오류 제보 — 화면 우하단 플로팅 버튼. 스크린샷+설명 + 제출 시점 컨텍스트(URL·UA·뷰포트 등) 수집.
import { useRef, useState, useTransition } from "react";
import { submitBugReportAction } from "@/app/(dash)/bugs/actions";

export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  function submit() {
    if (!desc.trim()) { setMsg({ ok: false, text: "오류 내용을 입력하세요." }); return; }
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("description", desc.trim());
      fd.set("url", typeof window !== "undefined" ? window.location.href : "");
      fd.set("user_agent", navigator.userAgent);
      fd.set("viewport", `${window.innerWidth}x${window.innerHeight}`);
      fd.set("meta", JSON.stringify({
        language: navigator.language,
        platform: (navigator as unknown as { platform?: string }).platform ?? "",
        referrer: document.referrer || "",
        dpr: window.devicePixelRatio,
        screen: `${window.screen?.width}x${window.screen?.height}`,
        path: window.location.pathname + window.location.search,
        at: new Date().toISOString(),
      }));
      if (file) fd.set("image", file);
      const r = await submitBugReportAction(fd);
      if (r.ok) {
        setMsg({ ok: true, text: r.ticket ? `제보 접수 완료 · 오류번호 ${r.ticket} (개발 요청 시 이 번호로 지정하세요)` : "제보가 접수되었습니다. 감사합니다!" });
        setDesc(""); pickFile(null); if (fileRef.current) fileRef.current.value = "";
        setTimeout(() => { setOpen(false); setMsg(null); }, 1400);
      } else setMsg({ ok: false, text: r.error ?? "제출 실패" });
    });
  }

  return (
    <>
      {/* 플로팅 버튼 — 우하단 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="기능오류 제보"
        style={{
          position: "fixed", right: 20, bottom: 20, zIndex: 70,
          display: "flex", alignItems: "center", gap: 8,
          background: "#ef4444", color: "#fff", border: "none", borderRadius: 999,
          padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          boxShadow: "0 6px 20px rgba(239,68,68,.4)",
        }}
      >
        🐞 기능오류 제보
      </button>

      {open && (
        <div onClick={() => !pending && setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", color: "#111", borderRadius: 12, width: "min(520px, 96vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,.3)" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>🐞 기능오류 제보</b>
              <button onClick={() => !pending && setOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b" }}>×</button>
            </div>
            <div style={{ padding: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>오류 내용 · 재현 방법 *</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4}
                placeholder="어떤 화면에서 무엇을 하려다 어떤 오류가 났는지 적어주세요. (예: 계약담당 지정 시 에러 발생)"
                style={{ width: "100%", boxSizing: "border-box", marginTop: 4, border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />

              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginTop: 12 }}>스크린샷(선택)</label>
              <input ref={fileRef} type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} style={{ marginTop: 4, fontSize: 12 }} />
              {preview && (
                <div style={{ marginTop: 8, position: "relative", display: "inline-block" }}>
                  <img src={preview} alt="미리보기" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8, border: "1px solid #e5e7eb", display: "block" }} />
                  <button
                    type="button"
                    title="이미지 제거"
                    onClick={() => { pickFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                    style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 999, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
                  >×</button>
                </div>
              )}
              {preview && (
                <button type="button" onClick={() => { pickFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                  style={{ display: "block", marginTop: 6, background: "#f1f5f9", color: "#334155", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
                  이미지 삭제 후 다시 올리기
                </button>
              )}

              <div style={{ marginTop: 12, fontSize: 11, color: "#94a3b8", background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
                제출 시 현재 <b>URL·브라우저·화면크기</b> 등 디버깅 정보가 함께 수집됩니다.
              </div>
              {msg && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: msg.ok ? "#16a34a" : "#dc2626" }}>{msg.text}</div>}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => !pending && setOpen(false)} style={{ background: "#f1f5f9", color: "#334155", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>취소</button>
              <button onClick={submit} disabled={pending} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1 }}>
                {pending ? "제출 중…" : "제보 제출"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
