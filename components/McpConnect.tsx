"use client";

// 설정 — MCP 오퍼레이터 커넥터. 대표·파트장이 자기 토큰을 발급하고 연결법을 확인.
//   추론은 사용자 Claude 구독에서 → 앱 API 토큰 과금 없음. 토큰은 발급 직후 1회만 노출.
import { useState, useTransition } from "react";
import { issueMcpTokenAction, revokeMcpTokenAction } from "@/app/(dash)/settings/mcp-actions";

export default function McpConnect({
  endpoint,
  initialSet,
  hint,
  setAt,
}: {
  endpoint: string;
  initialSet: boolean;
  hint: string | null;
  setAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [issued, setIssued] = useState(initialSet);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const issue = () =>
    start(async () => {
      setMsg("");
      const r = await issueMcpTokenAction();
      if (r.ok && r.token) {
        setToken(r.token);
        setIssued(true);
        setMsg("토큰이 발급되었습니다 — 지금 복사해 두세요. 이 화면을 벗어나면 다시 볼 수 없습니다.");
      } else setMsg(r.error ?? "실패");
    });

  const revoke = () =>
    start(async () => {
      const r = await revokeMcpTokenAction();
      if (r.ok) { setToken(null); setIssued(false); setMsg("토큰을 폐기했습니다. 기존 연결은 더 이상 동작하지 않습니다."); }
      else setMsg(r.error ?? "실패");
    });

  return (
    <div className="card">
      <div className="card-hd">
        <b>🤖 AI 오퍼레이터 (MCP 커넥터)</b>
        <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>대표·파트장 전용</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 12 }}>
        <p className="note" style={{ margin: 0 }}>
          Claude 데스크톱·claude.ai·Claude Code에 이 서버를 붙이면, <b>자연어로 원장 운영</b>을 시킬 수 있습니다
          (브랜드 조회·단계 이동·담당 배정·리마인더·제안서 초안 등). 추론은 <b>내 Claude 구독</b>에서 수행되어
          앱에 별도 API 과금이 없습니다. 쓰기 작업은 서버에서 <b>인증·필수조건(게이트)을 강제</b>하므로 단계를 건너뛸 수 없습니다.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="tt" style={{ fontSize: 12.5 }}>상태:</span>
          {issued ? (
            <span className="chip grn">
              발급됨{hint ? ` ····${hint}` : ""}{setAt ? ` · ${setAt.slice(0, 10)}` : ""}
            </span>
          ) : (
            <span className="chip">미발급</span>
          )}
          <button className="btn btn-sm" disabled={pending} onClick={issue} style={{ marginLeft: "auto" }}>
            {issued ? "토큰 재발급" : "토큰 발급"}
          </button>
          {issued && (
            <button className="btn btn-sm" disabled={pending} onClick={revoke}>토큰 폐기</button>
          )}
        </div>

        {/* 엔드포인트 URL */}
        <div>
          <div className="tt" style={{ fontSize: 12, marginBottom: 4 }}>MCP 엔드포인트 (Streamable HTTP)</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <code style={codeBox}>{endpoint}</code>
            <button className="btn btn-sm" onClick={() => copy(endpoint, "endpoint")}>
              {copied === "endpoint" ? "복사됨" : "복사"}
            </button>
          </div>
        </div>

        {/* 발급된 토큰(1회 노출) */}
        {token && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 12 }}>
            <div className="tt" style={{ fontSize: 12, marginBottom: 4, color: "#166534" }}>
              발급된 토큰 (지금만 표시 · 안전하게 보관)
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <code style={{ ...codeBox, wordBreak: "break-all" }}>{token}</code>
              <button className="btn btn-sm" onClick={() => copy(token, "token")}>
                {copied === "token" ? "복사됨" : "복사"}
              </button>
            </div>
          </div>
        )}

        {/* 연결 방법 */}
        <details open>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12.5 }}>연결 방법 (클라이언트별)</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 12, fontSize: 12.5 }}>
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: 10 }}>
              <b>claude.ai (웹) · Claude 데스크톱 — 로그인(OAuth) 방식 · 토큰 불필요</b>
              <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
                <li>설정 → 커넥터 → <b>사용자 지정 커넥터 추가</b></li>
                <li>이름 <code>glovek</code>, URL에 <b>엔드포인트만</b> 입력(토큰 X):<br />
                  <code style={{ ...codeBox, display: "inline-block", marginTop: 3 }}>{endpoint}</code></li>
                <li>연결 시 뜨는 로그인 창에서 <b>어드민 계정(대표·파트장)</b>으로 로그인 → 승인</li>
              </ol>
              <span className="note">※ 유료 플랜(Pro/Max/Team)에서 커스텀 커넥터가 활성화됩니다.</span>
            </div>
            <div>
              <b>Claude Code (터미널)</b> — OAuth 자동:
              <code style={{ ...codeBox, display: "block", marginTop: 4, whiteSpace: "pre-wrap" }}>
                {`claude mcp add --transport http glovek ${endpoint}`}
              </code>
              <span className="note">실행 후 브라우저 로그인으로 승인. 헤더 토큰을 쓰려면 아래 “토큰 발급” 후:
                <code style={{ ...codeBox, display: "block", marginTop: 4, whiteSpace: "pre-wrap" }}>
                  {`claude mcp add --transport http glovek ${endpoint} \\\n  --header "Authorization: Bearer <토큰>"`}
                </code>
              </span>
            </div>
            <div className="note">
              연결 후 예: “<b>본토닉 인증 상태 점검하고 충족되면 다음 단계로 넘겨줘(반영 전 요약 먼저)</b>”,
              “<b>답장 없는 리드 목록 뽑아줘</b>”, “<b>이번 주 SLA 위반 정리해줘</b>”.
            </div>
          </div>
        </details>

        {msg && <div className="note">{msg}</div>}
      </div>
    </div>
  );
}

const codeBox: React.CSSProperties = {
  flex: 1, minWidth: 0, maxWidth: "100%", boxSizing: "border-box",
  background: "var(--bg2, #f6f7f9)", border: "1px solid var(--line, #e5e7eb)",
  borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: "ui-monospace, monospace",
  overflowWrap: "anywhere", wordBreak: "break-word",
};
