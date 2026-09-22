"use client";

import { useTransition, useState } from "react";
import { exportCustomersCsvAction } from "./actions";

interface Props {
  // 화면 필터 그대로 — 유입일 범위(from·to)·진행국가까지 같은 조건으로 내보낸다(BUG-41).
  filter: { q?: string; state?: string; source?: string; grade?: string; plan?: string; owner?: string; breach?: string; country?: string; from?: string; to?: string };
}

export default function CsvExportButton({ filter }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function onClick() {
    setError(null); setDone(null);
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
      setDone(`${res.count ?? 0}건 내보냄`);
    });
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <button type="button" className="btn" onClick={onClick} disabled={pending}
        title={filter.from || filter.to ? `유입일 ${filter.from || "처음"} ~ ${filter.to || "오늘"} 구간을 내보냅니다` : "현재 화면 필터 그대로 내보냅니다"}>
        {pending ? "내보내는 중…" : "CSV 내보내기"}
      </button>
      {error && <span style={{ color: "var(--danger)", fontSize: 11 }}>{error}</span>}
      {done && !error && <span style={{ color: "var(--ink3)", fontSize: 11 }}>{done}</span>}
    </div>
  );
}
