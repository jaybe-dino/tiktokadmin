"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestRevenueAction } from "@/app/(dash)/brand/[id]/revenue-actions";
export default function BrandRevenueControls({brandId,busy}:{brandId:string;busy:boolean}) {
  const router=useRouter(),[pending,start]=useTransition(),[msg,setMsg]=useState("");
  useEffect(()=>{if(!busy)return;let n=0;const id=setInterval(()=>{router.refresh();if(++n>=20)clearInterval(id);},30000);return()=>clearInterval(id);},[busy,router]);
  return <div style={{marginTop:12,fontSize:12}}>
    <button className="btn sm" disabled={busy||pending} onClick={()=>start(async()=>{const r=await requestRevenueAction(brandId);setMsg(r.ok?"1분 후 다음 처리 주기에 추정합니다.":r.error??"실패");router.refresh();})}>{busy?"AI 추정 처리 중":pending?"예약 중…":"AI 매출 추정"}</button>
    {msg&&<span role="status" style={{marginLeft:10}}>{msg}</span>}
  </div>;
}
