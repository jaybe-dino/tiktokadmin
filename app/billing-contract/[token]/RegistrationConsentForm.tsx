'use client';
import {useState} from 'react';
import s from '@/app/billing.module.css';
export default function RegistrationConsentForm({token,proof,label,consentText}:{token:string;proof:string;label:string;consentText:string}){
 const [checked,setChecked]=useState(false),[pending,setPending]=useState(false);
 return <form method="POST" action="/api/billing-contract/start" onSubmit={()=>setPending(true)}>
 <input type="hidden" name="token" value={token}/><input type="hidden" name="form_proof" value={proof}/>
 <label className={s.consent}><input type="checkbox" name="consent" value="yes" required checked={checked} onChange={e=>setChecked(e.target.checked)}/><span>{consentText}</span></label>
 <p className={s.help} aria-live="polite">{checked?'아래 버튼을 누르면 다날 카드 입력창으로 이동합니다.':'위 동의 항목을 체크하면 아래 버튼을 누를 수 있습니다.'}</p>
 <button className={`${s.button} ${s.primary} ${s.full}`} type="submit" disabled={!checked||pending}>{pending?'카드 입력창을 여는 중…':label}</button>
 </form>;
}
