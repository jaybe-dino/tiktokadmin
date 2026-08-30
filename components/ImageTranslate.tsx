"use client";
// 상세페이지 이미지 통번역 위젯 — 이미지 업로드 + 언어 선택 → AI가 텍스트를 번역한 새 이미지 생성.
//   어드민(/api/image-translate, brand_id 필요)과 온보딩 고객(/api/apply/translate-image) 공용.
import { useRef, useState } from "react";

const LANGS = [
  { code: "en", label: "영어" },
  { code: "vi", label: "베트남어" },
  { code: "th", label: "태국어" },
];

export default function ImageTranslate({ endpoint, extra = {}, compact = false }: {
  endpoint: string;
  extra?: Record<string, string>;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState("");      // 원본 미리보기(objectURL)
  const [lang, setLang] = useState("en");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<{ lang: string; url: string; filename: string; note?: string }[]>([]);

  function pick(f: File | null) {
    setFile(f);
    setErr("");
    setResults([]);
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    setSrcUrl(f ? URL.createObjectURL(f) : "");
  }

  async function run(src: File, useLang: string) {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", src);
      fd.append("lang", useLang);
      for (const [k, v] of Object.entries(extra)) fd.append(k, v);
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({ ok: false, error: "응답 해석 실패" }));
      if (!j.ok || !j.url) { setErr(j.error ?? "번역 실패"); return; }
      setResults((rs) => [
        { lang: useLang, url: j.url, filename: j.filename ?? "", note: j.note },
        ...rs.filter((r) => r.lang !== useLang),
      ]);
    } catch {
      setErr("네트워크 오류 — 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  function translate() {
    if (!file || busy) return;
    run(file, lang);
  }

  // 이어서 번역 — 번역본을 다시 입력으로 넣어 "남은 한글"만 처리한다.
  //   감지는 한글만 찾으므로 이미 번역된 부분은 건드리지 않는다(반복할수록 완성도가 올라감).
  async function continueTranslate(r: { lang: string; url: string; filename: string }) {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(r.url);
      if (!res.ok) { setErr("번역본을 다시 불러오지 못했습니다."); setBusy(false); return; }
      const blob = await res.blob();
      const f = new File([blob], r.filename || "translated.png", { type: blob.type || "image/png" });
      setBusy(false);
      await run(f, r.lang);
    } catch {
      setErr("이어서 번역 준비 중 오류가 발생했습니다.");
      setBusy(false);
    }
  }

  const langLabel = (c: string) => LANGS.find((l) => l.code === c)?.label ?? c;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
          onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          🖼 이미지 선택{file ? `: ${file.name.slice(0, 24)}${file.name.length > 24 ? "…" : ""}` : ""}
        </button>
        <select className="f" value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy} style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button type="button" className="btn sm pri" onClick={translate} disabled={busy || !file}>
          {busy ? "번역 중… (최대 2~3분)" : "🌐 번역하기"}
        </button>
        {!compact && (
          <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>
            이미지 속 한글 텍스트를 번역해 레이아웃 그대로 새 이미지를 만듭니다 · JPG/PNG/WEBP · 10MB 이하
          </span>
        )}
      </div>
      {err && <div style={{ fontSize: 12, color: "var(--danger, #e03131)" }}>⚠ {err} </div>}

      {(srcUrl || results.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {srcUrl && (
            <figure style={{ margin: 0 }}>
              <figcaption style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 4 }}>원본</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={srcUrl} alt="원본" style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
            </figure>
          )}
          {results.map((r) => (
            <figure key={r.lang} style={{ margin: 0 }}>
              <figcaption style={{ fontSize: 11, fontWeight: 700, color: "#0b7a52", marginBottom: 4 }}>
                번역본({langLabel(r.lang)}) ·{" "}
                <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>원본 크기 열기 ↗</a>
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={`번역본 ${r.lang}`} style={{ width: "100%", border: "1px solid #12b88655", borderRadius: 8, background: "#fff" }} />
              {r.note && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "#b25e02" }}>⚠ {r.note}</span>
                  <button type="button" className="btn sm" disabled={busy} onClick={() => continueTranslate(r)}>
                    ↻ 이어서 번역
                  </button>
                </div>
              )}
            </figure>
          ))}
        </div>
      )}
      {results.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--ink3)" }}>
          번역본은 자동 저장되었습니다. 마음에 들지 않으면 같은 언어로 다시 번역하면 새 결과로 갱신됩니다.{" "}남은 한글이 있으면 “이어서 번역”을 눌러 그 부분만 반복 처리할 수 있습니다.
        </div>
      )}
    </div>
  );
}
