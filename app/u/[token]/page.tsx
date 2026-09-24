import { verifyToken } from "@/lib/ad-optout";
import OptOutForm from "./OptOutForm";

export const dynamic = "force-dynamic";
// 링크를 여는 것(GET)만으로는 아무 것도 바뀌지 않는다 — 버튼을 눌러야 확정된다.
//   메일 미리보기·보안 스캐너가 링크를 미리 열어도 오수신거부가 생기지 않게 하기 위함.
export const metadata = { title: "광고 수신거부 · GloveK", robots: { index: false, follow: false } };

const wrap: React.CSSProperties = {
  maxWidth: 520, margin: "0 auto", padding: "28px 18px 48px",
  fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif", color: "#111",
};

export default async function AdOptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = Boolean(verifyToken(token));

  return (
    <div style={wrap}>
      <div style={{ fontSize: 12, letterSpacing: ".1em", color: "#8b93a1", fontWeight: 700 }}>DINO STUDIO · GloveK</div>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: "6px 0 14px" }}>광고 수신거부</h1>

      {!ok ? (
        <div data-testid="optout-invalid" style={{ border: "1px solid #f3b8b8", background: "#fff5f5", borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#c92a2a" }}>유효하지 않은 링크입니다.</div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7, color: "#7a4a4a" }}>
            주소가 잘리거나 바뀐 것 같습니다. <b>아무 것도 변경되지 않았습니다.</b><br />
            받으신 문자·메일의 링크를 다시 눌러 주시거나, 회신으로 알려주시면 처리해 드리겠습니다.
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 14.5, lineHeight: 1.8, color: "#374151", marginBottom: 16 }}>
            아래 버튼을 누르면 <b>광고 목적의 문자·메일 발송이 중단</b>됩니다.
            로그인이나 사유 입력은 필요하지 않습니다.
          </div>
          <OptOutForm token={token} />
          <div style={{ marginTop: 16, fontSize: 12.5, lineHeight: 1.8, color: "#6b7280" }}>
            · 수신거부는 <b>광고에만</b> 적용됩니다. 계약·일정·거래 확인 등 <b>서비스 안내</b>는 계속 보내드릴 수 있습니다.<br />
            · 버튼을 누르기 전에는 <b>아무 것도 변경되지 않습니다.</b><br />
            · 이미 발송 처리된 건은 회수되지 않아 한두 건이 더 도착할 수 있습니다.
          </div>
        </>
      )}
    </div>
  );
}
