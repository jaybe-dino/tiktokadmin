import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getIntroByToken } from "@/lib/brand-intro";
import { INTRO_LANGS, INTRO_SECTIONS } from "@/lib/intro-langs";

export const dynamic = "force-dynamic";

// 공개 소개자료 — 발행된 문서만. 초안은 관리자 세션으로 ?preview=1 일 때만 열린다.
//   검색엔진에 올리지 않는다(브랜드 자료가 색인되지 않게).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await getIntroByToken(token);
  return {
    title: d ? `${d.brand_name} · ${INTRO_LANGS[d.lang]?.label ?? ""} 소개자료` : "소개자료",
    robots: { index: false, follow: false },
  };
}

const SECTION_KO: Record<string, string> = Object.fromEntries(INTRO_SECTIONS.map((s) => [s.key, s.ko]));
const ORDER = INTRO_SECTIONS.map((s) => s.key) as string[];

const CONTACT_LABEL: Record<string, { heading: string; line: string }> = {
  en: { heading: "Distribution inquiries", line: "For partnership and distribution inquiries, please contact:" },
  ja: { heading: "流通に関するお問い合わせ", line: "取扱い・流通に関するお問い合わせはこちらまでご連絡ください。" },
  th: { heading: "ติดต่อเรื่องการจัดจำหน่าย", line: "สำหรับการสอบถามเรื่องการจัดจำหน่ายและความร่วมมือ กรุณาติดต่อ" },
  vi: { heading: "Liên hệ phân phối", line: "Vui lòng liên hệ để trao đổi về hợp tác và phân phối:" },
  ms: { heading: "Pertanyaan pengedaran", line: "Untuk pertanyaan kerjasama dan pengedaran, sila hubungi:" },
};

export default async function IntroPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { token } = await params;
  const { preview } = await searchParams;
  const d = await getIntroByToken(token);
  if (!d) notFound();

  // 초안 미리보기는 관리자만 — 발행 전 문서가 링크만으로 새지 않게 한다.
  if (d.status !== "published") {
    const admin = preview === "1" ? await currentUser().catch(() => null) : null;
    if (!admin) notFound();
  }

  const lang = INTRO_LANGS[d.lang];
  const sections = [...d.sections].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const contact = CONTACT_LABEL[d.lang] ?? CONTACT_LABEL.en;
  const htmlLang = d.lang === "ms" ? "ms" : d.lang;

  return (
    <main lang={htmlLang} style={{ background: "#f6f7f9", minHeight: "100vh", padding: "28px 16px 72px" }}>
      <article style={{ maxWidth: 820, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 1px 3px rgba(16,24,40,.08)", overflow: "hidden" }}>
        {d.status !== "published" && (
          <div style={{ background: "#fff5eb", color: "#c25400", fontSize: 12.5, padding: "9px 26px", fontWeight: 600 }}>
            초안 미리보기 — 아직 발행되지 않았습니다. 이 화면은 관리자에게만 보입니다.
          </div>
        )}
        <header style={{ padding: "34px 26px 26px", background: "linear-gradient(135deg,#111827,#1f2937)", color: "#fff" }}>
          <div style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", opacity: .7 }}>
            GLOVEK · BRAND INTRODUCTION · {String(d.lang).toUpperCase()}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, marginTop: 10, lineHeight: 1.3 }}>{d.title || d.brand_name}</h1>
          {d.subtitle && <p style={{ marginTop: 8, fontSize: 14.5, opacity: .85, lineHeight: 1.6 }}>{d.subtitle}</p>}
          <div style={{ marginTop: 12, fontSize: 12, opacity: .7 }}>{d.brand_name} · {lang?.market ?? ""}</div>
        </header>

        <div style={{ padding: "8px 26px 26px" }}>
          {sections.length === 0 ? (
            <p style={{ padding: "24px 0", color: "#6b7280", fontSize: 14 }}>준비 중입니다.</p>
          ) : sections.map((s) => (
            <section key={s.key} style={{ padding: "22px 0", borderBottom: "1px solid #eef0f3" }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>
                {s.heading || SECTION_KO[s.key] || s.key}
              </h2>
              <div style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.85, color: "#243044", whiteSpace: "pre-wrap" }}>{s.body}</div>
            </section>
          ))}

          {/* 유통 문의 — 글로브K 창구. 브랜드사 개인 연락처는 넣지 않는다. */}
          {d.contact_email && (
            <section style={{ marginTop: 22, background: "#f3f6ff", border: "1px solid #dfe7ff", borderRadius: 12, padding: "18px 20px" }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1d4ed8" }}>{contact.heading}</h2>
              <p style={{ marginTop: 6, fontSize: 14, color: "#243044", lineHeight: 1.7 }}>{contact.line}</p>
              <a href={`mailto:${d.contact_email}`} style={{ display: "inline-block", marginTop: 6, fontSize: 15, fontWeight: 700, color: "#1d4ed8" }}>
                {d.contact_email}
              </a>
              <div style={{ marginTop: 6, fontSize: 12, color: "#5b657a" }}>GLOVEK (DINO STUDIO) · TikTok Shop partner</div>
            </section>
          )}

          {/* 근거 표기 — 어떤 자료로 썼는지 문서에 그대로 남긴다. */}
          {d.evidence.length > 0 && (
            <footer style={{ marginTop: 22, fontSize: 11.5, color: "#8b93a1", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: "#6b7280" }}>Sources provided by the brand</div>
              <ul style={{ margin: "4px 0 0 16px" }}>
                {d.evidence.map((e) => <li key={e.ref}>{e.label}</li>)}
              </ul>
              <div style={{ marginTop: 8 }}>
                Last updated {String(d.generated_at ?? d.updated_at).slice(0, 10)}
              </div>
            </footer>
          )}
        </div>
      </article>
    </main>
  );
}
