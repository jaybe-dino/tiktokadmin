import ScreenHeader from "@/components/ScreenHeader";
import { query } from "@/lib/db";
import SendTabs from "./SendTabs";

export const dynamic = "force-dynamic";

export default async function SendPage() {
  const sends = (await query(
    `SELECT id, title, target_kind, channel, status, total, sent, body_md, created_at
       FROM bulk_sends
      ORDER BY created_at DESC NULLS LAST
      LIMIT 100`,
  ).catch(() => [])) as Record<string, unknown>[];

  return (
    <div>
      <ScreenHeader
        title="발송 센터 — 메일·문자"
        desc="모든 발송은 회사 이메일·지정 번호로만 나가고, 결과는 각 고객카드 히스토리에 자동 연동됩니다"
        right={<span className="chip">발신: @dinostudio.kr · 1533-06xx</span>}
      />
      <SendTabs sends={sends} />
    </div>
  );
}
