"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recurringAction } from "./actions";
export default function ContractForm({brands,brandId}:{brands:{id:string;brand_name:string}[];brandId?:string}) {
 const [pending,start]=useTransition();const [message,setMessage]=useState("");const router=useRouter();
 return <form className="card" style={{padding:20,display:"grid",gap:12,maxWidth:800}} onSubmit={e=>{
   e.preventDefault();const form=e.currentTarget;const fd=new FormData(form);setMessage("");
   start(async()=>{const r=await recurringAction(fd);setMessage(r.ok?"계약 등록 완료. 아래 목록에서 고객 확인 링크를 생성하세요.":r.error||"실패");if(r.ok){form.reset();router.refresh();}});
 }}>
 <h2>브랜드 정기결제 계약 등록</h2>
 <label>브랜드<select className="f" name="brand_id" required defaultValue={brandId||""}><option value="">선택</option>{brands.map(b=><option key={b.id} value={b.id}>{b.brand_name}</option>)}</select></label>
 <label>계약명<input className="f" name="title" required maxLength={200}/></label>
 <label>계약 종류<select className="f" name="kind" defaultValue="marketing_retainer"><option value="marketing_retainer">정기 운영대행</option><option value="marketing">마케팅</option><option value="onboarding">온보딩</option><option value="mall">멀티몰</option><option value="guarantee">개런티</option></select></label>
 <label>계약서 PDF · 최대 2MB<input className="f" type="file" name="contract_file" accept="application/pdf" required/></label>
 <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>{[["시작일","start_date"],["종료일","end_date"],["최초 결제 예정일","first_billing_date"]].map(([label,name])=><label key={name}>{label}<input className="f" type="date" name={name} required/></label>)}</div>
 <label>계약 상세<textarea className="f" name="details" required rows={5} maxLength={20000}/></label>
 <label>월 정기결제 금액(원)<input className="f" type="number" name="monthly_amount" min="1" max="1000000000" step="1" required/></label>
 <label>부가세<select className="f" name="vat_mode" required defaultValue=""><option value="" disabled>선택</option><option value="included">입력 금액에 포함</option><option value="excluded">입력 금액에 별도 10% 추가</option></select></label>
 <p>결제 주기: 매월. 최초 결제 예정일과 같은 일자이며, 해당 일이 없는 달은 말일 기준입니다. 실제 카드 등록·자동청구 연결은 아직 비활성 상태입니다.</p>
 <label>기타 수수료·별도 정산 조건<textarea className="f" name="fee_details" rows={3} maxLength={10000} placeholder="예: 매출 수수료 10%, 별도 합의 후 정산. 이 금액은 월 자동결제에 합산되지 않습니다."/></label>
 <label>중도 해지·환불 조건<textarea className="f" name="cancellation_terms" required rows={3} maxLength={5000}/></label>
 <button className="btn pri" disabled={pending}>{pending?"저장 중…":"계약 등록"}</button><p role="status">{message}</p>
 </form>;
}
export function LinkButtons({id}:{id:string}) {
 const [pending,start]=useTransition();const [url,setUrl]=useState("");const [message,setMessage]=useState("");const router=useRouter();
 function run(op:string){const fd=new FormData();fd.set("op",op);fd.set("id",id);start(async()=>{const r=await recurringAction(fd);setMessage(r.ok?(op==="revoke"?"링크가 차단되었습니다.":"이 링크를 가진 사람은 계약서를 열람할 수 있습니다. 고객에게만 전달하세요."):r.error||"실패");setUrl(r.path?new URL(r.path,window.location.origin).href:"");router.refresh();});}
 return <div><button className="btn" disabled={pending} onClick={()=>run("issue")}>고객 확인 링크 생성·재발급</button> <button className="btn" disabled={pending} onClick={()=>run("revoke")}>링크 차단</button>{url&&<><input aria-label="고객 확인 링크" className="f" readOnly value={url}/><button className="btn" onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage("링크 복사 완료");}catch{setMessage("링크를 직접 선택하여 복사해 주세요.");}}}>복사</button></>}<p role="status">{message}</p></div>;
}
