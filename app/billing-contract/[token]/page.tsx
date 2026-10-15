import { notFound } from 'next/navigation';
import { publicRecurringContract } from '@/lib/recurring-contracts';
import { recurringTotal } from '@/lib/recurring-contract-policy';
import { brandBillingConfig } from '@/lib/danal/config';
import { billingControl } from '@/lib/danal/brand-billing';
import { queryOne } from '@/lib/db';
import { kstDate } from '@/lib/danal/schedule';
import CardRegistration from './CardRegistration';
export const dynamic='force-dynamic';
export const metadata={title:'GloveK 계약 확인',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}) {
 const {token}=await params;const c=await publicRecurringContract(token);if(!c)notFound();
 const configured=brandBillingConfig().ok;
 const ctl=await billingControl().catch(()=>null);
 let sub:{status:string}|null=null,subscriptionStoreReady=true;
 try{sub=await queryOne<{status:string}>('SELECT status FROM brand_billing_subscriptions WHERE recurring_contract_id=$1',[c.id]);}catch{subscriptionStoreReady=false;}
 const ready=configured&&ctl?.enabled===true&&subscriptionStoreReady&&(!sub||sub.status==='awaiting_card')&&c.first_billing_date>=kstDate();
 const statusLabels:Record<string,string>={active:'등록 완료',paused:'정기결제 중지',needs_review:'담당자 확인 필요',ended:'계약 종료',awaiting_card:'카드 등록 대기'};
 return <main style={{maxWidth:800,margin:'40px auto',padding:24}}>
  <h1>{c.title}</h1><h2>{c.brand_name}</h2><p>계약기간: {c.start_date} ~ {c.end_date}</p>
  <p style={{fontSize:28,fontWeight:800}}>월 {recurringTotal(Number(c.monthly_amount),c.vat_mode).toLocaleString('ko-KR')}원 <small>(부가세 포함)</small></p>
  <p>입력 금액 {Number(c.monthly_amount).toLocaleString('ko-KR')}원 · 부가세 {c.vat_mode==='included'?'포함':'별도 10%'}</p>
  <p>최초 결제 예정일: {c.first_billing_date} · 매월 같은 날짜(해당 일자 없는 달은 말일)</p>
  <h3>계약 상세</h3><p style={{whiteSpace:'pre-wrap'}}>{c.details}</p>
  <h3>기타 수수료·별도 정산</h3><p style={{whiteSpace:'pre-wrap'}}>{c.fee_details||'없음'}</p><p>기타 수수료는 위 월 정기결제 금액에 합산되지 않습니다.</p>
  <h3>해지·환불 조건</h3><p style={{whiteSpace:'pre-wrap'}}>{c.cancellation_terms}</p>
  <a href={`/api/billing-contract/${token}/file`}>계약서 PDF 다운로드</a><hr/>
  <CardRegistration token={token} ready={ready} status={sub?statusLabels[sub.status]||'확인 필요':undefined}
   chargeToday={c.first_billing_date===kstDate()} amount={recurringTotal(Number(c.monthly_amount),c.vat_mode)} date={c.first_billing_date}/>
 </main>;
}
