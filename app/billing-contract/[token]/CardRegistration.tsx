import {createBillingFormProof} from '@/lib/danal/form-proof';
import RegistrationConsentForm from './RegistrationConsentForm';
import s from '@/app/billing.module.css';
export default function CardRegistration({token,ready,chargeToday,amount,date,status,operatorTest=false,unavailableReason,renewalsEnabled=true}:{token:string;ready:boolean;chargeToday:boolean;amount:number;date:string;status?:string;operatorTest?:boolean;unavailableReason?:string;renewalsEnabled?:boolean}) {
 const money=amount.toLocaleString('ko-KR');
 return <section className={s.panel} aria-labelledby="registration-heading"><h2 id="registration-heading">{ready?'마지막으로, 결제 카드를 등록해 주세요':status||'카드 등록을 확인하고 있습니다'}</h2>
 {ready?<>
 <div className={`${s.notice} ${s.blue}`}><strong>{operatorTest?'오늘 301원이 1회 결제됩니다.':chargeToday?`오늘 ${money}원이 결제됩니다.`:'오늘은 카드를 등록하는 단계입니다.'}</strong>
 <p>{operatorTest?'운영자 테스트이며 자동 환불되지 않습니다. 매월 자동결제 대상에는 포함되지 않습니다.':chargeToday?'카드 인증을 마치면 첫 이용료가 결제됩니다.':`카드 확인을 위해 임시 100원 승인이 발생할 수 있습니다. 월 이용료 ${money}원의 첫 결제 예정일은 ${date}입니다.`}</p>
 {!chargeToday&&!operatorTest&&<p className={s.help}>임시 100원은 다날 자동취소 대상입니다. 실제 취소 여부는 카드사 내역에서 확인해 주세요.</p>}</div>
 {!operatorTest&&!renewalsEnabled&&<div className={`${s.notice} ${s.warn}`}><strong>매월 자동청구는 현재 중지되어 있습니다.</strong><p>카드 등록 후 담당자가 자동청구를 켜야 예정일에 청구됩니다.{chargeToday?' 오늘의 첫 결제는 진행됩니다.':''}</p></div>}
 <RegistrationConsentForm token={token} proof={createBillingFormProof(token)} label={operatorTest?'301원 테스트 결제하기':chargeToday?`카드 등록하고 ${money}원 결제하기`:'카드 등록하기'} consentText={operatorTest?'테스트 카드의 사용 권한이 있으며, 301원 1회 결제와 자동갱신 제외에 동의합니다.':'이 브랜드의 권한 있는 담당자로서 계약 금액·매월 결제일·해지 및 환불 조건을 확인했으며, 카드 등록과 월 자동결제에 동의합니다.'}/>
 <p className={s.help} style={{textAlign:'center',marginTop:15}}>카드번호는 다날 결제창에서만 입력합니다.</p>
 </>:<div className={`${s.notice} ${status==='등록 완료'?s.good:s.warn}`} role="status"><strong>{unavailableReason||'현재 카드 등록을 진행할 수 없습니다. 계약 담당자에게 확인해 주세요.'}</strong><p>이미 진행한 결제가 있다면 다시 결제하지 말고 담당자에게 결과 확인을 요청해 주세요.</p></div>}
 </section>;
}
