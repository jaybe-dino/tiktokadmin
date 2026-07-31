import { listDrafts } from "@/lib/drafts";
import DraftCard from "@/components/DraftCard";

export const dynamic = "force-dynamic";

// 초안함 (Drafts Inbox, 06 M7) — AI/미팅 팔로업 메일 초안 승인·발송.
export default async function DraftsPage() {
  const drafts = await listDrafts("draft").catch(() => []);
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold mb-1">초안함</h1>
      <p className="text-sm text-muted mb-4">
        미팅 팔로업·AI 답장 초안 {drafts.length}건 — 승인 시 발송(광고성은 수신동의 확인).
      </p>
      {drafts.length === 0 ? (
        <div className="card p-6 text-sm text-muted">대기 중인 초안이 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => <DraftCard key={d.id} draft={d} />)}
        </div>
      )}
    </div>
  );
}
