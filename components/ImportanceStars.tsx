"use client";

// 고객 카드 중요도 별(0~3) — 누구나 클릭으로 지정. 같은 별 다시 클릭 시 해제(감소).
//   카드 클릭(상세 열기)과 겹치지 않도록 stopPropagation.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBrandImportanceAction } from "@/app/(dash)/brand360/actions";

export default function ImportanceStars({
  brandId,
  value,
  size = 14,
  editable = true,
}: {
  brandId: string;
  value: number;
  size?: number;
  editable?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [val, setVal] = useState(Math.max(0, Math.min(3, value || 0)));
  const [hover, setHover] = useState(0);

  function set(n: number, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!editable) return;
    const next = val === n ? n - 1 : n; // 현재 값과 같은 별 다시 누르면 1 감소(해제)
    setVal(next);
    start(async () => {
      const r = await setBrandImportanceAction(brandId, next);
      if (!r.ok) { setVal(val); } // 실패 시 롤백
      router.refresh();
    });
  }

  const shown = hover || val;

  return (
    <span
      style={{ display: "inline-flex", gap: 1, lineHeight: 1, opacity: pending ? 0.6 : 1 }}
      onClick={(e) => e.stopPropagation()}
      title={val > 0 ? `중요도 ${val}/3` : "중요 표시 (별 클릭)"}
    >
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!editable || pending}
          onMouseEnter={() => editable && setHover(n)}
          onMouseLeave={() => editable && setHover(0)}
          onClick={(e) => set(n, e)}
          style={{
            border: "none", background: "none", padding: 0, cursor: editable ? "pointer" : "default",
            fontSize: size, lineHeight: 1, color: n <= shown ? "#f59e0b" : "#d1d5db",
          }}
          aria-label={`중요도 ${n}`}
        >
          {n <= shown ? "★" : "☆"}
        </button>
      ))}
    </span>
  );
}
