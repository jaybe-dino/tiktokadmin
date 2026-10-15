import { describe, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai", () => ({ AI_MODEL: "existing-configured-model", aiEnabled: () => true, aiClient: () => ({ messages: { create } }) }));
vi.mock("../lib/safe-fetch", () => ({ safeFetchText: vi.fn(async () => ({ok:false})) }));
import { checkedRevenue, estimateBrandRevenue, revenueErrorCode } from "../lib/brand-revenue-ai";
const url = "https://example.org/report";
const valid = {status:"estimated",lower:100e6,upper:200e6,currency:"KRW",year:2025,scope:"company_separate",entity:"예시 법인",confidence:"low",rationale:"관측값을 바탕으로 한 추정과 한계",sources:[{title:"공개 원문",url}]};
describe("AI revenue evidence contract",()=>{
 it("categorizes provider errors without exposing raw messages",()=>{expect(revenueErrorCode({status:404,message:"model missing SECRET_SENTINEL"})).toBe("AI_MODEL_UNAVAILABLE");expect(revenueErrorCode({status:400,message:"web_search disabled SECRET_SENTINEL"})).toBe("AI_WEB_SEARCH_UNAVAILABLE");});
 it("rejects invented references even if JSON is otherwise valid",()=>expect(()=>checkedRevenue(valid,[])).toThrow("UNVERIFIED_REVENUE_SOURCE"));
 it("preserves company vs brand scope with actual retrieved evidence",()=>expect(checkedRevenue(valid,[url]).scope).toBe("company_separate"));
 it("rejects current incomplete financial year",()=>expect(()=>checkedRevenue({...valid,year:2026},[url],new Date("2026-10-15"))).toThrow("INCOMPLETE_REVENUE_YEAR"));
 it("keeps insufficient evidence as no numeric revenue",()=>expect(checkedRevenue({status:"insufficient",reason:"동명 법인 식별 불가"},[])).not.toHaveProperty("lower"));
 it("uses the system model and only public brand identity",async()=>{
   create.mockResolvedValueOnce({content:[{type:"web_search_tool_result",content:[{type:"web_search_result",title:"공개 원문",url}]},{type:"text",text:JSON.stringify(valid)}]});
   const r=await estimateBrandRevenue({brand_name:"예시",brand_url:"",company_name:"예시 법인"});
   expect(r.status).toBe("estimated");expect(create.mock.calls[0][0].model).toBe("existing-configured-model");
   expect(create.mock.calls[0][1]).toEqual({timeout:42000,maxRetries:0});
 });
});
