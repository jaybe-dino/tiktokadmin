import Link from "next/link";
import { query } from "@/lib/db";
import ContractForm,{LinkButtons} from "./ContractForm";
import { recurringTotal } from "@/lib/recurring-contract-policy";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{brand?:string}>}){
 const {brand}=await searchParams;
 const brands=await query<{id:string;brand_name:string}>("SELECT id,brand_name FROM brands ORDER BY brand_name");
 let rows: {id:string;brand_name:string;title:string;monthly_amount:string;vat_mode:string;start_date:string;end_date:string;link_expires_at:string|null;link_revoked_at:string|null}[]=[];
 let ready=true;
 try{rows=await query(`SELECT r.id,b.brand_name,r.title,r.monthly_amount,r.vat_mode,c.start_date,c.end_date,r.link_expires_at,r.link_revoked_at FROM recurring_contracts r JOIN brands b ON b.id=r.brand_id JOIN contracts c ON c.id=r.contract_id WHERE ($1::uuid IS NULL OR r.brand_id=$1::uuid) ORDER BY r.created_at DESC`,[/^[0-9a-f-]{36}$/i.test(brand||"")?brand:null]);}catch{ready=false;}
 return <main><Link href="/contracts">← 계약·결제</Link><h1>브랜드 정기결제 계약</h1><p>계약 등록 → 고객 확인 링크 생성 → 고객 전달. 카드 등록과 자동청구는 다날 정기결제 연결 확인 전까지 중지 상태입니다.</p>{ready?<ContractForm brands={brands} brandId={brand}/>:<p role="alert">계약 저장소 준비가 필요합니다. 마이그레이션 0116 적용 전에는 계약을 등록할 수 없습니다.</p>}
 <h2>등록된 계약</h2>{rows.map(r=><article className="card" style={{padding:20,marginTop:12}} key={r.id}><h3>{r.brand_name} · {r.title}</h3><p>{r.start_date} ~ {r.end_date} · 월 {recurringTotal(Number(r.monthly_amount),r.vat_mode).toLocaleString("ko-KR")}원(부가세 포함)</p><p>{r.link_revoked_at?"링크 차단됨":r.link_expires_at?`링크 만료: ${r.link_expires_at}`:"링크 미발급"} · 재발급 시 이전 링크는 즉시 무효화됩니다.</p><LinkButtons id={r.id}/></article>)}</main>;
}
