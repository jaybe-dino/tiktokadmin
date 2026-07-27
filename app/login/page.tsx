export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        method="POST"
        action="/api/auth/login"
        className="card p-8 w-full max-w-sm space-y-4"
      >
        <div>
          <h1 className="text-xl font-extrabold">Glovek 운영 어드민</h1>
          <p className="text-sm text-muted mt-1">내부 전용 · 화이트리스트 이메일로 로그인</p>
        </div>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <div>
          <label className="label">이메일</label>
          <input className="input" type="email" name="email" placeholder="you@glovek.space" required autoFocus />
        </div>
        {sp.error === "not_allowed" && (
          <p className="text-sm text-bad">허용되지 않은 이메일입니다. 관리자에게 문의하세요.</p>
        )}
        <button className="btn btn-primary w-full justify-center" type="submit">
          로그인
        </button>
      </form>
    </div>
  );
}
