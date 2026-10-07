import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../lib/db", () => ({ query: db.query }));
import { excludeOptedOut } from "../lib/export-privacy";
describe("export suppression", () => {
  beforeEach(() => { db.query.mockReset(); });
  it("excludes the whole row on email, international phone or linked brand; keeps unrelated rows", async () => {
    db.query.mockResolvedValue([{kind:'email',addr:'STOP@EXAMPLE.COM',brand_id:null},{kind:'phone',addr:'01012345678',brand_id:null},{kind:'email',addr:'',brand_id:'blocked-brand'}]);
    const rows = [{email:' stop@example.com ',phone:'01099990000'}, {email:'new@example.com',phone:'+82 10-1234-5678'}, {email:'changed@example.com',brand_id:'blocked-brand'}, {email:'allowed@example.com',phone:'01022223333'}, {email:'local@example.com',consent_ads_withdrawn_at:'2026-10-07'}];
    expect(await excludeOptedOut(rows)).toEqual([rows[3]]);
  });
  it("fails closed even for an empty export and never returns suppression addresses", async () => {
    db.query.mockRejectedValue(new Error('secret database connection detail'));
    await expect(excludeOptedOut([])).rejects.toThrow('수신거부 명단 확인 실패');
  });
  it("reads the list again for each export so a new opt-out takes effect", async () => {
    const rows = [{email:'later@example.com'}];
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{kind:'email',addr:'later@example.com',brand_id:null}]);
    expect(await excludeOptedOut(rows)).toEqual(rows);
    expect(await excludeOptedOut(rows)).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
