import { notFound } from 'next/navigation';
import { publicRecurringContract } from '@/lib/recurring-contracts';
import { recurringTotal } from '@/lib/recurring-contract-policy';
import { brandBillingConfig,operatorBillingConfig } from '@/lib/danal/config';
import { billingControl } from '@/lib/danal/brand-billing';
import { queryOne } from '@/lib/db';
import { kstDate } from '@/lib/danal/schedule';
import CardRegistration from './CardRegistration';
import s from '@/app/billing.module.css';
export const dynamic='force-dynamic';
export const metadata={title:'GloveK 계약 확인',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}) {
 const {token}=await params;const c=await publicRecurringContract(token);if(!c)notFound();
 const configured=brandBillingConfig().ok,operatorConfigured=operatorBillingConfig().ok;
 const ctl=await billingControl().catch(()=>null);
 let sub:{status:string;is_operator_test:boolean}|null=null,subscriptionStoreReady=true;
 try{sub=await queryOne<{status:string;is_operator_test:boolean}>('SELECT status,is_operator_test FROM brand_billing_subscriptions WHERE recurring_contract_id=$1',[c.id]);}catch{subscriptionStoreReady=false;}
 const operatorTest=Boolean(sub?.is_operator_test||(ctl?.operator_test_enabled&&ctl.operator_test_contract_id===c.id));
 const operatorAllowed=operatorConfigured&&ctl?.operator_test_enabled===true&&ctl.operator_test_contract_id===c.id;
 const ready=(operatorTest?operatorAllowed:configured&&ctl?.enabled===true)&&subscriptionStoreReady&&(!sub||sub.status==='awaiting_card')&&c.first_billing_date>=kstDate();
 const statusLabels:Record<string,string>={active:'등록 완료',paused:'정기결제 중지',needs_review:'담당자 확인 필요',ended:'계약 종료',awaiting_card:'카드 등록 대기'};
 const amount=recurringTotal(Number(c.monthly_amount),c.vat_mode);
 const unavailableReason=sub?.status==='active'?'카드가 이미 등록되어 있습니다. 다시 등록할 필요가 없습니다.':sub?.status==='needs_review'?'진행한 결제 또는 카드 연결을 담당자가 확인해야 합니다.':sub?.status==='paused'?'이 계약의 자동결제가 중지되어 있습니다. 담당자에게 재개를 요청해 주세요.':sub?.status==='ended'?'종료된 계약입니다. 담당자에게 문의해 주세요.':c.first_billing_date<kstDate()?'첫 결제 예정일이 지났습니다. 담당자에게 일정을 확인해 주세요.':!configured||!subscriptionStoreReady?'결제 서비스를 준비 중입니다. 담당자에게 문의해 주세요.':!ctl?.enabled&&!operatorAllowed?'담당자가 카드 등록을 잠시 중지했습니다. 등록 재개를 요청해 주세요.':undefined;
 return <main className={`${s.shell} ${s.customer}`}>
  <div className={s.brand}>GloveK</div><header className={s.header}><div><h1>계약을 확인하고<br/>결제 카드를 등록해 주세요.</h1><p className={s.muted}>{c.brand_name} · {c.title}</p></div></header>
  <ol className={s.steps} aria-label="진행 순서"><li><b>1. 계약 확인</b>금액과 일정 확인</li><li><b>2. 카드 등록</b>다날에서 카드 입력</li><li><b>3. 결과 확인</b>등록·결제 결과 확인</li></ol>
  <section className={`${s.panel} ${s.hero}`} aria-label="결제 요약"><span className={s.badge}>{operatorTest?'운영자 1회 테스트':'매월 정기결제'}</span><p className={s.amount}>{amount.toLocaleString('ko-KR')}원 <small>{!operatorTest&&'/ 월'}</small></p><p className={s.muted}>부가세 포함 · 기타 수수료 별도</p>
   <dl className={s.info}><div><dt>{operatorTest?'테스트 결제일':'첫 결제 예정일'}</dt><dd>{c.first_billing_date}</dd></div><div><dt>계약 기간</dt><dd>{c.start_date} ~ {c.end_date}</dd></div></dl>
   {!operatorTest&&<p className={s.muted}>이후 매월 같은 날짜에 청구합니다. 그 날짜가 없는 달은 말일입니다.</p>}
  </section>
  <section className={s.panel}><h2>계약 내용</h2><dl className={s.info}><div><dt>브랜드</dt><dd>{c.brand_name}</dd></div><div><dt>계약명</dt><dd>{c.title}</dd></div></dl>
   <h3>진행할 업무</h3><p className={s.terms}>{c.details}</p>
   <div className={s.divider}><h3>추가 수수료</h3><p className={s.terms}>{c.fee_details||'없음'}</p><p className={s.help}>별도 수수료는 위 월 결제금액에 자동으로 더해지지 않습니다.</p></div>
   <div className={s.divider}><h3>해지·환불 조건</h3><p className={s.terms}>{c.cancellation_terms}</p></div>
   <a className={s.button} style={{marginTop:20}} href={`/api/billing-contract/${token}/file`}>계약서 PDF 내려받기 ↓</a>
  </section>
  <CardRegistration operatorTest={operatorTest} token={token} ready={ready} status={sub?statusLabels[sub.status]||'확인 필요':undefined} unavailableReason={unavailableReason} renewalsEnabled={ctl?.renewals_enabled===true}
   chargeToday={c.first_billing_date===kstDate()} amount={amount} date={c.first_billing_date}/>
  <p className={s.help} style={{textAlign:'center'}}>도움이 필요하면 이 링크를 전달한 계약 담당자에게 문의해 주세요.<br/>계약서 확인이나 카드 등록은 계약서 전자서명을 대신하지 않습니다.</p>
 </main>;
}
