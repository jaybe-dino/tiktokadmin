import { beforeEach,describe,expect,it,vi } from "vitest";
vi.mock("../lib/brand-revenue-policy",()=>({REVENUE_API_ENABLED:true}));
const mocks=vi.hoisted(()=>({query:vi.fn(),queryOne:vi.fn(),client:vi.fn(),estimate:vi.fn()}));
vi.mock("../lib/db",()=>({query:mocks.query,queryOne:mocks.queryOne,tx:async(fn:any)=>fn({query:mocks.client})}));
vi.mock("../lib/brand-revenue-ai",()=>({estimateBrandRevenue:mocks.estimate,revenueErrorCode:()=>"AI_RESEARCH_FAILED"}));
import {requestBrandRevenue,runRevenueJobs} from "../lib/brand-revenue-jobs";
beforeEach(()=>{vi.clearAllMocks();mocks.query.mockResolvedValue([]);mocks.queryOne.mockResolvedValue({brand_name:"예시",brand_url:"",company_name:null});mocks.estimate.mockResolvedValue({status:"insufficient",reason:"근거 부족"});});
describe("durable research job ownership",()=>{
 it("does not reset a request already pending or running",async()=>{mocks.client.mockResolvedValue({rowCount:0});await requestBrandRevenue("brand1");expect(mocks.client).toHaveBeenCalledTimes(1);});
 it("does not overwrite a newer request when a stale worker finishes",async()=>{
   mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{brand_id:"b",claim_token:"old",attempts:1}]).mockResolvedValueOnce([]);
   mocks.client.mockResolvedValue({rowCount:0});const r=await runRevenueJobs();expect(r.superseded).toBe(1);expect(r.completed).toBe(0);expect(mocks.client).toHaveBeenCalledTimes(1);
 });
 it("only persists after owning the finishing claim",async()=>{
   mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{brand_id:"b",claim_token:"mine",attempts:1}]).mockResolvedValueOnce([]);
   mocks.client.mockResolvedValue({rowCount:1});const r=await runRevenueJobs();expect(r.completed).toBe(1);expect(mocks.client.mock.calls[1][1][1]).toContain('"status":"insufficient"');
 });
 it("stores a fixed error instead of provider secret-bearing text",async()=>{
   mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{brand_id:"b",claim_token:"mine",attempts:3}]).mockResolvedValueOnce([]);
   mocks.estimate.mockRejectedValue(new Error("provider error SECRET_SENTINEL"));mocks.client.mockResolvedValue({rowCount:1});const r=await runRevenueJobs();expect(r.failed).toBe(1);expect(JSON.stringify(mocks.client.mock.calls)).not.toContain("SECRET_SENTINEL");
 });
});
