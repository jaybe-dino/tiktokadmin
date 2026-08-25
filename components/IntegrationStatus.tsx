// 연동 상태 카드(서버 컴포넌트) — 배포 환경에 어떤 외부 연동 키가 인식되는지 한눈에.
//   값은 절대 노출하지 않고 "설정됨/미설정 + 어떤 변수명으로 인식됐는지"만 표시한다.
//   (예: Apify 키를 어떤 이름으로 넣었는지 기억 안 날 때 여기서 바로 확인)

function matched(...names: string[]): { ok: boolean; via?: string } {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return { ok: true, via: n };
  }
  return { ok: false };
}

interface Row { label: string; feature: string; names: string[]; extra?: string[] }

const ROWS: Row[] = [
  { label: "Claude AI", feature: "AI 초안·제안·요약 전반", names: ["ANTHROPIC_API_KEY"] },
  { label: "Gemini(나노바나나)", feature: "상세페이지 이미지 번역", names: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], extra: ["GEMINI_IMAGE_MODEL"] },
  { label: "Apify", feature: "틱톡 레퍼런스 자동조회(영상·샵)", names: ["APIFY_TOKEN", "APIFY_API_TOKEN", "APIFY_API_KEY", "APIFY_KEY"], extra: ["APIFY_TIKTOK_ACTOR", "APIFY_TIKTOK_SHOP_ACTOR"] },
  { label: "Resend", feature: "이메일 발송", names: ["RESEND_API_KEY"] },
  { label: "Slack Bot", feature: "알림·SLA 멘션", names: ["SLACK_BOT_TOKEN"] },
  { label: "Aligo", feature: "문자 발송", names: ["ALIGO_API_KEY"] },
  { label: "glovek DB(RO)", feature: "glovek 원본 동기화", names: ["GLOVEK_DB_URL_RO"] },
];

export default function IntegrationStatus() {
  return (
    <div className="card">
      <div className="card-hd">
        <b>연동 상태</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>이 배포에서 인식된 외부 연동 키 — 값은 표시하지 않음</span>
      </div>
      <div style={{ padding: "10px 14px" }}>
        <table className="t" style={{ fontSize: 12 }}>
          <tbody>
            {ROWS.map((r) => {
              const m = matched(...r.names);
              const extras = (r.extra ?? []).filter((n) => process.env[n]?.trim());
              return (
                <tr key={r.label}>
                  <td style={{ whiteSpace: "nowrap" }}><b>{r.label}</b><div style={{ fontSize: 10.5, color: "var(--ink3)" }}>{r.feature}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {m.ok
                      ? <span className="cellchip cc-ok">설정됨</span>
                      : <span className="cellchip cc-no">미설정</span>}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--ink3)" }}>
                    {m.ok
                      ? <>인식된 변수: <code>{m.via}</code>{extras.length > 0 && <> · 오버라이드: {extras.map((n) => <code key={n} style={{ marginRight: 4 }}>{n}</code>)}</>}</>
                      : <>다음 중 하나로 등록: {r.names.map((n) => <code key={n} style={{ marginRight: 4 }}>{n}</code>)}</>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="note" style={{ marginTop: 8, fontSize: 11 }}>
          환경변수 추가·변경 후에는 Vercel <b>재배포</b>가 있어야 반영됩니다.
        </div>
      </div>
    </div>
  );
}
