"use client";
import { useState,useTransition } from 'react';
import { startCardAction } from './actions';
import { isAllowedDanalStartUrl } from '@/lib/danal/danal-start-url';
export default function CardRegistration({token,ready,chargeToday,amount,date,status,operatorTest=false}:{token:string;ready:boolean;chargeToday:boolean;amount:number;date:string;status?:string;operatorTest?:boolean}) {
 const [consent,setConsent]=useState(false),[message,setMessage]=useState('');const [pending,start]=useTransition();
 return <section style={{padding:20,background:'#f3f5ff',borderRadius:14}}><h2>{operatorTest?'운영자 301원 1회 결제 검증':'카드 등록 · 월 자동결제'}</h2>
 <p>{operatorTest?'카드 인증 완료 후 운영자 검증 금액 301원이 1회 실제 결제됩니다.':chargeToday?`카드 인증 완료 후 첫 월 이용료 ${amount.toLocaleString('ko-KR')}원이 결제됩니다.`:`카드 등록 시 임시 100원 승인이 발생하며 다날 자동취소 대상입니다. 실제 취소 확인은 카드사 내역을 확인해 주세요. 월 이용료 ${amount.toLocaleString('ko-KR')}원의 최초 청구 예정일은 ${date}입니다.`}</p>
 <p>{operatorTest?'이 계약은 운영자 검증용입니다. 카드 등록 완료 시 301원이 실제 결제되며 자동 환불되지 않습니다. 다음 달 자동갱신과 정기청구는 영구 제외합니다.':'매월 같은 날짜에 부가세 포함 월 이용료가 자동결제됩니다. 해당 일자가 없는 달은 말일에 청구합니다. 기타 수수료는 합산하지 않습니다. 위 계약기간과 해지·환불 조건이 적용됩니다.'}</p>
 {status&&<p>등록 상태: {status}</p>}
 <label style={{display:'flex',gap:8,alignItems:'flex-start'}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={!ready||pending}/><span>{operatorTest?'운영자 테스트 카드의 사용 권한이 있으며, 301원 1회 실제 결제와 자동갱신 제외 조건을 확인하고 동의합니다.':'계약 내용·금액·결제 주기·해지 조건을 확인했으며, 이 브랜드의 권한 있는 담당자로서 카드 등록과 위 월 자동결제에 동의합니다.'}</span></label>
 <button className="btn pri" style={{marginTop:14}} disabled={!ready||!consent||pending} onClick={()=>start(async()=>{
  setMessage('');const r=await startCardAction(token,consent);
  if(!r.ok||!r.url||!r.params||!isAllowedDanalStartUrl(r.url)){setMessage(r.error||'결제창 주소를 확인하지 못했습니다.');return;}
  const form=document.createElement('form');form.method='POST';form.action=r.url;form.acceptCharset='EUC-KR';
  const field=document.createElement('input');field.type='hidden';field.name='STARTPARAMS';field.value=r.params;form.appendChild(field);document.body.appendChild(form);form.submit();
 })}>{pending?'카드 등록창 준비 중…':ready?(operatorTest?'301원 1회 결제 검증 진행':'동의하고 다날 카드 등록'):'카드 등록 준비 중'}</button>
 {!ready&&<p>현재 카드 등록을 시작할 수 없습니다. 담당자에게 확인해 주세요.</p>}<p role="status">{message}</p>
 <p style={{fontSize:13}}>카드 정보는 다날 결제창에서 입력합니다. 계약 확인 링크를 여는 것만으로 서명·결제 동의가 처리되지는 않습니다.</p></section>;
}
