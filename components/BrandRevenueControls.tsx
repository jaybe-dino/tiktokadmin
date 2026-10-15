"use client";
import { REVENUE_API_ENABLED, REVENUE_API_PAUSED_MESSAGE } from "@/lib/brand-revenue-policy";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestRevenueAction, checkRevenueAiAction } from "@/app/(dash)/brand/[id]/revenue-actions";
export default function BrandRevenueControls({brandId,busy,canRetry=false}:{brandId:string;busy:boolean;canRetry?:boolean}) {
  const router=useRouter(),[pending,start]=useTransition(),[msg,setMsg]=useState("");
  useEffect(()=>{if(!REVENUE_API_ENABLED||!busy)return;let n=0;const id=setInterval(()=>{router.refresh();if(++n>=40)clearInterval(id);},30000);return()=>clearInterval(id);},[busy,router]);
  if (!REVENUE_API_ENABLED) return <p style={{fontSize:12,color:"var(--ink3)"}}>{REVENUE_API_PAUSED_MESSAGE}</p>;
  return <div style={{marginTop:12,fontSize:12}}>
    <button className="btn sm" disabled={(busy&&!canRetry)||pending} onClick={()=>start(async()=>{const r=await requestRevenueAction(brandId);setMsg(r.ok?"1분 후 다음 처리 주기에 추정합니다.":r.error??"실패");router.refresh();})}>{pending?"예약 중…":canRetry?"AI 다시 시도":busy?"AI 추정 처리 중":"AI 매출 추정"}</button>
    {canRetry&&<button className="btn sm" style={{marginLeft:8}} disabled={pending} onClick={()=>start(async()=>{const r=await checkRevenueAiAction();setMsg(r.ok?`AI 연결 정상 · ${r.model}`:`AI 연결 확인: ${r.error}`);})}>AI 연결 확인</button>}
    {msg&&<span role="status" style={{marginLeft:10}}>{msg}</span>}
  </div>;
}
