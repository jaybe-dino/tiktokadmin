"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrandAction, importBrandsAction } from "@/app/actions";
import {
  GRADES, PLANS, PLAN_LABELS, SOURCES, SOURCE_LABELS, STATE_LABELS, STATES,
} from "@/lib/types";

export function ManualAddForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ t: string; bad: boolean; id?: string } | null>(null);

  return (
    <form
      className="grid grid-cols-2 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const res = await createBrandAction({
          brand_name: String(f.get("brand_name")),
          email: String(f.get("email")) || undefined,
          phone: String(f.get("phone")) || undefined,
          biz_no: String(f.get("biz_no")) || undefined,
          contact_name: String(f.get("contact_name")) || undefined,
          category: String(f.get("category")) || undefined,
          source: String(f.get("source")) || undefined,
          brand_url: String(f.get("brand_url")) || undefined,
          state: String(f.get("state")) || undefined,
          grade: String(f.get("grade")) || undefined,
          plan: String(f.get("plan")) || undefined,
          contract_type: String(f.get("contract_type")) || undefined,
          pay_status: String(f.get("pay_status")) || undefined,
        });
        if (res.ok) {
          (e.target as HTMLFormElement).reset();
          setMsg({ t: "추가/병합 완료", bad: false, id: res.brand_id });
          router.refresh();
        } else {
          setMsg({ t: res.error || "실패", bad: true });
        }
      }}
    >
      <input name="brand_name" className="input col-span-2" placeholder="브랜드명 *" required />
      <input name="email" className="input" placeholder="이메일" type="email" />
      <input name="phone" className="input" placeholder="전화" />
      <input name="biz_no" className="input" placeholder="사업자번호" />
      <input name="contact_name" className="input" placeholder="담당자" />
      <input name="category" className="input" placeholder="카테고리" />
      <select name="source" className="input" defaultValue="etc">
        {SOURCES.map((s) => (
          <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>
        ))}
      </select>
      <input name="brand_url" className="input col-span-2" placeholder="판매채널 URL" />

      <details className="col-span-2">
        <summary className="text-sm font-semibold cursor-pointer text-muted">
          기존 데이터 · 현재 단계/등급/플랜/결제 (선택)
        </summary>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <select name="state" className="input" defaultValue="">
            <option value="">단계: 리드확보(기본)</option>
            {STATES.filter((s) => s !== "dropped" && s !== "churned").map((s) => (
              <option key={s} value={s}>{STATE_LABELS[s]}</option>
            ))}
          </select>
          <select name="grade" className="input" defaultValue="">
            <option value="">등급 미정</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select name="plan" className="input" defaultValue="">
            <option value="">플랜 미정</option>
            {PLANS.map((p) => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
          </select>
          <select name="contract_type" className="input" defaultValue="">
            <option value="">계약형태 미정</option>
            <option value="mall">멀티몰</option>
            <option value="onboarding">온보딩</option>
          </select>
          <select name="pay_status" className="input col-span-2" defaultValue="">
            <option value="">결제상태 미정</option>
            <option value="none">none</option>
            <option value="once_paid">once_paid(일회결제)</option>
            <option value="subscribed">subscribed(구독중)</option>
            <option value="past_due">past_due(연체)</option>
            <option value="canceled">canceled(해지)</option>
          </select>
        </div>
      </details>

      <button className="btn btn-primary col-span-2" type="submit">브랜드 추가</button>
      {msg && (
        <div className={`col-span-2 text-sm ${msg.bad ? "text-bad" : "text-good"}`}>
          {msg.t}
          {msg.id && <Link href={`/brand/${msg.id}`} className="ml-2 underline">360 보기 ↗</Link>}
        </div>
      )}
      <p className="col-span-2 text-[11px] text-muted">
        이메일·전화·사업자번호 중 최소 하나 필요. 같은 식별자면 기존 브랜드에 병합됩니다.
      </p>
    </form>
  );
}

export function CsvImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted space-y-1">
        <div><b>기본</b>: <code>brand_name,email,phone,biz_no,contact_name,category,source,brand_url</code> (최소 email/phone/biz_no 중 하나)</div>
        <div><b>기존 데이터 반영(선택)</b>: <code>state,grade,plan,contract_type,pay_status,rec_track,owner_intake,owner_sales,owner_onboard,owner_ads,next_action,due_date,countries,memo</code></div>
        <div className="text-[11px]">state 예: lead_new·contact·docs·live_mall … / plan: live_focus_490k·pro_89k·onboarding_onetime·guarantee_1m / 담당(owner_*)은 담당자 이메일(id)</div>
      </div>
      <input
        type="file"
        accept=".csv,text/csv"
        className="text-sm"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setCsv(await file.text());
        }}
      />
      <textarea
        className="input h-40 font-mono text-xs"
        placeholder={"brand_name,email,phone,category,source\n데모브랜드,demo@a.com,01011112222,뷰티,glovek_consult"}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
      <button
        className="btn btn-primary"
        disabled={busy || !csv.trim()}
        onClick={async () => {
          setBusy(true);
          const r = await importBrandsAction(csv);
          setBusy(false);
          setResult(r);
          router.refresh();
        }}
      >
        {busy ? "가져오는 중…" : "CSV 가져오기"}
      </button>
      {result && (
        <div className="text-sm">
          <div className="text-good">신규 {result.created} · 병합 {result.updated} · 건너뜀 {result.skipped}</div>
          {result.errors.length > 0 && (
            <ul className="text-bad text-xs mt-1 list-disc pl-4">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
