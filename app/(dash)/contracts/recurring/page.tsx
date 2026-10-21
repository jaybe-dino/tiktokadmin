import Link from 'next/link';
import {query} from '@/lib/db';
import ContractForm,{LinkButtons} from './ContractForm';
import BillingControls,{SubscriptionControls,SavedCardTest} from './BillingControls';
import {recurringTotal} from '@/lib/recurring-contract-policy';
import OperatorValidation from './OperatorValidation';
import {kstDate} from '@/lib/danal/schedule';
import {brandBillingConfig,operatorBillingConfig,billingConnectionConfig,renewalBillingConfig} from '@/lib/danal/config';
import {billingControl} from '@/lib/danal/brand-billing';
import s from '@/app/billing.module.css';
export const dynamic='force-dynamic';
type Row={id:string;brand_name:string;title:string;monthly_amount:string;vat_mode:string;start_date:string;end_date:string;link_expires_at:string|null;link_revoked_at:string|null;subscription_id:string|null;billing_status:string|null;next_billing_date:string|null;first_billing_date:string;is_operator_test:boolean|null};
type Attempt={id:string;title:string;brand_name:string;order_id:string;due_date:string;kind:string;amount:string;status:string;provider_tid:string|null;provider_code:string|null;failure_code:string|null;recurring_contract_id:string;completed_at:string|null};
export default async function Page({searchParams}:{searchParams:Promise<{brand?:string;q?:string}>}) {
 const {brand,q:inputQ}=await searchParams;const q=(inputQ||'').trim().slice(0,100);const brandId=/^[0-9a-f-]{36}$/i.test(brand||'')?brand:null;
 const brands=await query<{id:string;brand_name:string}>('SELECT id,brand_name FROM brands ORDER BY brand_name');
 let rows:Row[]=[],attempts:Attempt[]=[],ready=true;
 const config=brandBillingConfig(),operatorConfig=operatorBillingConfig(),connection=billingConnectionConfig();const control=await billingControl().catch(()=>null);
 try{
  rows=await query<Row>(`SELECT r.id,b.brand_name,r.title,r.monthly_amount,r.vat_mode,c.start_date,c.end_date,r.link_expires_at,r.link_revoked_at,r.first_billing_date,s.is_operator_test,s.id AS subscription_id,s.status AS billing_status,s.next_billing_date
   FROM recurring_contracts r JOIN brands b ON b.id=r.brand_id JOIN contracts c ON c.id=r.contract_id LEFT JOIN brand_billing_subscriptions s ON s.recurring_contract_id=r.id
   WHERE ($1::uuid IS NULL OR r.brand_id=$1::uuid) ORDER BY r.created_at DESC`,[brandId]);
  attempts=await query<Attempt>(`SELECT a.id,s.recurring_contract_id,r.title,b.brand_name,a.order_id,a.due_date,a.kind,a.amount,a.status,a.provider_tid,a.provider_code,a.failure_code,a.completed_at
   FROM brand_billing_attempts a JOIN brand_billing_subscriptions s ON s.id=a.subscription_id JOIN recurring_contracts r ON r.id=s.recurring_contract_id JOIN brands b ON b.id=r.brand_id
   WHERE ($1::uuid IS NULL OR r.brand_id=$1::uuid) ORDER BY a.created_at DESC LIMIT 200`,[brandId]);
 }catch{ready=false;}
 const labels:Record<string,string>={active:'자동결제 연결 완료',awaiting_card:'카드 등록 대기',paused:'자동결제 중지',needs_review:'담당자 확인 필요',ended:'계약 종료',preparing:'결제창 준비 중',ready:'카드 입력 대기',approving:'승인 확인 중',paid:'결제 완료',registered:'카드 등록 완료',failed:'결제 실패',unknown:'승인 확인 중',expired:'결제창 만료',blocked:'진행 중지'};
 const tone=(status:string)=>['paid','registered','active'].includes(status)?s.good:['unknown','approving','needs_review','failed','paused','blocked'].includes(status)?s.warn:s.blue;
 const cardHeld=(code:string|null)=>['BILLING_KEY_ALREADY_REGISTERED','BILLING_KEY_STORAGE_FAILED'].includes(code||'');
 const matches=(name:string,title:string)=>!q||(name+' '+title).toLocaleLowerCase().includes(q.toLocaleLowerCase());
 const visibleRows=rows.filter(r=>matches(r.brand_name,r.title)),visibleAttempts=attempts.filter(a=>matches(a.brand_name,a.title));
 const stats=[['자동결제 연결 완료',visibleRows.filter(r=>r.billing_status==='active').length],['고객 카드 등록 대기',visibleRows.filter(r=>!r.billing_status||r.billing_status==='awaiting_card').length],['담당자 확인 필요',visibleRows.filter(r=>r.billing_status==='needs_review').length],['최근 결제 완료',visibleAttempts.filter(a=>a.status==='paid').length]];
 return <main className={s.shell}>
 <Link className={s.muted} href="/contracts">← 계약·결제로 돌아가기</Link><header className={s.header}><div><h1>브랜드 정기결제</h1><p className={s.muted}>계약을 만들고 링크를 전달하면, 고객이 직접 카드를 등록합니다.</p></div><Link className={s.button} href="/contracts/recurring/calendar">결제 일정·매출 보기 →</Link></header>
 <ol className={s.steps}><li><b>1. 계약 만들기</b>계약서·금액·날짜 입력</li><li><b>2. 링크 전달하기</b>고객이 직접 카드 등록</li><li><b>3. 결제 확인하기</b>승인 결과와 청구 일정 확인</li></ol>
 {control&&<BillingControls renewalsConfigured={renewalBillingConfig().ok} configured={config.ok} enabled={control.enabled} renewals={control.renewals_enabled}/>}
 {ready&&<div className={s.stats}>{stats.map(([label,n])=><section className={s.stat} key={label}><span className={s.muted}>{label}</span><strong>{n}건</strong></section>)}</div>}
 <p className={s.help}>계약 상태는 등록된 계약 기준입니다. 최근 결제 완료는 아래 최근 200건 중 승인된 결제만 셉니다. 임시 100원 인증은 제외합니다.</p>
 {ready?<details id="new-contract" className={`${s.panel} ${s.details}`}><summary><span>＋ 새 정기결제 계약 만들기<br/><small className={s.muted}>브랜드·계약서·일정·월 이용료를 입력해 주세요.</small></span></summary><ContractForm brands={brands} brandId={brand||undefined}/></details>:<div className={`${s.notice} ${s.warn}`} role="alert">계약·결제 내역을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요. 내역이 없는 것으로 처리하지 않습니다.</div>}
 <section id="contracts-list"><div className={s.titleLine}><h2>등록한 계약 <span className={s.muted}>{visibleRows.length}건</span></h2></div>
 <form className={s.filter} method="GET">{brandId&&<input type="hidden" name="brand" value={brandId}/>}<label>브랜드·계약 찾기<input name="q" defaultValue={q} placeholder="브랜드명 또는 계약명 입력"/></label><button className={`${s.button} ${s.primary}`} type="submit">검색</button>{q&&<Link className={s.button} href={brandId?`/contracts/recurring?brand=${brandId}`:'/contracts/recurring'}>전체 보기</Link>}</form>
 {visibleRows.map(r=>{const status=r.billing_status||'awaiting_card',last=attempts.find(a=>a.recurring_contract_id===r.id);return <details className={`${s.panel} ${s.details}`} key={r.id}><summary><div><div className={s.rowhead}><strong>{r.brand_name} · {r.title}</strong><span className={`${s.badge} ${tone(status)}`}>{labels[status]||'확인 필요'}</span>{last&&['paid','registered'].includes(last.status)&&<span className={`${s.badge} ${s.good}`}>{last.status==='registered'?'카드 등록 확인':last.kind==='initial'?'첫 결제 완료':'최근 결제 완료'}</span>}</div><p className={s.muted}>매월 {recurringTotal(Number(r.monthly_amount),r.vat_mode).toLocaleString('ko-KR')}원 · {r.start_date} ~ {r.end_date}</p></div></summary>
 {status==='needs_review'&&<div className={`${s.notice} ${s.warn}`}><strong>{last&&['paid','registered'].includes(last.status)?'승인 결과는 확인됐습니다. 자동결제 카드 연결을 확인해 주세요.':'기존 결제 결과를 먼저 확인해 주세요.'}</strong><p>아래 결제 내역의 거래번호와 상태를 확인하세요. 같은 금액을 다시 청구하거나 고객에게 재등록을 요청하지 마세요.</p><a href="#payment-history">결제 내역 확인하기 ↓</a></div>}
 <dl className={s.info}><div><dt>월 결제금액 · 부가세 포함</dt><dd>{recurringTotal(Number(r.monthly_amount),r.vat_mode).toLocaleString('ko-KR')}원</dd></div><div><dt>{r.next_billing_date?'다음 청구 예정일':'첫 결제 예정일'}</dt><dd>{r.next_billing_date||r.first_billing_date}{!control?.renewals_enabled&&<small className={s.muted}> · 매월 자동청구 중지</small>}</dd></div></dl>
 {r.is_operator_test&&<p className={s.help}>운영자 테스트 계약 · 매월 자동청구 대상에서 제외</p>}
 <p className={s.help}>{r.link_revoked_at?'고객 링크가 차단되어 있습니다.':r.link_expires_at?`고객 링크 만료일: ${r.link_expires_at.slice(0,10)}`:'아직 고객 링크가 없습니다. 아래에서 만들어 주세요.'}</p>
 <LinkButtons id={r.id} hasLink={!!r.link_expires_at&&!r.link_revoked_at}/>
 {r.subscription_id&&<SubscriptionControls id={r.subscription_id} status={status}/>}
 {r.subscription_id&&status==='active'&&Number(r.monthly_amount)===301&&(r.title==='테스트'||r.title.startsWith('[운영자검증]'))&&<SavedCardTest id={r.subscription_id}/>}
 </details>;})}{ready&&!visibleRows.length&&<div className={`${s.panel} ${s.empty}`}>{q?'검색한 브랜드·계약이 없습니다.':'아직 등록한 계약이 없습니다. 위에서 새 계약을 만들어 주세요.'}</div>}</section>
 <section id="payment-history"><div className={s.titleLine}><div><h2>결제 내역</h2><p className={s.muted}>결제 승인과 자동결제 카드 연결은 별도 상태입니다. 승인 확인 중인 거래는 다시 청구하지 마세요.</p></div></div>
 <div className={s.tablewrap}><table className={s.table}><thead><tr><th>브랜드·계약</th><th>결제일 / 예정일</th><th>금액</th><th>결과·다음 행동</th><th>거래 확인</th></tr></thead><tbody>{visibleAttempts.map(a=><tr key={a.id}><td><strong>{a.brand_name}</strong><small>{a.title}</small></td><td>{a.completed_at?.slice(0,10)||a.due_date}{a.completed_at&&a.completed_at.slice(0,10)!==a.due_date&&<small>예정일 {a.due_date}</small>}<small>{a.kind==='initial'?'첫 결제·카드 등록':a.kind==='operator_test'?'운영자 테스트':'매월 이용료'}</small></td><td><strong>{Number(a.amount).toLocaleString('ko-KR')}원</strong>{a.status==='registered'&&<small>카드 확인용 임시 인증<br/>매출에 포함되지 않음</small>}</td><td><span className={`${s.badge} ${tone(a.status)}`}>{labels[a.status]||'확인 필요'}</span>{['paid','registered'].includes(a.status)&&cardHeld(a.failure_code)?<small>자동결제 연결 확인 필요<br/>재결제하지 마세요.</small>:['unknown','approving'].includes(a.status)?<small>기존 승인 결과 확인 필요<br/>재청구 금지</small>:a.status==='registered'?<small>임시 승인 취소는 카드사 내역 확인</small>:null}</td><td>{a.provider_tid?<><div className={s.reference}>거래번호 {a.provider_tid}</div><small>다날 응답 {a.provider_code||'확인 필요'}{a.provider_code==='0000'?' · 정상 처리':''}</small></>:<span className={s.muted}>승인 거래번호 확인 전</span>}<details style={{marginTop:8}}><summary className={s.help} style={{cursor:'pointer'}}>주문번호·상세 정보</summary><p className={s.reference}>{a.order_id}</p>{a.failure_code&&<p className={s.reference}>확인 정보: {a.failure_code}</p>}</details></td></tr>)}{!visibleAttempts.length&&<tr><td colSpan={5} className={s.empty}>{ready?'아직 결제 내역이 없습니다.':'결제 내역을 불러오지 못했습니다.'}</td></tr>}</tbody></table></div></section>
 <details className={`${s.panel} ${s.details}`}><summary>고급 설정 · 연결 상태와 운영자 테스트</summary><p className={s.help}>일상적인 계약 등록에는 변경할 필요가 없습니다. 테스트 모드를 켜면 일반 고객 결제가 중지됩니다.</p>{!config.ok&&<div className={`${s.notice} ${s.warn}`}>연결 확인 필요: {config.missing.join(', ')}</div>}
 {control&&<OperatorValidation ready={operatorConfig.ok} connectionReady={connection.ok} enabled={control.operator_test_enabled} contractId={control.operator_test_contract_id} contracts={rows.filter(r=>r.title.startsWith('[운영자검증]')&&Number(r.monthly_amount)===301&&r.vat_mode==='included'&&r.first_billing_date===kstDate())} missing={operatorConfig.ok?[]:operatorConfig.missing}/>}
 </details></main>;
}
