import {nextBillingDate} from './schedule';
import {recurringTotal} from '../recurring-contract-policy';
export type CalendarContract={id:string;brand_id:string;brand_name:string;title:string;start_date:string;end_date:string;status:string;first_billing_date:string;monthly_amount:string|number;vat_mode:string;subscription_id:string|null;billing_status:string|null;next_billing_date:string|null;is_operator_test:boolean|null;has_billing_key:boolean;terms_match:boolean};
export type CalendarAttempt={id:string;recurring_contract_id:string;due_date:string;event_date:string;kind:string;amount:string|number;status:string;provider_tid:string|null;failure_code:string|null;completed_at:string|null};
export type CalendarGroup='scheduled'|'paid'|'attention'|'pending'|'history';
export type BillingCalendarEntry={id:string;day:string;due_date:string;contract_id:string;brand_id:string;brand_name:string;title:string;amount:number;label:string;group:CalendarGroup;type:string;source:'projection'|'ledger';tid:string|null;completed_at:string|null;detail:string};
export function billingMonthBounds(month:string){
 if(!/^\d{4}-\d{2}$/.test(month))throw new Error('INVALID_MONTH');
 const [y,m]=month.split('-').map(Number);if(y<2000||y>2199||m<1||m>12)throw new Error('INVALID_MONTH');
 const last=new Date(Date.UTC(y,m,0)).getUTCDate();return {from:month+'-01',to:month+'-'+last};
}
export function shiftBillingMonth(month:string,offset:number){billingMonthBounds(month);const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7);}
const labels:Record<string,string>={paid:'결제 승인',registered:'카드 등록 · 임시 인증',ready:'카드 인증 대기',preparing:'결제창 준비',approving:'승인 확인 중',failed:'결제 실패',unknown:'승인 미확정 · 재청구 금지',expired:'인증창 만료',blocked:'청구 보류'};
export function buildBillingCalendar(contracts:CalendarContract[],attempts:CalendarAttempt[],month:string,control:{enabled:boolean;renewals:boolean;today:string}){
 const {from,to}=billingMonthBounds(month),byId=new Map(contracts.map(c=>[c.id,c]));const entries:BillingCalendarEntry[]=[],excluded:{contract:CalendarContract;reason:string}[]=[];
 for(const a of attempts){
  const c=byId.get(a.recurring_contract_id);if(!c||a.event_date<from||a.event_date>to)continue;
  const group:CalendarGroup=a.status==='paid'?'paid':['failed','unknown','approving','blocked'].includes(a.status)?'attention':['ready','preparing'].includes(a.status)?'pending':'history';
  entries.push({id:'attempt:'+a.id,day:a.event_date,due_date:a.due_date,contract_id:c.id,brand_id:c.brand_id,brand_name:c.brand_name,title:c.title,amount:Number(a.amount),label:labels[a.status]||a.status,group,type:a.kind==='initial'?'첫 결제·카드 등록':a.kind==='operator_test'?'호출결제 테스트':'월 자동청구',source:'ledger',tid:a.provider_tid,completed_at:a.completed_at,detail:a.failure_code||''});
 }
 for(const c of contracts){
  let reason='';
  if(c.billing_status==='paused')reason='결제 중지';else if(['terminated','expired'].includes(c.status)||c.billing_status==='ended'||c.end_date<control.today)reason='계약 종료';else if(c.is_operator_test)reason='운영자 검증 · 자동갱신 제외';else if(c.billing_status==='needs_review')reason='담당자 확인 필요';else if(c.billing_status==='active'&&!c.next_billing_date)reason='다음 청구일 미등록';
  if(reason){excluded.push({contract:c,reason});continue;}
  const base={contract_id:c.id,brand_id:c.brand_id,brand_name:c.brand_name,title:c.title,amount:recurringTotal(Number(c.monthly_amount),c.vat_mode),source:'projection' as const,tid:null,completed_at:null};
  if(!c.subscription_id||c.billing_status==='awaiting_card'){
   const day=c.first_billing_date;
   if(day>=from&&day<=to&&day>=c.start_date&&day<=c.end_date&&!attempts.some(a=>a.recurring_contract_id===c.id&&a.kind==='initial'&&a.due_date===day&&a.status!=='expired'))entries.push({...base,id:'first:'+c.id,day,due_date:day,label:day<control.today?'카드 미등록 · 예정일 경과':'카드 등록 필요',group:day<control.today?'attention':'pending',type:'최초 결제 예정일',detail:'고객 카드 등록·동의 전에는 자동청구되지 않습니다.'});
   continue;
  }
  if(c.billing_status!=='active'||!c.next_billing_date){excluded.push({contract:c,reason:'자동청구 일정 확인 필요'});continue;}
  const previous=shiftBillingMonth(month,-1)+'-01',day=nextBillingDate(c.first_billing_date,previous);
  if(day<c.next_billing_date||day<c.first_billing_date||day<c.start_date||day>c.end_date)continue;
  if(attempts.some(a=>a.recurring_contract_id===c.id&&a.due_date===day&&((a.kind==='renewal')||(a.kind==='initial'&&a.status==='paid'))))continue;
  const hold=!c.has_billing_key?'등록 카드 확인 필요':!c.terms_match?'계약 조건 변경 · 재확인 필요':c.next_billing_date<control.today?'지난 청구일 미처리 · 확인 필요':!control.enabled?'전체 결제 OFF':!control.renewals?'월 자동청구 OFF':'';
  entries.push({...base,id:'cycle:'+c.id+':'+day,day,due_date:day,label:hold||'자동청구 예정',group:hold?'attention':'scheduled',type:'월 자동청구',detail:hold?'자동청구 대상으로 집계하지 않습니다.':'현재 계약과 청구일 기준 계산 일정 · 다날에 미리 예약된 거래가 아닙니다.'});
 }
 entries.sort((a,b)=>a.day.localeCompare(b.day)||a.brand_name.localeCompare(b.brand_name)||a.id.localeCompare(b.id));
 return {entries,excluded};
}
