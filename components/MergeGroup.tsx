"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mergeBrandsAction } from "@/app/actions";
import { STATE_LABELS, type State } from "@/lib/types";
import type { DuplicateGroup } from "@/lib/repo/queries";

const KIND_LABEL = { phone: "전화 동일", biz_no: "사업자번호 동일", brand_name: "브랜드명 동일" };

export default function MergeGroup({ group }: { group: DuplicateGroup }) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(group.brands[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return null;

  async function merge() {
    if (!keepId) return;
    setBusy(true);
    // 선택한 keep 외 나머지를 순차 병합
    for (const b of group.brands) {
      if (b.id === keepId) continue;
      await mergeBrandsAction(keepId, b.id);
    }
    setBusy(false);
    setDone(true);
    router.refresh();
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm">
          <span className="pill bg-amber-100 text-amber-700">{KIND_LABEL[group.kind]}</span>
          <span className="text-muted ml-2">{group.key}</span>
        </span>
        <button className="btn btn-primary text-xs py-1" onClick={merge} disabled={busy || !keepId}>
          {busy ? "병합 중…" : "선택 카드로 병합"}
        </button>
      </div>
      <div className="space-y-1">
        {group.brands.map((b) => (
          <label key={b.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`keep-${group.kind}-${group.key}`} checked={keepId === b.id} onChange={() => setKeepId(b.id)} className="accent-pink" />
            <Link href={`/brand/${b.id}`} className="font-semibold hover:text-pink">{b.brand_name}</Link>
            <span className="pill bg-gray-100 text-gray-600">{STATE_LABELS[b.state as State] ?? b.state}</span>
            <span className="text-xs text-muted">{b.email ?? b.phone ?? "—"}</span>
            {keepId === b.id && <span className="text-xs text-good">← 유지</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
