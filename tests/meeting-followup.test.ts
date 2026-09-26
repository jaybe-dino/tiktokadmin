// 미매핑 회의를 나중에 브랜드에 연결했을 때 후속 초안이 누락되지 않는지.
//   후처리 워커는 summary_md 가 이미 있는 회의를 다시 집지 않으므로 연결 시점에 보장해야 한다.
//   만드는 것은 초안(email_drafts.status='draft')뿐 — 실제 발송은 하지 않는다.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Mtg { id: string; brand_id: string | null; summary_md: string | null; followup_status: string | null; started_at: string | null }
const db = {
  meetings: [] as Mtg[],
  brands: [] as { id: string; brand_name: string; contact_name: string | null; email: string | null }[],
  drafts: [] as { meeting_id: string | null; brand_id: string; kind: string; status: string; to_email: string; subject: string; body: string }[],
  surveys: 0,
  seq: 0,
};

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as (string | null)[];
    if (sql.includes("FROM meetings WHERE id=") && sql.includes("summary_md")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      return m ? [m as unknown as Record<string, unknown>] : [];
    }
    if (sql.includes("FROM email_drafts WHERE meeting_id=")) {
      const d = db.drafts.find((x) => x.meeting_id === a[0] && x.kind === "followup");
      return d ? [{ id: "d1" }] : [];
    }
    if (sql.includes("SELECT * FROM brands WHERE id=")) {
      const b = db.brands.find((x) => x.id === a[0]);
      return b ? [b as unknown as Record<string, unknown>] : [];
    }
    if (sql.includes("INSERT INTO email_drafts")) {
      db.drafts.push({
        brand_id: String(a[0]), meeting_id: (a[1] as string | null) ?? null, kind: "followup",
        status: "draft", to_email: String(a[2] ?? ""), subject: String(a[3] ?? ""), body: String(a[4] ?? ""),
      });
      return [{ id: `d${++db.seq}` }];
    }
    if (sql.includes("UPDATE meetings SET followup_status='drafted'")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) m.followup_status = "drafted";
      return [];
    }
    return [];
  };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    getPool: () => ({ connect: async () => ({ release: () => {} }) }),
  };
});
vi.mock("../lib/repo/card", () => ({ createSurvey: async () => { db.surveys++; return "survey-token"; } }));

import { ensureMeetingFollowup } from "../lib/meetings";

const MEET = "meet-1";
beforeEach(() => {
  db.meetings = [{ id: MEET, brand_id: null, summary_md: null, followup_status: null, started_at: null }];
  db.brands = [{ id: "brand-1", brand_name: "예시브랜드", contact_name: "담당자", email: "lead@example.com" }];
  db.drafts = []; db.surveys = 0; db.seq = 0;
});

describe("후속 초안 보장", () => {
  it("브랜드가 없으면 아무 것도 만들지 않는다", async () => {
    const r = await ensureMeetingFollowup(MEET);
    expect(r.drafted).toBe(false);
    expect(r.reason).toContain("브랜드 미연결");
    expect(db.drafts).toHaveLength(0);
  });

  it("요약 전이면 워커에 맡기고 초안을 만들지 않는다", async () => {
    db.meetings[0].brand_id = "brand-1";
    const r = await ensureMeetingFollowup(MEET);
    expect(r.drafted).toBe(false);
    expect(r.reason).toContain("요약 전");
    expect(db.drafts).toHaveLength(0);
  });

  it("요약이 이미 있는 회의를 뒤늦게 연결하면 후속 초안이 만들어진다", async () => {
    db.meetings[0].brand_id = "brand-1";
    db.meetings[0].summary_md = "## 상담 요약\n- 논의 내용";
    const r = await ensureMeetingFollowup(MEET);
    expect(r.drafted).toBe(true);
    expect(db.drafts).toHaveLength(1);
    expect(db.drafts[0].status).toBe("draft");          // 초안만 — 발송 아님
    expect(db.drafts[0].meeting_id).toBe(MEET);
    expect(db.drafts[0].body).toContain("논의 내용");
    expect(db.meetings[0].followup_status).toBe("drafted");
  });

  it("두 번 불러도 초안은 하나다(멱등)", async () => {
    db.meetings[0].brand_id = "brand-1";
    db.meetings[0].summary_md = "## 상담 요약";
    await ensureMeetingFollowup(MEET);
    const again = await ensureMeetingFollowup(MEET);
    expect(again.drafted).toBe(false);
    expect(again.reason).toContain("이미");
    expect(db.drafts).toHaveLength(1);
  });

  it("초안이 이미 있으면 회의 상태만 맞춰 놓고 새로 만들지 않는다", async () => {
    db.meetings[0].brand_id = "brand-1";
    db.meetings[0].summary_md = "## 상담 요약";
    db.drafts.push({ meeting_id: MEET, brand_id: "brand-1", kind: "followup", status: "draft", to_email: "", subject: "", body: "" });
    const r = await ensureMeetingFollowup(MEET);
    expect(r.drafted).toBe(false);
    expect(db.drafts).toHaveLength(1);
    expect(db.meetings[0].followup_status).toBe("drafted");
  });

  it("없는 회의면 조용히 실패로 답한다", async () => {
    const r = await ensureMeetingFollowup("없는-id");
    expect(r.drafted).toBe(false);
    expect(r.reason).toContain("회의 없음");
  });
});
