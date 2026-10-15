import {describe,it,expect} from 'vitest';
import {billingMonthBounds,buildBillingCalendar,type CalendarContract,type CalendarAttempt} from '../lib/danal/billing-calendar';
const contract:CalendarContract={id:'c',brand_id:'b',brand_name:'브랜드',title:'월 계약',start_date:'2026-01-01',end_date:'2027-12-31',status:'active',first_billing_date:'2026-01-31',monthly_amount:'1000',vat_mode:'excluded',subscription_id:'s',billing_status:'active',next_billing_date:'2026-02-28',is_operator_test:false,has_billing_key:true,terms_match:true};
const control={enabled:true,renewals:true,today:'2026-02-01'};
const attempt:CalendarAttempt={id:'a',recurring_contract_id:'c',due_date:'2026-02-28',event_date:'2026-02-28',kind:'renewal',amount:'1100',status:'paid',provider_tid:'tid',failure_code:null,completed_at:'2026-02-28 10:00:00+09'};
describe('billing calendar read model',()=>{
 it('clamps month end and retains original anchor in March',()=>{
  expect(buildBillingCalendar([contract],[],'2026-02',control).entries[0]).toMatchObject({day:'2026-02-28',amount:1100,group:'scheduled'});
  expect(buildBillingCalendar([contract],[],'2026-03',control).entries[0].day).toBe('2026-03-31');
  expect(buildBillingCalendar([{...contract,first_billing_date:'2028-01-31',next_billing_date:'2028-02-29',end_date:'2028-12-31'}],[],'2028-02',control).entries[0].day).toBe('2028-02-29');
 });
 it('keeps card registration separate from automatic charge',()=>{
  const r=buildBillingCalendar([{...contract,subscription_id:null,billing_status:null,first_billing_date:'2026-02-15'}],[],'2026-02',control);
  expect(r.entries[0].group).toBe('pending');
 });
 it('excludes paused and ended contracts even with future stored dates but retains actual payments',()=>{
  const r=buildBillingCalendar([{...contract,billing_status:'paused',end_date:'2026-01-31'}],[attempt],'2026-02',control);
  expect(r.entries).toHaveLength(1);expect(r.entries[0].group).toBe('paid');expect(r.excluded[0].reason).toBe('결제 중지');
 });
 it.each(['paid','failed','unknown'])('does not duplicate existing renewal %s',status=>{
  const r=buildBillingCalendar([contract],[{...attempt,status}],'2026-02',control);
  expect(r.entries).toHaveLength(1);expect(r.entries[0].source).toBe('ledger');
 });
 it.each([{...control,enabled:false},{...control,renewals:false},{...control,today:'2026-03-01'}])('holds unsafe forecasts',cfg=>{
  expect(buildBillingCalendar([contract],[],'2026-03',cfg).entries[0].group).toBe('attention');
 });
 it('holds changed terms and missing card',()=>{
  for(const patch of [{terms_match:false},{has_billing_key:false}])expect(buildBillingCalendar([{...contract,...patch}],[],'2026-02',control).entries[0].group).toBe('attention');
 });
 it('never projects beyond contract end or operator tests',()=>{
  expect(buildBillingCalendar([{...contract,end_date:'2026-02-15'}],[],'2026-02',control).entries).toHaveLength(0);
  expect(buildBillingCalendar([{...contract,is_operator_test:true}],[],'2026-02',control).entries).toHaveLength(0);
 });
 it('does not count temporary card authentication as paid',()=>{
  expect(buildBillingCalendar([contract],[{...attempt,kind:'initial',status:'registered',amount:100}],'2026-02',control).entries.find(e=>e.source==='ledger')?.group).toBe('history');
 });
 it('rejects malformed months',()=>{for(const month of ['2026-13','2026-00','x','1999-12'])expect(()=>billingMonthBounds(month)).toThrow('INVALID_MONTH');});
});
