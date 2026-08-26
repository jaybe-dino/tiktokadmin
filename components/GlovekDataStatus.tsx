// glovek 콘텐츠 데이터 진단 카드(서버 컴포넌트) — 레퍼런스 검색이 0건일 때 "데이터가 없는 건지,
//   연결이 안 된 건지, 카테고리 표기가 다른 건지"를 어드민이 눈으로 확인하는 용도.
//   videos/products 실제 행수 + 카테고리 실값 분포(상위 30) + 이름 샘플을 보여준다.
import { glovekDataProfile } from "@/lib/glovek-content";

export default async function GlovekDataStatus() {
  const profile = await glovekDataProfile().catch(() => null);
  return (
    <div className="card">
      <div className="card-hd">
        <b>glovek 콘텐츠 데이터 진단</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>제안서 레퍼런스 검색(카테고리)이 참조하는 실데이터</span>
      </div>
      <div style={{ padding: "10px 14px", fontSize: 12 }}>
        {!profile ? (
          <div className="note">진단 조회 실패 — DB 연결을 확인하세요.</div>
        ) : (
          <>
            {!profile.configured && (
              <div className="note" style={{ marginBottom: 10, color: "#b3261e" }}>
                ⚠️ <b>GLOVEK_DB_URL_RO 미설정</b> — glovek DB 가 연결되지 않아 아래 진단·레퍼런스 검색이
                어드민 DB 를 보게 됩니다(사실상 항상 0건). Vercel 환경변수에 glovek 읽기전용 URL 을 넣고 재배포하세요.
              </div>
            )}
            {profile.tables.map((t) => (
              <div key={t.table} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>
                  {t.table === "videos" ? "🎬 videos(콘텐츠)" : "📦 products(제품)"}{" "}
                  {t.exists
                    ? <span className="cellchip cc-ok">약 {Number(t.rows ?? 0).toLocaleString("ko-KR")}건</span>
                    : <span className="cellchip cc-no">테이블 없음</span>}
                  {t.exists && (
                    <span style={{ color: "var(--ink3)", fontSize: 10.5, marginLeft: 6 }}>
                      카테고리 컬럼: {t.fields.category ? <code>{t.fields.category}</code> : "없음(이름·브랜드로만 검색)"}
                    </span>
                  )}
                </div>
                {t.categories.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {t.categories.map((c) => (
                      <span key={c.value} className="chip" style={{ fontSize: 10.5 }}>
                        {c.value} <b style={{ marginLeft: 3 }}>{c.count.toLocaleString("ko-KR")}</b>
                      </span>
                    ))}
                  </div>
                )}
                {t.samples.length > 0 && (
                  <div style={{ color: "var(--ink3)", fontSize: 10.5, marginTop: 5 }}>
                    샘플: {t.samples.join(" · ")}
                  </div>
                )}
                {t.columns.length > 0 && (
                  <div style={{ color: "var(--ink3)", fontSize: 10, marginTop: 4 }}>
                    컬럼: {t.columns.join(", ")}
                  </div>
                )}
              </div>
            ))}
            <div className="note" style={{ fontSize: 11 }}>
              제안서의 카테고리 검색은 위 카테고리 실값·이름·브랜드 컬럼에 대해 한글 파트+영문 동의어로 ILIKE 매칭합니다.
              여기 보이는 표기와 안 맞는 분류가 있으면 알려주세요 — 선택 목록을 실데이터 기준으로 조정합니다.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
