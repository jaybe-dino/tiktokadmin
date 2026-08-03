"use client";

// v3.1 s-b360 헤더 우측 액션 버튼(✉️ 메일 · 📱 문자 · 📞 접촉 기록 · 상태 이동)
// + 담당 표시/변경. 기존 서버액션 재사용 — 게이트(transitionAction)·canSend(sendSmsAction) 경유.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignAction, composeEmailAction, deleteBrandAction, dropAction,
  logContactAction, remindAction, sendSmsAction, sendWelcomeAction, transitionAction,
} from "@/app/actions";
import { FORWARD_TRANSITIONS } from "@/lib/states";
import { STATE_LABELS, type Brand, type OwnerField, type State } from "@/lib/types";

type AdminUser = { id: string; name: string; role: string };

function initials(name: string): string {
  return (name || "?").trim().slice(0, 2);
}

export default function Brand360Header({ brand, adminUsers, ddayLabel }: {
  brand: Brand; adminUsers: AdminUser[]; ddayLabel: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<"mail" | "sms" | "move" | null>(null);
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null);
  const [smsText, setSmsText] = useState("");
  const [dropReason, setDropReason] = useState("");

  function flash(t: string, bad = false) {
    setMsg({ t, bad });
    setTimeout(() => setMsg(null), 4000);
    router.refresh();
  }

  const nextStates = (FORWARD_TRANSITIONS[brand.state] ?? []).filter((s) => s !== "dropped" && s !== "churned");
  const userName = (uid: string | null) => (uid ? adminUsers.find((u) => u.id === uid)?.name ?? "지정됨" : null);
  const salesName = userName(brand.owner_sales);

  const ownerSelect = (field: OwnerField, label: string) => (
    <select
      className="f"
      style={{ width: "auto", padding: "2px 6px", fontSize: 12, marginTop: 2 }}
      defaultValue={(brand[field] as string) ?? ""}
      onChange={(e) =>
        start(async () => {
          const r = await assignAction(brand.id, field, e.target.value);
          flash(r.ok ? `${label} 담당 변경` : r.error || "실패", !r.ok);
        })
      }
    >
      <option value="">미지정</option>
      {adminUsers.map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      {/* 담당 3열 (v3.1: 영업 담당 · 온보딩 · 다음 액션) — select 로 실제 배정 가능 */}
      <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
        <div>
          <div style={{ color: "var(--ink3)", fontSize: 10.5, fontWeight: 700 }}>영업 담당</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {salesName && <span className="av" style={{ width: 20, height: 20, fontSize: 9 }}>{initials(salesName)}</span>}
            {ownerSelect("owner_sales", "영업")}
          </div>
        </div>
        <div>
          <div style={{ color: "var(--ink3)", fontSize: 10.5, fontWeight: 700 }}>온보딩</div>
          {ownerSelect("owner_onboard", "온보딩")}
        </div>
        <div>
          <div style={{ color: "var(--ink3)", fontSize: 10.5, fontWeight: 700 }}>다음 액션</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>
            {brand.next_action || "—"}
            {ddayLabel && <span style={{ color: "var(--warn)", marginLeft: 4 }}>({ddayLabel})</span>}
          </div>
        </div>
      </div>

      {/* 액션 버튼 (v3.1 그대로) */}
      <div style={{ display: "flex", gap: 6, position: "relative", flexWrap: "wrap" }}>
        <button className="btn" disabled={pending} onClick={() => setOpen(open === "mail" ? null : "mail")}>✉️ 메일</button>
        <button className="btn" disabled={pending} onClick={() => setOpen(open === "sms" ? null : "sms")}>📱 문자</button>
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await logContactAction(brand.id, "call", "통화");
              flash(r.ok ? "접촉 기록됨" : r.error || "실패", !r.ok);
            })
          }
        >
          📞 접촉 기록
        </button>
        <button className="btn pri" disabled={pending} onClick={() => setOpen(open === "move" ? null : "move")}>상태 이동</button>
      </div>

      {msg && (
        <span className={`chip ${msg.bad ? "red" : "grn"}`} style={{ fontSize: 11 }}>{msg.t}</span>
      )}

      {/* ── 메일 메뉴: AI 초안 · 리마인더 · 안내 발송(기존 기능 유지) ── */}
      {open === "mail" && (
        <div className="card" style={{ width: "100%", padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn sm pri"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await composeEmailAction(brand.id);
                flash(r.ok ? `AI 초안 생성됨 → 미팅·메일 탭/초안함에서 승인·발송 (${r.subject ?? ""})` : r.error || "실패", !r.ok);
                setOpen(null);
              })
            }
          >
            ✨ AI 메일 초안 생성
          </button>
          <button
            className="btn sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await remindAction(brand.id, "email");
                flash(r.ok ? (r.sent ? "리마인더 발송됨" : "리마인더 초안 생성(미발송)") : r.error || "실패", !r.ok);
                setOpen(null);
              })
            }
          >
            리마인더
          </button>
          <button
            className="btn sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await sendWelcomeAction(brand.id, true);
                if (!r.ok) flash(r.error ?? "실패", true);
                else if (r.sent?.length) flash(`안내 발송됨: ${r.sent.join("·")}`);
                else flash("발송 채널 없음 — ALIGO·RESEND 키/연락처 확인", true);
                setOpen(null);
              })
            }
          >
            📨 안내 발송(문자·메일)
          </button>
        </div>
      )}

      {/* ── 문자 발송 (Aligo · canSend 게이트 경유) ── */}
      {open === "sms" && (
        <div className="card" style={{ width: "100%", padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {brand.phone ? (
            <>
              <span className="chip">{brand.phone}</span>
              <input
                className="f"
                style={{ flex: 1, minWidth: 200 }}
                placeholder="문자 내용"
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
              />
              <button
                className="btn sm pri"
                disabled={pending || !smsText.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await sendSmsAction({ brand_id: brand.id, receiver: brand.phone!, msg: smsText });
                    flash(r.ok ? "문자 발송됨 · 접촉 기록 갱신" : r.error || "실패", !r.ok);
                    if (r.ok) { setSmsText(""); setOpen(null); }
                  })
                }
              >
                발송
              </button>
            </>
          ) : (
            <span className="note" style={{ flex: 1 }}>전화번호가 없어 문자를 보낼 수 없습니다 — 회사정보 탭에서 연락처를 입력하세요.</span>
          )}
        </div>
      )}

      {/* ── 상태 이동 (게이트 검증) + 드랍 + 유입·광고 담당 + 삭제(기존 기능 유지) ── */}
      {open === "move" && (
        <div className="card" style={{ width: "100%", padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)" }}>다음 상태 (게이트 검증)</span>
            {nextStates.length === 0 && <span className="note">전진 가능한 다음 상태 없음</span>}
            {nextStates.map((s: State) => (
              <button
                key={s}
                className="btn sm pri"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await transitionAction(brand.id, s);
                    flash(r.ok ? `${STATE_LABELS[s]}(으)로 이동` : r.failed?.map((f) => f.label).join(" · ") || r.error || "게이트 미충족", !r.ok);
                    if (r.ok) setOpen(null);
                  })
                }
              >
                {STATE_LABELS[s]} ▸
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)" }}>유입·광고 담당</span>
            {ownerSelect("owner_intake", "유입")}
            {ownerSelect("owner_ads", "광고")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="f"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="드랍 사유"
              value={dropReason}
              onChange={(e) => setDropReason(e.target.value)}
            />
            <button
              className="btn sm dgr"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await dropAction(brand.id, dropReason);
                  flash(r.ok ? "드랍 처리됨" : r.error || "사유 필요", !r.ok);
                  if (r.ok) setOpen(null);
                })
              }
            >
              드랍
            </button>
            <button
              className="btn sm dgr"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!confirm(`'${brand.brand_name}' 을(를) 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return;
                  const r = await deleteBrandAction(brand.id);
                  if (r.ok) router.push("/");
                  else flash(r.error || "삭제 실패", true);
                })
              }
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
