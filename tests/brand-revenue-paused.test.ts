import {describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),queryOne:vi.fn(),tx:vi.fn(),estimate:vi.fn()}));
vi.mock("../lib/db",()=>({query:m.query,queryOne:m.queryOne,tx:m.tx}));
vi.mock("../lib/brand-revenue-ai",()=>({estimateBrandRevenue:m.estimate,revenueErrorCode:()=>"ERROR"}));
import {enqueueBrandRevenue,requestBrandRevenue,runRevenueJobs} from "../lib/brand-revenue-jobs";
import {REVENUE_API_ENABLED} from "../lib/brand-revenue-policy";
describe("user-paused revenue API",()=>{it("neither enqueues nor claims jobs nor calls AI",async()=>{
expect(REVENUE_API_ENABLED).toBe(false);await enqueueBrandRevenue("b");await expect(requestBrandRevenue("b")).rejects.toThrow("REVENUE_API_PAUSED");
expect(await runRevenueJobs()).toEqual({processed:0,completed:0,failed:0,superseded:0});
expect(m.query).not.toHaveBeenCalled();expect(m.tx).not.toHaveBeenCalled();expect(m.estimate).not.toHaveBeenCalled();
});});
