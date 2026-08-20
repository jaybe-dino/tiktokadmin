"use client";
// 상단 우측 개선/업데이트 알림 — 최근 개선사항을 드롭다운으로 안내. 새 항목 있으면 빨간 점.
import { useEffect, useRef, useState } from "react";

// 최신이 맨 위. id 를 바꾸면(=새 배포) 사용자에게 다시 '새 업데이트' 점이 표시됨.
const CHANGELOG: { id: string; date: string; title: string; desc: string }[] = [
  { id: "2026-08-20-e", date: "8/20", title: "마케팅 제안서 PDF(A4 가로 데크)", desc: "마케팅 제안서를 슬라이드형으로 만들고 A4 가로 PDF로 저장할 수 있어요." },
  { id: "2026-08-20-d", date: "8/20", title: "버그 해결 시 슬랙 알림", desc: "제보한 기능오류가 개발 완료되면 작성자에게 슬랙 DM이 갑니다." },
  { id: "2026-08-20-c", date: "8/20", title: "온보딩 전 단계 동시 작성", desc: "온보딩 신청서 1~5단계를 처음부터 모두 작성할 수 있게 열렸어요." },
  { id: "2026-08-20-b", date: "8/20", title: "LOA 수권서 PDF 다운로드", desc: "온보딩 검토에서 LOA 서명 문서를 PDF로 바로 받을 수 있어요." },
  { id: "2026-08-20-a", date: "8/20", title: "온보딩 목록에 입점 국가 표시", desc: "각 브랜드사 옆에 입점 희망 국가가 바로 보입니다." },
  { id: "2026-08-19-b", date: "8/19", title: "제안서 미리보기 저장 반영", desc: "미리보기가 편집 내용을 먼저 저장 후 열려 금액·로고·레퍼런스가 정확히 반영됩니다." },
  { id: "2026-08-19-a", date: "8/19", title: "마케팅 파이프라인 '미팅 예정' 단계", desc: "협의 중과 수주·계약 사이에 미팅 예정 단계가 추가됐어요." },
  { id: "2026-08-18", date: "8/18", title: "영업 파이프라인 '보류' 단계", desc: "맨 앞 보류 단계에 언제든 카드를 둘 수 있고 3일 SLA로 관리됩니다." },
];
const LATEST = CHANGELOG[0]?.id ?? "";
const KEY = "gk_updates_seen";

export default function UpdatesButton() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(LATEST); // SSR·초기엔 점 숨김
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { try { setSeen(localStorage.getItem(KEY)); } catch { setSeen(LATEST); } }, []);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const hasNew = seen !== LATEST;

  function toggle() {
    const next = !open; setOpen(next);
    if (next && hasNew) { try { localStorage.setItem(KEY, LATEST); } catch { /* noop */ } setSeen(LATEST); }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={toggle} title="개선/업데이트" aria-label="개선/업데이트"
        style={{ position: "relative", width: 34, height: 34, borderRadius: 9, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 16, cursor: "pointer" }}>
        📣
        {hasNew && <span style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: "#ef4444", border: "1.5px solid #fff" }} />}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 40, width: 340, maxHeight: 440, overflowY: "auto", background: "#fff",
          border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 12px 32px rgba(15,23,42,.16)", zIndex: 60, padding: 6 }}>
          <div style={{ padding: "8px 10px", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            ✨ 최근 개선사항 <span style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 500 }}>업데이트가 반영되었습니다</span>
          </div>
          {CHANGELOG.map((c) => (
            <div key={c.id} style={{ padding: "9px 10px", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 700, flexShrink: 0 }}>{c.date}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{c.title}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3, lineHeight: 1.5 }}>{c.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
