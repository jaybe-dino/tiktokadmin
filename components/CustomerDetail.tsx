"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addFileAction, addProposalAction, deleteFileAction, deleteProposalAction,
  setCountriesAction, setProposalStatusAction,
} from "@/app/actions";
import {
  COUNTRY_OPTIONS, FILE_KINDS, FILE_KIND_LABELS, PROPOSAL_STATUS_LABELS, type Brand,
} from "@/lib/types";
import type { BrandFile, Proposal } from "@/lib/repo/customer";

interface Props {
  brand: Brand;
  files: BrandFile[];
  proposals: Proposal[];
}

export default function CustomerDetail({ brand, files, proposals }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {msg && <div className="px-3 py-2 rounded-lg text-sm bg-emerald-50 text-good">{msg}</div>}

      {/* 목표국 / 인증국 */}
      <div className="card p-4">
        <div className="label">목표국 / 인증 국가</div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const countries = f.getAll("country").map(String);
            const certified = f.getAll("certified").map(String);
            await setCountriesAction(brand.id, countries, certified);
            flash("국가 저장됨");
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted mb-1">목표국</div>
              {COUNTRY_OPTIONS.map((c) => (
                <label key={c} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="country" value={c} defaultChecked={brand.countries?.includes(c)} className="accent-pink" />
                  {c}
                </label>
              ))}
            </div>
            <div>
              <div className="text-xs text-muted mb-1">인증 완료국</div>
              {COUNTRY_OPTIONS.map((c) => (
                <label key={c} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="certified" value={c} defaultChecked={brand.certified_countries?.includes(c)} className="accent-pink" />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn-primary mt-2 text-xs py-1" type="submit">국가 저장</button>
        </form>
      </div>

      {/* 고객 자료(파일 링크) */}
      <div className="card p-4">
        <div className="label">고객 자료 (소개서·회의록·녹음·히스토리)</div>
        <div className="space-y-1 mb-3">
          {files.length === 0 && <div className="text-sm text-muted">등록된 자료 없음</div>}
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm">
              <span className="pill bg-gray-100 text-gray-600">{FILE_KIND_LABELS[f.kind]}</span>
              <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 text-pink hover:underline truncate">
                {f.label} ↗
              </a>
              <button
                className="text-xs text-bad hover:underline"
                onClick={async () => { await deleteFileAction(brand.id, f.id); flash("삭제됨"); }}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
        <form
          className="grid grid-cols-6 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const res = await addFileAction({
              brandId: brand.id,
              kind: String(f.get("kind")),
              label: String(f.get("label")),
              url: String(f.get("url")),
            });
            if (res.ok) { (e.target as HTMLFormElement).reset(); flash("자료 추가됨"); }
            else flash(res.error || "실패");
          }}
        >
          <select name="kind" className="input col-span-2 text-xs" defaultValue="intro_deck">
            {FILE_KINDS.map((k) => <option key={k} value={k}>{FILE_KIND_LABELS[k]}</option>)}
          </select>
          <input name="label" className="input col-span-2 text-xs" placeholder="제목" required />
          <input name="url" className="input col-span-2 text-xs" placeholder="링크(URL)" required />
          <button className="btn text-xs py-1 col-span-6" type="submit">+ 자료 링크 추가</button>
        </form>
        <p className="text-[11px] text-muted mt-1">파일 원본은 어드민에 담지 않고 링크(Notion·Drive 등)로 첨부합니다.</p>
      </div>

      {/* 제안서 카드 */}
      <div className="card p-4">
        <div className="label">제안서</div>
        <div className="space-y-1 mb-3">
          {proposals.length === 0 && <div className="text-sm text-muted">제안서 없음</div>}
          {proposals.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className="flex-1 text-pink hover:underline truncate">{p.title} ↗</a>
              ) : (
                <span className="flex-1 truncate">{p.title}</span>
              )}
              {p.amount != null && <span className="text-xs text-muted">₩{p.amount.toLocaleString()}</span>}
              <select
                className="input w-20 text-xs py-0.5"
                defaultValue={p.status}
                onChange={async (e) => { await setProposalStatusAction(brand.id, p.id, e.target.value); router.refresh(); }}
              >
                {Object.entries(PROPOSAL_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="text-xs text-bad hover:underline" onClick={async () => { await deleteProposalAction(brand.id, p.id); flash("삭제됨"); }}>
                삭제
              </button>
            </div>
          ))}
        </div>
        <form
          className="grid grid-cols-6 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const amt = Number(f.get("amount"));
            const res = await addProposalAction({
              brandId: brand.id,
              title: String(f.get("title")),
              url: String(f.get("url")) || undefined,
              amount: amt || undefined,
            });
            if (res.ok) { (e.target as HTMLFormElement).reset(); flash("제안서 추가됨"); }
            else flash(res.error || "실패");
          }}
        >
          <input name="title" className="input col-span-2 text-xs" placeholder="제안서 제목" required />
          <input name="url" className="input col-span-2 text-xs" placeholder="링크(선택)" />
          <input name="amount" className="input col-span-2 text-xs" type="number" placeholder="금액(선택)" />
          <button className="btn text-xs py-1 col-span-6" type="submit">+ 제안서 추가</button>
        </form>
      </div>
    </div>
  );
}
