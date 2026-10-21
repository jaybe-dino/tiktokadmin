'use client';
import {useState,useTransition} from 'react';import {useRouter} from 'next/navigation';import {recurringAction} from './actions';import s from '@/app/billing.module.css';
export default function ContractForm({brands,brandId}:{brands:{id:string;brand_name:string}[];brandId?:string}){
 const [pending,start]=useTransition(),[message,setMessage]=useState(''),[success,setSuccess]=useState(false),[amount,setAmount]=useState(''),[vat,setVat]=useState('');const router=useRouter();
 const n=Number(amount),total=vat==='excluded'?n+Math.round(n*.1):n;
 return <form onSubmit={e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form);setMessage('');start(async()=>{const r=await recurringAction(fd);setSuccess(r.ok);setMessage(r.ok?'계약이 저장됐습니다. 아래 계약 목록에서 「고객에게 보낼 링크 만들기」를 눌러 주세요.':r.error||'저장하지 못했습니다. 입력 내용을 확인해 주세요.');if(r.ok){form.reset();setAmount('');setVat('');router.refresh();}});}}>
 <p className={s.muted}>아래 4가지를 입력하면 고객에게 보낼 결제 링크를 만들 수 있습니다. 저장만으로 결제되거나 고객에게 발송되지는 않습니다.</p>
 <fieldset disabled={pending}><legend>1. 어떤 브랜드의 계약인가요?</legend><div className={s.formgrid}>
 <label>브랜드<select name="brand_id" required defaultValue={brandId||''}><option value="">브랜드를 선택해 주세요</option>{brands.map(b=><option key={b.id} value={b.id}>{b.brand_name}</option>)}</select></label>
 <label>계약명<input name="title" required maxLength={200} placeholder="예: 11월 틱톡샵 운영대행"/></label>
 <label>진행할 업무<select name="kind" defaultValue="marketing_retainer"><option value="marketing_retainer">정기 운영대행</option><option value="marketing">마케팅</option><option value="onboarding">온보딩</option><option value="mall">멀티몰</option><option value="guarantee">개런티</option></select></label>
 <label>계약서 PDF 첨부<input type="file" name="contract_file" accept="application/pdf" required/><span className={s.help}>PDF 파일 1개 · 최대 2MB</span></label></div></fieldset>
 <fieldset disabled={pending}><legend>2. 언제부터 언제까지인가요?</legend><div className={s.formgrid}>
 <label>계약 시작일<input type="date" name="start_date" required/></label><label>계약 종료일<input type="date" name="end_date" required/></label><label>첫 결제 예정일<input type="date" name="first_billing_date" required/></label><p className={s.help}>첫 결제일은 계약 기간 안으로 입력해 주세요. 이후 매월 같은 날짜에 청구하며, 그 날짜가 없는 달은 말일입니다.</p></div></fieldset>
 <fieldset disabled={pending}><legend>3. 매월 얼마를 받나요?</legend><div className={s.formgrid}><label>월 이용료 · 원<input type="number" name="monthly_amount" min="301" max="1000000000" step="1" required value={amount} onChange={e=>setAmount(e.target.value)} placeholder="예: 3000000"/></label><label>부가세 처리<select name="vat_mode" required value={vat} onChange={e=>setVat(e.target.value)}><option value="" disabled>부가세 포함 여부를 선택해 주세요</option><option value="included">입력 금액에 부가세 포함</option><option value="excluded">입력 금액에 부가세 10% 추가</option></select></label></div>
 <div className={`${s.notice} ${s.blue}`} aria-live="polite"><span>고객에게 청구할 최종 금액</span><strong style={{display:'block',fontSize:28}}>{amount&&vat&&Number.isFinite(total)?`${total.toLocaleString('ko-KR')}원 / 월`:'금액과 부가세를 입력해 주세요'}</strong><span className={s.help}>부가세 포함 · 아래의 추가 수수료는 합산하지 않습니다.</span></div></fieldset>
 <fieldset disabled={pending}><legend>4. 고객이 확인할 조건을 적어 주세요.</legend><div className={s.formgrid}>
 <label className={s.wide}>계약 업무 내용<textarea name="details" required rows={4} maxLength={20000} placeholder="이번 계약에서 진행할 업무와 제공 범위를 적어 주세요."/></label>
 <label>추가 수수료 · 선택<textarea name="fee_details" rows={3} maxLength={10000} placeholder="없으면 비워 두세요. 예: 매출 수수료 10%, 별도 정산"/></label>
 <label>해지·환불 조건<textarea name="cancellation_terms" required rows={3} maxLength={5000} placeholder="중도 해지 가능 여부, 요청 기한, 환불 기준을 적어 주세요."/></label></div></fieldset>
 <button className={`${s.button} ${s.primary}`} disabled={pending} type="submit">{pending?'계약을 저장하는 중…':'계약 저장하기'}</button>
 {message&&<div role={success?'status':'alert'} className={`${s.notice} ${success?s.good:s.warn}`}>{message}{success&&<p><a href="#contracts-list">저장한 계약 확인하기 ↓</a></p>}</div>}
 </form>;
}
export function LinkButtons({id,hasLink=false}:{id:string;hasLink?:boolean}){
 const [pending,start]=useTransition(),[url,setUrl]=useState(''),[message,setMessage]=useState('');const router=useRouter();
 function run(op:string){if(op==='issue'&&hasLink&&!window.confirm('새 링크를 만들면 이전 링크는 사용할 수 없습니다. 새 링크를 만들까요?'))return;if(op==='revoke'&&!window.confirm('이 링크로는 더 이상 계약 확인과 카드 등록을 할 수 없습니다. 링크를 차단할까요?'))return;const fd=new FormData();fd.set('op',op);fd.set('id',id);start(async()=>{const r=await recurringAction(fd);setMessage(r.ok?op==='revoke'?'고객 링크가 차단됐습니다.':'링크가 준비됐습니다. 복사해서 계약 담당 고객에게 전달해 주세요.':r.error||'처리하지 못했습니다.');setUrl(r.path?new URL(r.path,window.location.origin).href:'');router.refresh();});}
 return <div><div className={s.actions}><button className={`${s.button} ${s.primary}`} disabled={pending} onClick={()=>run('issue')}>{pending?'처리 중…':hasLink?'고객 링크 새로 만들기':'고객에게 보낼 링크 만들기'}</button>{hasLink&&<button className={`${s.button} ${s.danger}`} disabled={pending} onClick={()=>run('revoke')}>기존 링크 차단</button>}</div>
 {url&&<div className={s.notice}><label>고객에게 전달할 링크<input readOnly value={url} onFocus={e=>e.target.select()}/></label><div className={s.actions}><button className={s.button} onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage('복사됐습니다. 고객에게 붙여넣어 전달해 주세요.');}catch{setMessage('위 링크를 선택해서 직접 복사해 주세요.');}}}>링크 복사하기</button><a className={s.button} href={url} target="_blank" rel="noreferrer">고객 화면 미리 보기 ↗</a></div></div>}
 <p role="status" className={s.help}>{message}</p><p className={s.help}>링크 생성·복사만으로 고객에게 발송되지는 않습니다.{hasLink?' 새 링크를 만들면 이전 링크는 만료됩니다.':''}</p></div>;
}
