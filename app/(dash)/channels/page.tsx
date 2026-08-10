import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { listChannels, recentChannelSends, channelSendCounts } from "@/lib/intake-channels";
import { getWelcomeConfig } from "@/lib/welcome";
import { listIntakeSources } from "@/lib/intake-sources";
import ChannelManager from "@/components/ChannelManager";
import IntakeSourceManager from "@/components/IntakeSourceManager";
import Link from "next/link";

export const dynamic = "force-dynamic";

// 유입 소스·자동발송 — 소스 id 키(유입 루트 인증) + 자동발송 허용 체크 + 소스별 문자·메일 템플릿.
export default async function ChannelsPage() {
  const user = (await currentUser())!;
  const canEdit = user.role === "lead" || user.role === "exec";
  const [channels, welcomeCfg, sources] = await Promise.all([
    listChannels(),
    getWelcomeConfig().catch(() => null),
    listIntakeSources(),
  ]);
  const sourceOpts = sources.filter((s) => s.enabled).map((s) => ({ key: s.key, label: s.label }));
  const ids = channels.map((c) => c.id);
  const [sends, sendCounts] = await Promise.all([
    recentChannelSends(ids).catch(() => ({})),
    channelSendCounts(ids).catch(() => ({})),
  ]);

  const active = channels.filter((c) => c.enabled).length;
  const totalLeads = channels.reduce((s, c) => s + (c.lead_count ?? 0), 0);

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="유입 소스 · 자동발송"
        desc={`등록 소스 ${channels.length} · 자동발송 허용 ${active} · 누적 유입 ${totalLeads}건`}
        right={!canEdit ? <span className="chip chip-amb">읽기 전용 (편집은 파트장/대표만)</span> : undefined}
      />

      {/* 스탯 타일 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="tile"><div className="tile-k">등록 소스</div><div className="tile-v">{channels.length}</div></div>
        <div className="tile"><div className="tile-k">자동발송 허용</div><div className="tile-v">{active}</div></div>
        <div className="tile"><div className="tile-k">누적 유입</div><div className="tile-v">{totalLeads}</div></div>
      </div>

      <ChannelManager channels={channels} canEdit={canEdit} sends={sends} sendCounts={sendCounts} sources={sourceOpts} />

      <div style={{ marginTop: 14 }}>
        <IntakeSourceManager sources={sources} canEdit={canEdit} />
      </div>

      <div className="card" style={{ marginTop: 14, padding: 16 }}>
        <b>동작 방식</b>
        <ol style={{ margin: "8px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "var(--ink2)" }}>
          <li><b>소스 추가</b> → 그 소스 전용 <b>id 키</b>가 발급됩니다 (유입 루트 인증용).</li>
          <li><b>POST URL</b> 복사 → <code>?key=&lt;VERCEL_KEY&gt;&source=&lt;소스id&gt;</code>. <code>&lt;VERCEL_KEY&gt;</code>는 Vercel <code>LEADHOOK_SECRET</code> 값으로 교체.</li>
          <li>Zapier·외부 DB 를 그 URL 로 연결. 두 키(전역 시크릿 + 소스 id)가 맞아야 유입 인가.</li>
          <li><b>자동발송 허용</b> 체크된 소스만 자동 문자·메일. 「내용」에서 <b>소스별 문자·메일 템플릿</b> 설정(비우면 전역 문구).</li>
        </ol>
        <div className="note" style={{ marginTop: 10 }}>
          전역 자동안내 문구는 <Link href="/settings" style={{ color: "var(--acc)" }}>설정 → 신규 리드 자동 안내</Link>에서 관리합니다{welcomeCfg?.enabled ? " (활성)" : " (비활성)"}.
        </div>
      </div>
    </div>
  );
}
