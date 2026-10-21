import {notFound} from 'next/navigation';
import {billingResult} from '@/lib/danal/brand-billing';
import s from '@/app/billing.module.css';
export const dynamic='force-dynamic';export const metadata={title:'GloveK 결제 결과',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{state:string}>}){
 const {state}=await params,r=await billingResult(state);if(!r)notFound();
 const paid=r.status==='paid',registered=r.status==='registered',confirmed=paid||registered;
 const held=confirmed&&['BILLING_KEY_ALREADY_REGISTERED','BILLING_KEY_STORAGE_FAILED'].includes(r.failure_code||'');
 const pending=['unknown','approving'].includes(r.status);
 const title=paid?`${Number(r.amount).toLocaleString('ko-KR')}원 결제 완료`:registered?'카드 등록 완료':pending?'결제 결과를 확인하고 있습니다':'카드 등록이 완료되지 않았습니다';
 return <main className={`${s.shell} ${s.customer}`}><div className={s.brand}>GloveK</div>
 <section className={s.panel} style={{marginTop:26}}><div className={`${s.resultIcon} ${confirmed?'':s.warn}`} aria-hidden="true">{confirmed?'✓':'!'}</div><span className={`${s.badge} ${confirmed?s.good:s.warn}`}>{paid?'결제 승인 확인':registered?'카드 등록 확인':'확인 필요'}</span><h1 style={{marginTop:16}}>{title}</h1>
 <p className={s.muted}>{paid?'다날에서 결제 승인을 확인했습니다. 같은 금액을 다시 결제하지 마세요.':registered?'다날에서 카드 등록을 확인했습니다. 월 이용료 결제와는 별도입니다.':pending?'결과가 확인될 때까지 다시 결제하지 마세요. 계약 담당자가 기존 거래를 확인해야 합니다.':'계약 담당자에게 등록 상태를 확인해 주세요.'}</p>
 {held&&<div className={`${s.notice} ${s.warn}`}><strong>결제 결과는 확인됐고, 자동결제 연결은 확인 중입니다.</strong><p>담당자가 카드 연결을 확인해야 합니다. 결제나 카드 등록을 반복하지 않아도 됩니다.</p></div>}
 {registered&&<div className={s.notice}><strong>임시 100원 인증 안내</strong><p>카드 확인용 임시 승인은 다날 자동취소 대상입니다. 실제 취소 여부는 카드사 내역에서 확인해 주세요.</p></div>}
 <dl className={s.receipt}>{paid&&<div><dt>결제금액</dt><dd><strong>{Number(r.amount).toLocaleString('ko-KR')}원</strong></dd></div>}{r.provider_tid&&<div><dt>거래번호</dt><dd className={s.reference}>{r.provider_tid}</dd></div>}{r.provider_code&&<div><dt>다날 응답코드</dt><dd>{r.provider_code}{r.provider_code==='0000'?' · 정상 처리':''}</dd></div>}<div><dt>주문번호</dt><dd className={s.reference}>{r.order_id}</dd></div></dl>
 <div className={s.divider}><h3>이제 어떻게 하면 되나요?</h3><p>{held?'계약 담당자에게 이 결과 화면을 전달해 주세요. 자동결제 연결 확인은 담당자가 진행합니다.':paid?'결제가 완료됐습니다. 이 화면을 보관하고 창을 닫으셔도 됩니다.':registered?'카드 등록이 끝났습니다. 첫 이용료는 계약의 청구일과 운영 설정에 따라 처리됩니다.':pending?'아래에서 결과를 다시 확인할 수 있습니다. 계속 확인 중이면 이 화면의 주문번호를 담당자에게 전달해 주세요.':'이 화면의 주문번호와 함께 계약 담당자에게 문의해 주세요.'}</p>
 {pending&&<a className={`${s.button} ${s.primary}`} href={`/billing-result/${state}`}>결과 다시 확인하기</a>}</div>
 {r.is_operator_test&&<p className={s.help}>운영자 테스트 계약입니다. 매월 자동청구 대상에서 제외됩니다.</p>}
 </section><p className={s.help} style={{textAlign:'center'}}>이 화면은 계약서 전자서명을 대신하지 않습니다.</p></main>;
}
