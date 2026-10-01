// 카카오 수집 — 실제 Postgres 로 방 매핑·중복 방지·미매핑 보류·실패 기록을 확인한다.
//   KAKAO_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const ctx = vi.hoisted(() => ({ pool: null as never as { query: (s: string, a?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> } }));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.KAKAO_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.KAKAO_TEST_DB_URL }) as never;
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return { query, queryOne: async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null };
});

const K = await import("../lib/kakao-rooms");
const BRAND = "11111111-1111-4111-8111-111111111111";

describe.skipIf(!process.env.KAKAO_TEST_DB_URL)("카카오 수집 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      DROP TABLE IF EXISTS kakao_ingest_runs, kakao_rooms, pm_manual_comms, brands CASCADE;
      CREATE TABLE brands(id uuid PRIMARY KEY, brand_name text);
      CREATE TABLE pm_manual_comms(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand_id uuid, channel text,
        occurred_at timestamptz, author text, source_label text, source_url text, body text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO brands VALUES ('${BRAND}','데이셀코스메틱');
    `);
    // 실제 마이그레이션 파일을 그대로 적용한다(파일과 코드가 어긋나면 여기서 터진다).
    const sql = readFileSync(new URL("../migrations/0106_kakao_rooms.sql", import.meta.url), "utf8");
    await ctx.pool.query(sql);
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.pool.query("TRUNCATE kakao_rooms, kakao_ingest_runs, pm_manual_comms");
  });

  const msg = (n: number, at: string) => ({ externalId: `m${n}`, at, author: "고객", text: `문의 ${n}` });

  it("스키마 상태를 올바로 읽는다", async () => {
    const s = await K.kakaoSchemaState();
    expect(s.ready).toBe(true);
    expect(s.missing).toEqual([]);
  });

  it("처음 보는 방은 pending 으로만 등록하고 메시지를 저장하지 않는다", async () => {
    const r = await K.ingestKakaoMessages({
      roomKey: "room-a", roomName: "데이셀 실무방", agent: "pc-1",
      messages: [msg(1, "2026-09-30T01:00:00Z"), msg(2, "2026-09-30T02:00:00Z")],
    });
    expect(r.ok).toBe(true);
    expect(r.roomStatus).toBe("pending");
    expect(r.stored).toBe(0);
    expect(r.skipped).toBe(2);
    expect(r.reason).toContain("담당자 확인");
    const saved = await ctx.pool.query("SELECT count(*)::int AS n FROM pm_manual_comms");
    expect(saved.rows[0].n).toBe(0);
    const rooms = await K.listKakaoRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].status).toBe("pending");
    expect(rooms[0].brandId).toBeNull();
    expect(rooms[0].lastIngestAt).toBeNull();   // 저장된 적이 없으므로 수집기 미연결
  });

  it("담당자가 연결한 뒤에만 저장된다", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-a", roomName: "실무방", messages: [] });
    const room = (await K.listKakaoRooms())[0];
    expect((await K.linkKakaoRoom(room.id, BRAND, "a@b.c")).ok).toBe(true);

    const r = await K.ingestKakaoMessages({
      roomKey: "room-a", agent: "pc-1",
      messages: [msg(1, "2026-09-30T01:00:00Z"), msg(2, "2026-09-30T02:00:00Z")],
    });
    expect(r.stored).toBe(2);
    expect(r.roomStatus).toBe("linked");
    const rows = await ctx.pool.query("SELECT brand_id::text, channel, ingest_source, source_ref, body FROM pm_manual_comms ORDER BY occurred_at");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].channel).toBe("kakao");
    expect(rows.rows[0].ingest_source).toBe("kakao_collector");
    expect(rows.rows[0].source_ref).toBe("kakao:room-a:m1");
  });

  it("같은 메시지를 다시 받아도 한 번만 저장한다", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-a", messages: [] });
    await K.linkKakaoRoom((await K.listKakaoRooms())[0].id, BRAND, "a@b.c");
    const first = await K.ingestKakaoMessages({ roomKey: "room-a", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    const again = await K.ingestKakaoMessages({
      roomKey: "room-a",
      messages: [msg(1, "2026-09-30T01:00:00Z"), msg(2, "2026-09-30T03:00:00Z")],
    });
    expect(first.stored).toBe(1);
    expect(again.stored).toBe(1);
    expect(again.duplicate).toBe(1);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM pm_manual_comms");
    expect(n.rows[0].n).toBe(2);
  });

  it("시각이나 본문이 없는 메시지는 저장하지 않는다(시각을 지어내지 않는다)", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-a", messages: [] });
    await K.linkKakaoRoom((await K.listKakaoRooms())[0].id, BRAND, "a@b.c");
    const r = await K.ingestKakaoMessages({
      roomKey: "room-a",
      messages: [
        { externalId: "x1", at: "", text: "시각 없음" },
        { externalId: "x2", at: "2026-09-30T01:00:00Z", text: "   " },
        { externalId: "", at: "2026-09-30T01:00:00Z", text: "식별자 없음" },
        msg(9, "2026-09-30T04:00:00Z"),
      ],
    });
    expect(r.stored).toBe(1);
    expect(r.skipped).toBe(3);
  });

  it("무시로 표시한 방은 저장하지 않는다", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-b", messages: [] });
    const room = (await K.listKakaoRooms())[0];
    await K.setKakaoRoomStatus(room.id, "ignored", "a@b.c");
    const r = await K.ingestKakaoMessages({ roomKey: "room-b", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    expect(r.stored).toBe(0);
    expect(r.roomStatus).toBe("ignored");
    expect(r.reason).toContain("수집 대상이 아닌");
  });

  it("연결을 풀면 다시 pending 이 되고 저장이 멈춘다", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-a", messages: [] });
    const room = (await K.listKakaoRooms())[0];
    await K.linkKakaoRoom(room.id, BRAND, "a@b.c");
    await K.linkKakaoRoom(room.id, null, "a@b.c");
    const r = await K.ingestKakaoMessages({ roomKey: "room-a", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    expect(r.roomStatus).toBe("pending");
    expect(r.stored).toBe(0);
  });

  it("없는 브랜드로는 연결할 수 없다", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-a", messages: [] });
    const room = (await K.listKakaoRooms())[0];
    const bad = await K.linkKakaoRoom(room.id, "99999999-9999-4999-8999-999999999999", "a@b.c");
    expect(bad.ok).toBe(false);
  });

  it("room_key 가 없으면 거부하고 그 사실을 기록한다", async () => {
    const r = await K.ingestKakaoMessages({ roomKey: "", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    expect(r.status).toBe("rejected");
    const runs = await K.listKakaoRuns();
    expect(runs[0].status).toBe("rejected");
  });

  it("수집 실행을 성공·중복·보류까지 모두 남긴다", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-a", agent: "pc-1", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    await K.linkKakaoRoom((await K.listKakaoRooms())[0].id, BRAND, "a@b.c");
    await K.ingestKakaoMessages({ roomKey: "room-a", agent: "pc-1", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    const runs = await K.listKakaoRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].stored).toBe(1);
    expect(runs[1].skipped).toBe(1);   // 연결 전이라 보류
    expect(runs[0].agent).toBe("pc-1");
  });

  it("브랜드 수집 상태는 실제 저장 전까지 '수집기 미연결'로 말한다", async () => {
    await K.ingestKakaoMessages({ roomKey: "room-a", messages: [] });
    const room = (await K.listKakaoRooms())[0];

    const before = await K.brandKakaoState(BRAND);
    expect(before.linked).toBe(0);
    expect(before.note).toContain("수집기 미연결");

    await K.linkKakaoRoom(room.id, BRAND, "a@b.c");
    const linkedOnly = await K.brandKakaoState(BRAND);
    expect(linkedOnly.linked).toBe(1);
    expect(linkedOnly.lastIngestAt).toBeNull();
    expect(linkedOnly.note).toContain("수집기 미연결");

    await K.ingestKakaoMessages({ roomKey: "room-a", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    const after = await K.brandKakaoState(BRAND);
    expect(after.lastIngestAt).not.toBeNull();
    expect(after.note).toContain("마지막으로 받은 시각");
  });

  it("다른 브랜드의 같은 external id 는 서로 막지 않는다", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    await ctx.pool.query("INSERT INTO brands VALUES ($1,'다른브랜드') ON CONFLICT DO NOTHING", [OTHER]);
    await K.ingestKakaoMessages({ roomKey: "room-a", messages: [] });
    await K.ingestKakaoMessages({ roomKey: "room-c", messages: [] });
    const rooms = await K.listKakaoRooms();
    await K.linkKakaoRoom(rooms.find((r) => r.roomKey === "room-a")!.id, BRAND, "a@b.c");
    await K.linkKakaoRoom(rooms.find((r) => r.roomKey === "room-c")!.id, OTHER, "a@b.c");
    const a = await K.ingestKakaoMessages({ roomKey: "room-a", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    const c = await K.ingestKakaoMessages({ roomKey: "room-c", messages: [msg(1, "2026-09-30T01:00:00Z")] });
    expect(a.stored).toBe(1);
    expect(c.stored).toBe(1);
  });
});
