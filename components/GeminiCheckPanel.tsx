"use client";
// Gemini 연동 점검 — 이미지 번역이 실패할 때 "키인지 모델인지 한도인지"를 바로 가른다(BUG-46).
//   환경변수 "설정됨"은 입력 여부일 뿐이므로, 실제 호출로 확인한다. 비밀값은 표시하지 않는다.
import { useState } from "react";
import { geminiCheckAction, smsCheckAction } from "@/app/(dash)/settings/gemini-actions";

type Res = Awaited<ReturnType<typeof geminiCheckAction>>;

export default function GeminiCheckPanel() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 10 }}>
      <button data-testid="gemini-check" className="btn btn-sm" disabled={busy}
        onClick={async () => {
          setBusy(true); setRes(null);
          try { setRes(await geminiCheckAction()); }
          finally { setBusy(false); }
        }}>
        {busy ? "확인 중… (모델별로 실제 호출합니다)" : "🔍 Gemini 연동 점검(이미지 번역)"}
      </button>
      <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3 }}>
        이미지를 올리지 않고 키·모델이 실제로 동작하는지 확인합니다. 값은 표시하지 않습니다.
      </div>

      {res && !res.ok && res.error && !res.data && (
        <div data-testid="gemini-check-error" style={{ marginTop: 6, color: "#c92a2a", fontSize: 12 }}>{res.error}</div>
      )}

      {res?.data && (
        <div data-testid="gemini-check-result" style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ color: res.data.ok ? "#0b7a52" : "#c92a2a", fontWeight: 700 }}>
            {res.data.ok ? "정상 — 이미지 번역을 쓸 수 있습니다" : `문제 있음 — ${res.data.error ?? "확인 필요"}`}
          </div>
          <div style={{ color: "var(--ink3)", marginTop: 3 }}>
            키 {res.data.keySet ? <>설정됨(<code>{res.data.keyFrom}</code>)</> : "미설정"}
          </div>
          <table className="t" style={{ fontSize: 11.5, marginTop: 6, width: "100%" }}>
            <thead><tr><th>역할</th><th>모델</th><th>결과</th></tr></thead>
            <tbody>
              {res.data.results.map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.role}</td>
                  <td><code>{r.model}</code></td>
                  <td style={{ color: r.ok ? "#0b7a52" : "#c92a2a" }}>{r.ok ? "정상" : r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note" style={{ marginTop: 6, fontSize: 11 }}>
            · <b>텍스트 모델</b>이 실패하면 키·권한 문제입니다(결제 계정·API 사용 설정·키 제한 확인).<br />
            · <b>이미지 편집 기본 모델</b>만 실패하면 그 키에서 미리보기 모델을 못 쓰는 것입니다 —
            <code>GEMINI_IMAGE_MODEL</code> 로 폴백 모델을 지정하면 됩니다.<br />
            · 모델 설정은 <code>GEMINI_TEXT_MODEL</code> · <code>GEMINI_IMAGE_MODEL</code> ·
            <code>GEMINI_IMAGE_MODEL_FALLBACK</code> 로 바꿀 수 있습니다(변경 후 재배포 필요).
          </div>
        </div>
      )}
    </div>
  );
}

type SmsRes = Awaited<ReturnType<typeof smsCheckAction>>;

/** 문자(ALIGO) 연동 점검 — "fetch failed" 의 원인을 키·프록시·네트워크로 가른다. */
export function SmsCheckPanel() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SmsRes | null>(null);

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 10 }}>
      <button data-testid="sms-check" className="btn btn-sm" disabled={busy}
        onClick={async () => {
          setBusy(true); setRes(null);
          try { setRes(await smsCheckAction()); }
          finally { setBusy(false); }
        }}>
        {busy ? "확인 중…" : "🔍 문자(ALIGO) 연동 점검"}
      </button>
      <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3 }}>
        <b>문자를 보내지 않고</b> 잔여 건수 조회로 접속·인증만 확인합니다. 값은 표시하지 않습니다.
      </div>

      {res && !res.data && res.error && (
        <div data-testid="sms-check-error" style={{ marginTop: 6, color: "#c92a2a", fontSize: 12 }}>{res.error}</div>
      )}

      {res?.data && (
        <div data-testid="sms-check-result" style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ color: res.data.reachable ? "#0b7a52" : "#c92a2a", fontWeight: 700 }}>
            {res.data.reachable ? "정상 — 문자 발송 경로가 살아 있습니다" : `문제 있음 — ${res.data.note}`}
          </div>
          <div style={{ color: "var(--ink3)", marginTop: 3, lineHeight: 1.8 }}>
            · 환경변수 {res.data.envOk ? "설정됨" : `미설정: ${res.data.missing.join(", ")}`}<br />
            · 고정 IP 프록시 {res.data.proxySet
              ? <>사용 중(<code>{res.data.proxyHost}</code> · <code>{res.data.proxyFrom}</code>)</>
              : "미사용 — ALIGO 가 발송 IP를 제한하면 인증 오류가 납니다"}<br />
            · 테스트 모드 {res.data.testMode ? <b style={{ color: "#c25400" }}>켜짐 — 실제로 발송되지 않습니다</b> : "꺼짐(실발송)"}
            {res.data.remain && <><br />· 잔여 SMS {res.data.remain.sms} · LMS {res.data.remain.lms} · MMS {res.data.remain.mms}</>}
          </div>
          {!res.data.reachable && (
            <div className="note" style={{ marginTop: 6, fontSize: 11 }}>
              · <b>프록시 연결 실패</b>로 나오면 고정 IP 프록시(Fixie 등)의 <b>요금제·한도·비밀번호</b>를 확인하세요.<br />
              · <b>주소를 찾지 못함·연결 시간 초과</b>면 네트워크 문제입니다(잠시 후 재시도).<br />
              · <b>인증오류</b> 계열이면 ALIGO 키·아이디·<b>발신번호 사전등록</b>과 발송 IP 등록을 확인하세요.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
