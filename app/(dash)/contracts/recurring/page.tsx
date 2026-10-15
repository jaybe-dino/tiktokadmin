import Link from 'next/link';
import {query} from '@/lib/db';
import ContractForm,{LinkButtons} from './ContractForm';
import BillingControls,{SubscriptionControls,SavedCardTest} from './BillingControls';
import {recurringTotal} from '@/lib/recurring-contract-policy';
import OperatorValidation from './OperatorValidation';
import {kstDate} from '@/lib/danal/schedule';
import {brandBillingConfig,operatorBillingConfig,billingConnectionConfig,renewalBillingConfig} from '@/lib/danal/config';
import {billingControl} from '@/lib/danal/brand-billing';
export const dynamic='force-dynamic';
type Row={id:string;brand_name:string;title:string;monthly_amount:string;vat_mode:string;start_date:string;end_date:string;link_expires_at:string|null;link_revoked_at:string|null;subscription_id:string|null;billing_status:string|null;next_billing_date:string|null;first_billing_date:string;is_operator_test:boolean|null};
type Attempt={id:string;title:string;brand_name:string;order_id:string;due_date:string;kind:string;amount:string;status:string;provider_tid:string|null;failure_code:string|null};
export default async function Page({searchParams}:{searchParams:Promise<{brand?:string}>}) {
 const {brand}=await searchParams;const brandId=/^[0-9a-f-]{36}$/i.test(brand||'')?brand:null;
 const brands=await query<{id:string;brand_name:string}>('SELECT id,brand_name FROM brands ORDER BY brand_name');
 let rows:Row[]=[],attempts:Attempt[]=[],ready=true;
 const config=brandBillingConfig(),operatorConfig=operatorBillingConfig(),connection=billingConnectionConfig();const control=await billingControl().catch(()=>null);
 try{
  rows=await query<Row>(`SELECT r.id,b.brand_name,r.title,r.monthly_amount,r.vat_mode,c.start_date,c.end_date,r.link_expires_at,r.link_revoked_at,r.first_billing_date,s.is_operator_test,s.id AS subscription_id,s.status AS billing_status,s.next_billing_date
   FROM recurring_contracts r JOIN brands b ON b.id=r.brand_id JOIN contracts c ON c.id=r.contract_id LEFT JOIN brand_billing_subscriptions s ON s.recurring_contract_id=r.id
   WHERE ($1::uuid IS NULL OR r.brand_id=$1::uuid) ORDER BY r.created_at DESC`,[brandId]);
  attempts=await query<Attempt>(`SELECT a.id,r.title,b.brand_name,a.order_id,a.due_date,a.kind,a.amount,a.status,a.provider_tid,a.failure_code
   FROM brand_billing_attempts a JOIN brand_billing_subscriptions s ON s.id=a.subscription_id JOIN recurring_contracts r ON r.id=s.recurring_contract_id JOIN brands b ON b.id=r.brand_id
   WHERE ($1::uuid IS NULL OR r.brand_id=$1::uuid) ORDER BY a.created_at DESC LIMIT 200`,[brandId]);
 }catch{ready=false;}
 const labels:Record<string,string>={active:'정기결제 등록',awaiting_card:'카드 등록 대기',paused:'결제 중지',needs_review:'담당자 확인 필요',ended:'계약 종료',preparing:'창 준비 중',ready:'인증 대기',approving:'승인 확인 중',paid:'결제 승인 확인',registered:'카드 등록 확인 · 임시 100원 인증',failed:'실패',unknown:'승인 여부 미확정 · 재청구 금지',expired:'창 만료',blocked:'OFF로 차단'};
 return <main><Link href="/contracts">← 계약·결제</Link><h1>브랜드 정기결제 계약</h1><p><Link className="btn" href="/contracts/recurring/calendar">📅 결제 캘린더·예정표</Link></p><p>계약 등록 → 고객 확인 링크 생성 → 고객의 카드 등록 동의 → 월별 자동결제. 링크 생성은 고객 발송이나 계약 서명으로 처리하지 않습니다.</p>
 {control&&<BillingControls renewalsConfigured={renewalBillingConfig().ok} configured={config.ok} enabled={control.enabled} renewals={control.renewals_enabled}/>}
 {!config.ok&&<p>누락된 연결 설정: {config.missing.join(', ')}. 설정값은 화면에 표시하지 않습니다.</p>}
 {control&&<OperatorValidation ready={operatorConfig.ok} connectionReady={connection.ok} enabled={control.operator_test_enabled} contractId={control.operator_test_contract_id} contracts={rows.filter(r=>r.title.startsWith('[운영자검증]')&&Number(r.monthly_amount)===301&&r.vat_mode==='included'&&r.first_billing_date===kstDate())} missing={operatorConfig.ok?[]:operatorConfig.missing}/>}
 {ready?<ContractForm brands={brands} brandId={brand||undefined}/>:<p role="alert">결제 저장소에 연결하지 못했습니다. 마이그레이션 0116·0117 적용 상태를 확인해 주세요.</p>}
 <h2>등록된 계약</h2>{rows.map(r=><article className="card" style={{padding:20,marginTop:12}} key={r.id}><h3>{r.brand_name} · {r.title}</h3><p>{r.start_date} ~ {r.end_date} · 월 {recurringTotal(Number(r.monthly_amount),r.vat_mode).toLocaleString('ko-KR')}원(부가세 포함)</p>{r.is_operator_test&&<p><b>운영자 검증 · 자동갱신 영구 제외</b></p>}<p>상태: {labels[r.billing_status||'awaiting_card']||r.billing_status} · 다음 청구일: {r.next_billing_date||'카드 등록 후 확정'}</p><p>{r.link_revoked_at?'링크 차단됨':r.link_expires_at?`링크 만료: ${r.link_expires_at}`:'링크 미발급'} · 재발급 시 이전 링크는 즉시 무효화됩니다.</p><LinkButtons id={r.id}/>{r.subscription_id&&r.billing_status==='active'&&Number(r.monthly_amount)===301&&(r.title==='테스트'||r.title.startsWith('[운영자검증]'))&&<SavedCardTest id={r.subscription_id}/>}
 {r.subscription_id&&<SubscriptionControls id={r.subscription_id} status={r.billing_status||''}/>}</article>)}
 <h2>최근 결제 시도 200건</h2><p>임시 100원 인증은 월 이용료 수납으로 집계하지 않습니다. 카드번호·빌링키·제공자 응답 원문은 표시하지 않습니다.</p>
 <table className="t"><thead><tr><th>브랜드·계약</th><th>주문번호</th><th>예정일</th><th>유형·금액</th><th>결과</th><th>거래번호·확인코드</th></tr></thead><tbody>{attempts.map(a=><tr key={a.id}><td>{a.brand_name} · {a.title}</td><td>{a.order_id}</td><td>{a.due_date}</td><td>{a.kind==='initial'?'최초 등록':a.kind==='operator_test'?'호출결제 테스트':'월 청구'} · {Number(a.amount).toLocaleString('ko-KR')}원</td><td>{labels[a.status]||a.status}</td><td>{a.provider_tid||'—'} {a.failure_code||''}</td></tr>)}</tbody></table>
 </main>;
}
