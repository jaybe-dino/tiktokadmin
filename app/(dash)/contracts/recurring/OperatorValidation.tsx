"use client";
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {operatorValidationAction} from './billing-actions';
export default function OperatorValidation({ready,connectionReady,enabled,contractId,contracts,missing}:{ready:boolean;connectionReady:boolean;enabled:boolean;contractId:string|null;contracts:{id:string;title:string;brand_name:string}[];missing:string[]}) {
 const [selected,setSelected]=useState(contractId||''),[message,setMessage]=useState('');const [pending,start]=useTransition();const router=useRouter();
 function run(op:'enable'|'disable'|'connection'){start(async()=>{const r=await operatorValidationAction({op,contractId:selected});setMessage(r.ok?r.message||'완료':r.error||'실패');router.refresh();});}
 return <section className="card" style={{padding:20,marginBottom:16}}><h2>운영자 전용 실결제 검증</h2><p>검증 모드 {enabled?'ON':'OFF'} · 선택한 301원 계약 1건만 허용 · 테스트 계약은 이후에도 자동갱신에서 영구 제외</p>
 <p>먼저 아래 양식에서 계약명을 <b>[운영자검증] 다날 결제</b>로 입력하고, 운영자 브랜드·월 301원·VAT 포함·최초 결제 예정일 오늘로 등록하세요. 계약서에는 검증용임을 표시하세요.</p>
 <p>연결 진단은 AUTH만 호출하며 카드 승인·등록·청구를 실행하지 않습니다. 실제 검증은 고객 링크의 다날 창에서 운영자가 직접 카드를 입력하고 301원 1회 결제에 동의하여 진행합니다. 자동 환불되지 않습니다.</p>
 <button className="btn" disabled={pending||!connectionReady} onClick={()=>run('connection')}>청구 없이 연결 진단(AUTH)</button>
 <label style={{display:'block',marginTop:12}}>오늘의 301원 검증 계약<select className="f" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">선택</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.brand_name} · {c.title}</option>)}</select></label>
 <button className="btn" disabled={pending||!ready||!selected} onClick={()=>run('enable')}>일반 결제 OFF · 선택 계약만 검증 허용</button>{' '}<button className="btn" disabled={pending} onClick={()=>run('disable')}>검증 모드 중지</button>
 {!ready&&<p>검증 준비에 필요한 설정: {missing.join(', ')}</p>}<p role="status">{message}</p></section>;
}
