"use client";
// 브랜드360 · 해외 소개자료 — 영문/일문/태국어/베트남어/말레이시아어 제안서 생성·발행.
//   · 자료 근거가 없으면 만들지 않는다(빈 문서를 만들지 않는다).
//   · AI 호출이 실제로 성공한 것만 "AI" 로 표시하고, 실패는 사유를 그대로 보여준다.
//   · 링크는 '발행' 을 눌러야 열린다 — 발행은 공개 URL 을 만드는 일이라 확인을 받는다.
//   · 이 화면에서 고객·유통사에 보내는 발송은 하지 않는다(링크 복사까지).
import { useCallback, useEffect, useRef, useState } from "react";
import { INTRO_LANGS, INTRO_SECTIONS, type IntroLang } from "@/lib/intro-langs";
import {
  introListAction, introGenerateAction, introPublishAction, introContactAction,
} from "@/app/(dash)/brand/[id]/intro-actions";
import type { IntroDocRow } from "@/lib/brand-intro";

type Res = { ok: boolean; error?: string; note?: string };

function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async (fn: () => Promise<Res>, after?: () => void) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.note ?? "완료") : (r.error ?? "처리하지 못했습니다.") });
      if (r.ok) after?.();
      return r;
    } catch (e) {
      setMsg({ ok: false, text: `오류 — ${(e as Error).message}` });
      return { ok: false, error: (e as Error).message } as Res;
    } finally { setBusy(false); }
  }, []);
  return { busy, msg, setMsg, run };
}

const SECTION_KO: Record<string, string> = Object.fromEntries(INTRO_SECTIONS.map((s) => [s.key, s.ko]));
const when = (v: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "—");

export default function BrandIntroPanel({ brandId }: { brandId: string }) {
  const [docs, setDocs] = useState<IntroDocRow[] | null>(null);
  const [langs, setLangs] = useState<IntroLang[]>([]);
  const [schemaError, setSchemaError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await introListAction(brandId);
    setLoading(false);
    if (!r.ok || !r.data) { setLoadError(r.error ?? "불러오지 못했습니다."); return; }
    setLoadError("");
    setSchemaError(r.data.schemaReady ? "" : (r.data.schemaError ?? ""));
    setDocs(r.data.docs);
    setLangs(r.data.langs);
  }, [brandId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const byLang = new Map((docs ?? []).map((d) => [d.lang, d]));

  return (
    <div className="card" data-testid="brand-intro-panel">
      <div className="hd">
        <b>🌏 해외 소개자료</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          브랜드가 올린 회사자료·신청서를 근거로 현지 유통사용 제안서를 만듭니다 — 발행하면 공개 링크가 열립니다.
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 12 }}>
        {loading && <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>불러오는 중…</div>}
        {loadError && <div className="note" style={{ color: "#c92a2a" }}>{loadError}</div>}
        {schemaError && (
          <div className="note" style={{ color: "#c25400" }}>
            {schemaError} — 설정 &gt; 마이그레이션에서 <b>0102_brand_intro_docs.sql</b> 만 단독 적용하면 사용할 수 있습니다.
          </div>
        )}

        {!loading && !loadError && !schemaError && (
          <>
            <div className="note" style={{ fontSize: 12 }}>
              자료에 없는 매출·수상·인증은 넣지 않습니다. 근거로 삼은 자료는 문서 하단에 그대로 적히며,
              AI 가 읽지 못한 첨부(PPT·워드·한글·ZIP 등)는 아래에 표시됩니다.
            </div>
            {langs.map((lang) => (
              <LangRow key={lang} brandId={brandId} lang={lang} doc={byLang.get(lang)} origin={origin} onDone={reload} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function LangRow({ brandId, lang, doc, origin, onDone }: {
  brandId: string; lang: IntroLang; doc: IntroDocRow | undefined; origin: string; onDone: () => void;
}) {
  const meta = INTRO_LANGS[lang];
  const gen = useAction();
  const pub = useAction();
  const contact = useAction();
  const [open, setOpen] = useState(false);
  const mailRef = useRef<HTMLInputElement>(null);
  const url = doc ? `${origin}/intro/${doc.token}` : "";

  function generate() {
    const again = !!doc;
    if (!confirm(again
      ? `${meta.label} 소개자료를 다시 만듭니다. 기존 본문은 교체되고 링크는 그대로 유지됩니다.\n진행할까요?`
      : `${meta.label} 소개자료를 만듭니다. 브랜드가 올린 자료를 AI 가 읽습니다(외부 발송은 없습니다).\n진행할까요?`)) return;
    void gen.run(() => introGenerateAction(brandId, lang), onDone);
  }
  function publish(next: boolean) {
    if (next && !confirm("발행하면 이 링크를 아는 누구나 문서를 볼 수 있습니다. 내용을 확인했나요?")) return;
    void pub.run(() => introPublishAction(brandId, lang, next), onDone);
  }
  function saveContact() {
    const v = (mailRef.current?.value ?? "").trim();
    void contact.run(() => introContactAction(brandId, lang, v), onDone);
  }

  const busy = gen.busy || pub.busy || contact.busy;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{meta.flag} {meta.label}</b>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>{meta.market}</span>
        {doc ? (
          <>
            <span className={`cellchip ${doc.status === "published" ? "cc-ok" : "cc-warn"}`}>
              {doc.status === "published" ? "발행됨" : "초안"}
            </span>
            <span className={`cellchip ${doc.mode === "ai" ? "cc-ok" : "cc-no"}`} title={doc.mode === "ai" ? "실제 AI 호출 성공" : "AI 본문 없음 — 담당자 작성 필요"}>
              {doc.mode === "ai" ? "AI 작성" : "AI 미사용"}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink3)" }}>
              섹션 {doc.sections.length} · 근거 {doc.evidence.length} · 최종 {when(doc.generated_at)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "var(--ink3)" }}>아직 만들지 않았습니다.</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm pri" disabled={busy} onClick={generate}>
            {gen.busy ? "생성 중…" : doc ? "다시 생성" : "생성하기"}
          </button>
          {doc && (
            <>
              <a className="btn sm" href={`/intro/${doc.token}?preview=1`} target="_blank" rel="noreferrer">미리보기 ↗</a>
              <button className="btn sm" disabled={busy || !url}
                onClick={() => { if (url) void navigator.clipboard?.writeText(url); }}>링크 복사</button>
              <button className="btn sm" disabled={busy} onClick={() => publish(doc.status !== "published")}
                style={{ color: doc.status === "published" ? "#c25400" : "#0b7a52" }}>
                {doc.status === "published" ? "발행 취소" : "발행"}
              </button>
              <button className="btn sm" disabled={busy} onClick={() => setOpen((s) => !s)}>{open ? "접기" : "자세히"}</button>
            </>
          )}
        </div>
      </div>

      {gen.msg && <Msg m={gen.msg} />}
      {pub.msg && <Msg m={pub.msg} />}
      {contact.msg && <Msg m={contact.msg} />}

      {doc && doc.note && (
        <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 6, whiteSpace: "pre-wrap" }}>{doc.note}</div>
      )}
      {doc && doc.skipped_files.length > 0 && (
        <div style={{ fontSize: 12, color: "#c25400", marginTop: 4 }}>
          읽지 못한 첨부: {doc.skipped_files.join(" · ")}
        </div>
      )}

      {doc && open && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12.5 }}>
            <span style={{ color: "var(--ink3)" }}>제목</span> <b>{doc.title || "—"}</b>
            {doc.subtitle && <span style={{ color: "var(--ink2)" }}> · {doc.subtitle}</span>}
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            <span style={{ color: "var(--ink3)", minWidth: 96 }}>유통 문의 메일</span>
            <input className="f" ref={mailRef} defaultValue={doc.contact_email} placeholder="partners@glovek.space"
              style={{ width: 240, fontSize: 12 }} />
            <button className="btn sm" disabled={busy} onClick={saveContact}>저장</button>
          </label>
          <div>
            <div style={{ color: "var(--ink3)", fontSize: 11, marginBottom: 4 }}>작성된 섹션</div>
            {doc.sections.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#c25400" }}>본문이 없습니다 — 발행 전 다시 생성하거나 담당자가 작성해야 합니다.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                {doc.sections.map((s) => (
                  <li key={s.key}>
                    <b>{SECTION_KO[s.key] ?? s.key}</b>
                    {s.heading && <span style={{ color: "var(--ink2)" }}> · {s.heading}</span>}
                    <span style={{ color: "var(--ink3)" }}> · 근거 {s.refs.length || "우리 시장 노트"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div style={{ color: "var(--ink3)", fontSize: 11, marginBottom: 4 }}>근거로 쓴 자료</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: "var(--ink2)" }}>
              {doc.evidence.map((e) => <li key={e.ref}>[{e.ref}] {e.label}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Msg({ m }: { m: { ok: boolean; text: string } }) {
  return (
    <div style={{ marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap", color: m.ok ? "#0b7a52" : "#c92a2a" }}>{m.text}</div>
  );
}
