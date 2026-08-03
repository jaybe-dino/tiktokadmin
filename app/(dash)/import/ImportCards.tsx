"use client";

// 리드 가져오기 v3.1 — ② CSV 업로드 · ③ 수동 등록 카드 (버튼 전부 실동작 배선)

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GRADES, PLANS, PLAN_LABELS, STATE_LABELS, STATES } from "@/lib/types";
import { importCsvAction, registerLeadAction, type CsvImportSummary } from "./actions";

const NEW_GROUP = "__new__";

interface GroupOpt { name: string; n: number }

/* ── ② CSV 업로드 ─────────────────────────────────────────── */
export function CsvUploadCard({ today, groups }: { today: string; groups: GroupOpt[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState("expo");
  const [group, setGroup] = useState(`${today} · 박람회`);
  const [groupTouched, setGroupTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CsvImportSummary | null>(null);

  const srcLabel = (s: string) => (s === "expo" ? "박람회" : s === "meta_ads" ? "메타 광고" : "제휴 소개");
  const rowCount = csv.trim() ? Math.max(csv.trim().split(/\r?\n/).length - 1, 0) : 0;

  const loadFile = async (f: File | undefined | null) => {
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
    setResult(null);
  };
  const pickSource = (s: string) => {
    setSource(s);
    if (!groupTouched) setGroup(`${today} · ${srcLabel(s)}`);
  };

  return (
    <div>
      <div
        className="drop"
        style={{ cursor: "pointer" }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void loadFile(e.dataTransfer.files?.[0]); }}
      >
        {fileName
          ? <>📄 {fileName}<br /><small>{rowCount}행 인식 · 헤더 자동 매칭 (미리보기)</small></>
          : <>📄 파일을 끌어다 놓거나 클릭<br /><small>박람회 명단 · 광고 내보내기 (xlsx/csv)</small></>}
      </div>
      <input
        ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
        onChange={(e) => void loadFile(e.target.files?.[0])}
      />
      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 11.5, color: "var(--ink3)", cursor: "pointer", fontWeight: 600 }}>
          또는 CSV 텍스트 붙여넣기 — 어떤 헤더든 자동 인식
        </summary>
        <textarea
          className="f" rows={5} style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11 }}
          placeholder={"brand_name,email,phone,category\n오가닉힐,hello@organic.kr,01011112222,뷰티"}
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setFileName(""); setResult(null); }}
        />
      </details>

      <label className="label" style={{ marginTop: 10 }}>유입 경로 지정</label>
      <select className="f" value={source} onChange={(e) => pickSource(e.target.value)}>
        <option value="expo">박람회 (expo)</option>
        <option value="meta_ads">메타 광고</option>
        <option value="referrer">제휴 소개</option>
      </select>

      <label className="label" style={{ marginTop: 8 }}>그룹 지정 (자동: 날짜·소스 — 수정 가능)</label>
      <input
        className="f" value={group} list="csv-group-list"
        onChange={(e) => { setGroup(e.target.value); setGroupTouched(true); }}
      />
      <datalist id="csv-group-list">
        {groups.map((g) => <option key={g.name} value={g.name} />)}
      </datalist>

      <div className="note" style={{ marginTop: 6 }}>
        이 그룹은 <b>발송 센터</b>의 대량 메일·문자 대상으로 바로 선택할 수 있어요
      </div>

      <button
        className="btn pri" style={{ width: "100%", marginTop: 10 }}
        disabled={busy || !csv.trim()}
        onClick={async () => {
          setBusy(true);
          const r = await importCsvAction(csv, source, group);
          setBusy(false);
          setResult(r);
          if (r.ok) router.refresh();
        }}
      >
        {busy ? "반영 중…" : rowCount > 0 ? `미리보기 ${rowCount}행 → 중복 병합 → 반영` : "미리보기 → 중복 병합 → 반영"}
      </button>

      {result && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ color: "var(--ok)", fontWeight: 700 }}>
            신규 {result.created} · 병합 {result.updated} · 건너뜀 {result.skipped}
          </div>
          {result.aiAnalyzed !== undefined && (
            <div style={{ color: "var(--ink3)", marginTop: 2 }}>
              {result.aiUsed ? "AI" : "규칙기반"} 1차 분석 {result.aiAnalyzed}건 완료
              {(result.aiPending ?? 0) > 0 && <> · 나머지 {result.aiPending}건은 사전분석 에이전트가 처리</>}
            </div>
          )}
          {result.errors.length > 0 && (
            <ul style={{ color: "var(--danger)", fontSize: 11, marginTop: 4, paddingLeft: 16, listStyle: "disc" }}>
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="note" style={{ marginTop: 10 }}>
        업로드 후 <b>미리보기 → 중복 병합 리허설 → 반영</b> 3단계. 파일해시+행번호 멱등키로 재업로드 안전.
      </div>
    </div>
  );
}

/* ── ③ 수동 등록 ─────────────────────────────────────────── */
export function ManualRegisterCard({ today, groups }: { today: string; groups: GroupOpt[] }) {
  const router = useRouter();
  const autoGroup = `${today} 그룹`;
  const [group, setGroup] = useState(autoGroup);
  const [newGroup, setNewGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; bad: boolean; id?: string } | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        const res = await registerLeadAction({
          brand_name: String(f.get("brand_name") ?? ""),
          contact: String(f.get("contact") ?? ""),
          contact_name: String(f.get("contact_name") ?? "") || undefined,
          source: String(f.get("source") ?? "etc"),
          lead_group: group === NEW_GROUP ? newGroup : group,
          memo: String(f.get("memo") ?? "") || undefined,
          state: String(f.get("state") ?? "") || undefined,
          grade: String(f.get("grade") ?? "") || undefined,
          plan: String(f.get("plan") ?? "") || undefined,
          contract_type: String(f.get("contract_type") ?? "") || undefined,
        });
        setBusy(false);
        if (res.ok) {
          form.reset();
          setGroup(autoGroup);
          setNewGroup("");
          setMsg({
            t: res.briefed
              ? `등록·병합 완료 — ${res.ai ? "AI 1차 분석" : "규칙기반"} 브리프 생성`
              : "등록·병합 완료 (기존 브리프 유지)",
            bad: false, id: res.brand_id,
          });
          router.refresh();
        } else {
          setMsg({ t: res.error || "등록 실패", bad: true });
        }
      }}
    >
      <label className="label">브랜드명 *</label>
      <input name="brand_name" className="f" placeholder="예: 오가닉힐" required />

      <label className="label" style={{ marginTop: 8 }}>이메일 또는 전화 * (중복 판정 키)</label>
      <input name="contact" className="f" placeholder="contact@brand.com / 010-…" required />

      <label className="label" style={{ marginTop: 8 }}>담당자명</label>
      <input name="contact_name" className="f" placeholder="홍길동 매니저" />

      <label className="label" style={{ marginTop: 8 }}>유입 경로 *</label>
      <select name="source" className="f" defaultValue="expo" required>
        <option value="expo">박람회</option>
        <option value="meta_ads">메타 광고</option>
        <option value="referrer">지인 소개</option>
        <option value="etc">기타</option>
      </select>

      <label className="label" style={{ marginTop: 8 }}>그룹</label>
      <select className="f" value={group} onChange={(e) => setGroup(e.target.value)}>
        <option value={autoGroup}>{autoGroup} (자동)</option>
        {groups.filter((g) => g.name !== autoGroup).map((g) => (
          <option key={g.name} value={g.name}>{g.name} ({g.n}명)</option>
        ))}
        <option value={NEW_GROUP}>새 그룹 만들기…</option>
      </select>
      {group === NEW_GROUP && (
        <input
          className="f" style={{ marginTop: 6 }} placeholder={`새 그룹명 — 예: ${today} · 여름박람회`}
          value={newGroup} onChange={(e) => setNewGroup(e.target.value)} required
        />
      )}

      <label className="label" style={{ marginTop: 8 }}>메모</label>
      <textarea name="memo" className="f" rows={2} placeholder="부스에서 미국 진출 문의…" />

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 11.5, color: "var(--ink3)", cursor: "pointer", fontWeight: 600 }}>
          기존 데이터 반영 — 단계·등급·플랜 (선택)
        </summary>
        <div className="grid g2" style={{ gap: 6, marginTop: 6 }}>
          <select name="state" className="f" defaultValue="">
            <option value="">단계: 리드확보(기본)</option>
            {STATES.filter((s) => s !== "dropped" && s !== "churned").map((s) => (
              <option key={s} value={s}>{STATE_LABELS[s]}</option>
            ))}
          </select>
          <select name="grade" className="f" defaultValue="">
            <option value="">등급 미정</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select name="plan" className="f" defaultValue="">
            <option value="">플랜 미정</option>
            {PLANS.map((p) => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
          </select>
          <select name="contract_type" className="f" defaultValue="">
            <option value="">계약형태 미정</option>
            <option value="mall">멀티몰</option>
            <option value="onboarding">온보딩</option>
          </select>
        </div>
      </details>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="btn pri" style={{ flex: 1 }} type="submit" disabled={busy}>
          {busy ? "등록 중…" : "등록 → 사전분석 실행"}
        </button>
      </div>

      {msg && (
        <div style={{ marginTop: 8, fontSize: 12, color: msg.bad ? "var(--danger)" : "var(--ok)", fontWeight: 600 }}>
          {msg.t}
          {msg.id && <Link href={`/brand/${msg.id}`} style={{ marginLeft: 8, textDecoration: "underline" }}>360 →</Link>}
        </div>
      )}
    </form>
  );
}
