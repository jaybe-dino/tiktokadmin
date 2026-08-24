"use client";
// 직접 병합 — 자동 감지와 별개로, 목록에서 A·B 두 카드를 직접 골라 기준(유지)을 선택해 병합.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { mergeBrandsAction } from "@/app/actions";
import { STATE_LABELS, type State } from "@/lib/types";

interface BrandOpt { id: string; brand_name: string; email: string | null; state: string | null }

// 검색 가능한 브랜드 선택기(콤보박스).
function BrandPicker({ label, brands, value, excludeId, onPick }: {
  label: string; brands: BrandOpt[]; value: BrandOpt | null; excludeId?: string; onPick: (b: BrandOpt | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const kw = q.trim().toLowerCase();
  const list = useMemo(() => {
    const base = brands.filter((b) => b.id !== excludeId);
    if (!kw) return base.slice(0, 40);
    return base.filter((b) => b.brand_name.toLowerCase().includes(kw) || (b.email ?? "").toLowerCase().includes(kw)).slice(0, 40);
  }, [brands, kw, excludeId]);

  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <label className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>{label}</label>
      {value ? (
        <div className="flex items-center gap-2 mt-1 rounded-lg px-3 py-2" style={{ border: "1px solid var(--acc)", background: "var(--bg)" }}>
          <div className="min-w-0 flex-1">
            <b className="text-sm block truncate">{value.brand_name}</b>
            <span className="text-xs" style={{ color: "var(--ink3)" }}>{value.email ?? "이메일 없음"} · {STATE_LABELS[value.state as State] ?? value.state}</span>
          </div>
          <button className="text-xs" style={{ color: "var(--acc)" }} onClick={() => { onPick(null); setQ(""); }}>변경</button>
        </div>
      ) : (
        <div className="relative mt-1">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="브랜드명·이메일 검색"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ border: "1px solid var(--line)", background: "var(--bg)" }}
          />
          {open && (
            <div className="absolute left-0 right-0 mt-1 rounded-lg bg-white shadow-lg z-30" style={{ border: "1px solid var(--line)", maxHeight: 260, overflowY: "auto" }}>
              {list.length === 0 && <div className="px-3 py-2 text-xs" style={{ color: "var(--ink3)" }}>결과 없음</div>}
              {list.map((b) => (
                <button key={b.id} onMouseDown={() => { onPick(b); setOpen(false); }} className="block w-full text-left px-3 py-2" style={{ borderBottom: "1px solid var(--line)" }}>
                  <b className="text-sm">{b.brand_name}</b>
                  <span className="text-xs ml-2" style={{ color: "var(--ink3)" }}>{b.email ?? "—"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ManualMerge({ brands }: { brands: BrandOpt[] }) {
  const router = useRouter();
  const [a, setA] = useState<BrandOpt | null>(null);
  const [b, setB] = useState<BrandOpt | null>(null);
  const [keep, setKeep] = useState<"a" | "b">("a");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const keepBrand = keep === "a" ? a : b;
  const dropBrand = keep === "a" ? b : a;
  const ready = !!a && !!b && a.id !== b.id;

  async function merge() {
    if (!keepBrand || !dropBrand) return;
    if (!confirm(`「${dropBrand.brand_name}」의 모든 자료·이력·결제·제안서를 「${keepBrand.brand_name}」(으)로 합칩니다.\n합쳐진 카드는 사라집니다. 되돌릴 수 없습니다. 진행할까요?`)) return;
    setBusy(true); setMsg("");
    const r = await mergeBrandsAction(keepBrand.id, dropBrand.id);
    setBusy(false);
    if (r?.ok) {
      setMsg(`병합 완료 — 「${keepBrand.brand_name}」(으)로 합쳐졌습니다.`);
      setA(null); setB(null); setKeep("a");
      router.refresh();
    } else setMsg(`병합 실패: ${r?.error ?? "알 수 없는 오류"}`);
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <b className="text-sm">직접 병합</b>
        <span className="text-xs" style={{ color: "var(--ink3)" }}>목록에서 두 카드를 골라 기준을 정해 합칩니다(자동 감지와 무관).</span>
      </div>
      <div className="flex gap-3 flex-wrap items-start mt-2">
        <BrandPicker label="카드 A" brands={brands} value={a} excludeId={b?.id} onPick={setA} />
        <div className="pt-6 text-lg" style={{ color: "var(--ink3)" }}>＋</div>
        <BrandPicker label="카드 B" brands={brands} value={b} excludeId={a?.id} onPick={setB} />
      </div>

      {ready && (
        <div className="mt-3 rounded-lg p-3" style={{ background: "var(--bg)", border: "1px solid var(--line)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--ink2)" }}>어느 카드를 <b>기준(유지)</b>으로 합칠까요?</div>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={keep === "a"} onChange={() => setKeep("a")} className="accent-pink" />
              <b>{a!.brand_name}</b> 유지 <span className="text-xs" style={{ color: "var(--ink3)" }}>(B를 흡수)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={keep === "b"} onChange={() => setKeep("b")} className="accent-pink" />
              <b>{b!.brand_name}</b> 유지 <span className="text-xs" style={{ color: "var(--ink3)" }}>(A를 흡수)</span>
            </label>
          </div>
          <div className="text-xs mt-2" style={{ color: "var(--ink3)" }}>
            → <b>{keepBrand!.brand_name}</b> 유지 · <b>{dropBrand!.brand_name}</b> 흡수(카드 제거)
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mt-3">
        <button className="btn btn-primary text-sm" disabled={!ready || busy} onClick={merge}>
          {busy ? "병합 중…" : "선택 기준으로 병합"}
        </button>
        {msg && <span className="text-xs" style={{ color: msg.startsWith("병합 완료") ? "var(--ok)" : "var(--bad)" }}>{msg}</span>}
      </div>
    </div>
  );
}
