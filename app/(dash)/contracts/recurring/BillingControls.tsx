"use client";
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {billingAdminAction} from './billing-actions';
export default function BillingControls({configured,enabled,renewals}:{configured:boolean;enabled:boolean;renewals:boolean}) {
 const [pending,start]=useTransition();const [message,setMessage]=useState('');const router=useRouter();
 function set(e:boolean,r:boolean){start(async()=>{const out=await billingAdminAction({op:'control',enabled:e,renewals:r});setMessage(out.ok?'설정 저장 완료':out.error||'실패');router.refresh();});}
 return <section className="card" style={{padding:20,marginBottom:16}}><h2>다날 연결·청구 설정</h2>
  <p>연결 설정: {configured?'준비됨 · 실거래 검증 여부는 별도 확인':'미설정'} · 카드 등록·결제: {enabled?'ON':'OFF'} · 월별 자동청구: {renewals?'ON':'OFF'}</p>
  <p>ON 전환 후 고객의 카드 등록 완료 시 승인 또는 임시 100원 인증이 발생할 수 있습니다. 월별 자동청구는 결제 예정일에 실행합니다. 지난 예정일은 담당자 확인 대상으로 보류합니다.</p>
  <button className="btn" disabled={pending} onClick={()=>set(false,false)}>전체 결제 OFF</button>{' '}
  <button className="btn" disabled={pending||!configured} onClick={()=>set(true,false)}>카드 등록·첫 결제만 ON</button>{' '}
  <button className="btn" disabled={pending||!configured} onClick={()=>set(true,true)}>카드 등록·월별 자동청구 ON</button><p role="status">{message}</p>
 </section>;
}
export function SubscriptionControls({id,status}:{id:string;status:string}) {
 const [pending,start]=useTransition();const [message,setMessage]=useState('');const router=useRouter();
 function run(op:string){start(async()=>{const r=await billingAdminAction({op,id});setMessage(r.ok?'변경 완료':r.error||'실패');router.refresh();});}
 return <div>{['active','awaiting_card'].includes(status)&&<button className="btn" disabled={pending} onClick={()=>run('pause')}>이 계약 정기결제 중지</button>}{status==='paused'&&<button className="btn" disabled={pending} onClick={()=>run('resume')}>예정된 결제 재개</button>}<p role="status">{message}</p></div>;
}
