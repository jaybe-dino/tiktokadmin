// 대표자 여권 사진면 예시(재현 목업) — apply Step3 업로드 안내용(BUG-57).
//   실제 여권 이미지를 쓰지 않는다. 어떤 면을 어떻게 찍어야 하는지만 보여주는
//   가상의 재현 화면이며, 적힌 이름·번호는 모두 예시값이다.
import { PASSPORT_GUIDE } from "@/lib/onb-constants";

const page: React.CSSProperties = {
  background: "linear-gradient(180deg,#f7f5ee 0%,#efece2 100%)",
  border: "1px solid #ddd6c4", borderRadius: 6, padding: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,.08)",
};
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "76px 1fr", gap: 6, marginBottom: 5 };
const key: React.CSSProperties = { fontSize: 8.5, color: "#8a8372", letterSpacing: ".03em", lineHeight: 1.3 };
const val: React.CSSProperties = { fontSize: 10, color: "#2b2a25", fontWeight: 600, lineHeight: 1.3 };

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div style={row}>
      <div style={key}>{k}</div>
      <div style={val}>{v}</div>
    </div>
  );
}

export default function PassportExample() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 12, alignItems: "start" }}>
        {/* 좋은 예 */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0b7a52", marginBottom: 5 }}>⭕ 이렇게 올려주세요</div>
          <div style={page}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #ded7c6", paddingBottom: 5, marginBottom: 7 }}>
              <span style={{ fontSize: 8.5, color: "#8a8372", letterSpacing: ".06em" }}>REPUBLIC OF KOREA · PASSPORT</span>
              <span style={{ fontSize: 8.5, color: "#8a8372" }}>PM</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "54px minmax(0,1fr)", gap: 9 }}>
              {/* 사진 자리 — 사람 얼굴을 그리지 않고 자리만 표시한다 */}
              <div style={{ height: 68, borderRadius: 3, border: "1px solid #cfc7b4", background: "repeating-linear-gradient(135deg,#e6e1d4 0 5px,#ded8c8 5px 10px)", display: "grid", placeItems: "center" }}>
                <span style={{ fontSize: 8, color: "#8a8372" }}>사진</span>
              </div>
              <div>
                <Line k="PASSPORT NO." v="M12345678" />
                <Line k="SURNAME" v="HONG" />
                <Line k="GIVEN NAMES" v="GILDONG" />
                <Line k="DATE OF BIRTH" v="01 JAN 1980" />
                <Line k="DATE OF EXPIRY" v="31 DEC 2032" />
              </div>
            </div>
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #ded7c6", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 8, color: "#6f6959", letterSpacing: ".04em", lineHeight: 1.5, wordBreak: "break-all" }}>
              P&lt;KORHONG&lt;&lt;GILDONG&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;<br />
              M12345678&lt;4KOR8001011M3212319&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: "#0b7a52", marginTop: 5 }}>가상의 예시값입니다. 네 모서리가 모두 보이고 글자가 선명합니다.</div>
        </div>

        {/* 안내 + 나쁜 예 */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#111", marginBottom: 5 }}>촬영 기준</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.75, color: "#374151" }}>
            {PASSPORT_GUIDE.map((g) => <li key={g}>{g}</li>)}
          </ul>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#c92a2a", margin: "10px 0 5px" }}>❌ 이런 사진은 반려됩니다</div>
          <div style={{ display: "grid", gap: 4, fontSize: 11.5, color: "#7a2b2b", lineHeight: 1.6 }}>
            <div>· 모서리가 잘린 사진</div>
            <div>· 빛 반사로 이름·번호가 안 보이는 사진</div>
            <div>· 비자·도장 면만 찍은 사진 (사진면이 필요합니다)</div>
            <div>· 화면을 다시 촬영한 사진 (모아레·반사)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
