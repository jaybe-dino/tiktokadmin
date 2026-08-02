"use client";

import { useTransition, useState } from "react";
import { exportCustomersCsvAction } from "./actions";

interface Props {
  filter: { q?: string; state?: string; source?: string; grade?: string; plan?: string; owner?: string; breach?: string };
}

export default function CsvExportButton({ filter }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await exportCustomersCsvAction(filter);
      if (!res.ok || !res.csv) {
        setError(res.error ?? "내보내기 실패");
        return;
      }
      // Excel 한글 깨짐 방지 BOM + Blob 다운로드
      const blob = new Blob(["﻿" + res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename ?? "customers.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <button type="button" className="btn" onClick={onClick} disabled={pending}>
        {pending ? "내보내는 중…" : "CSV 내보내기"}
      </button>
      {error && <span style={{ color: "var(--danger)", fontSize: 11 }}>{error}</span>}
    </div>
  );
}
