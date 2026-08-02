export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_allowed: "허용되지 않은 이메일입니다. 관리자에게 문의하세요.",
  no_password: "비밀번호를 입력하세요.",
  bad_credentials: "이메일 또는 비밀번호가 올바르지 않습니다.",
};

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
          <p className="text-sm text-muted mt-1">내부 전용 · 등록 계정 이메일·비밀번호로 로그인</p>
        </div>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <div>
          <label className="label">이메일</label>
          <input className="input" type="email" name="email" placeholder="you@glovek.space" required autoFocus />
        </div>
        <div>
          <label className="label">비밀번호</label>
          <input className="input" type="password" name="password" placeholder="비밀번호" required />
        </div>
        {sp.error && (
          <p className="text-sm text-bad">{ERRORS[sp.error] ?? "로그인에 실패했습니다."}</p>
        )}
        <button className="btn btn-primary w-full justify-center" type="submit">
          로그인
        </button>
        <p className="text-xs text-muted">비밀번호는 파트장/대표가 계정 생성 시 설정합니다. 초기 비밀번호를 모르면 관리자에게 문의하세요.</p>
      </form>
    </div>
  );
}
