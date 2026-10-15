"use server";
import { currentUser } from '@/lib/auth';
import { query,tx } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { brandBillingConfig,renewalBillingConfig } from '@/lib/danal/config';
import { pauseBrandBilling,resumeBrandBilling } from '@/lib/danal/brand-billing';
export async function billingAdminAction(input:{op:string;id?:string;enabled?:boolean;renewals?:boolean}) {
 const u=await currentUser();if(!u||!['exec','lead','settle'].includes(u.role))return {ok:false,error:'결제 관리 권한이 필요합니다.'};
 try{
  if(input.op==='control'){
   if((input.enabled||input.renewals)&&!brandBillingConfig().ok)throw new Error('CONFIG_MISSING');
   if(input.renewals&&!renewalBillingConfig().ok)throw new Error('RENEWAL_NOT_CONFIGURED');
   if(input.renewals&&!input.enabled)throw new Error('CONTROL_INVALID');
   await tx(async c=>{
    const control=await c.query<{operator_test_enabled:boolean}>('SELECT operator_test_enabled FROM brand_billing_control WHERE id=true FOR UPDATE');
    if(!control.rows[0])throw new Error('CONTROL_MISSING');
    if(input.enabled&&control.rows[0].operator_test_enabled)throw new Error('DISABLE_OPERATOR_TEST_FIRST');
    await c.query('UPDATE brand_billing_control SET enabled=$1,renewals_enabled=$2,operator_test_enabled=CASE WHEN $1=false THEN false ELSE operator_test_enabled END,updated_by=$3,updated_at=now() WHERE id=true',[input.enabled===true,input.renewals===true,u.id]);
    await c.query('INSERT INTO brand_billing_events(event,actor) VALUES($1,$2)',[input.enabled?input.renewals?'billing_and_renewals_enabled':'card_registration_enabled':'billing_master_disabled',u.id]);
   });
  }else{
   if(!/^[0-9a-f-]{36}$/i.test(input.id||''))throw new Error('INVALID_ID');
   if(input.op==='pause')await pauseBrandBilling(input.id!,u.id);
   else if(input.op==='resume')await resumeBrandBilling(input.id!,u.id);
   else throw new Error('INVALID_OP');
  }
  revalidatePath('/contracts/recurring');return {ok:true};
 }catch{return {ok:false,error:'변경하지 못했습니다. 연결 설정·계약기간·미확정 결제·예정일을 확인해 주세요.'};}
}
export async function operatorValidationAction(input:{op:'enable'|'disable'|'connection';contractId?:string}) {
 const u=await currentUser();if(!u||u.role!=='exec')return {ok:false,error:'대표만 운영자 검증을 설정할 수 있습니다.'};
 const {operatorBillingConfig,billingConnectionConfig}=await import('@/lib/danal/config');
 try{
  if(input.op==='connection'){
   const cfg=billingConnectionConfig();if(!cfg.ok)return {ok:false,error:'누락된 연결 설정: '+cfg.missing.join(', ')};
   const {batchCall,registrationAuthFields,verifyAuth}=await import('@/lib/danal/danal-batch');
   const {randomUUID}=await import('node:crypto');const id='GKCHECK'+randomUUID().replace(/-/g,'');
   const common={orderId:id,itemName:'GloveK connection check',userId:'gk_check_'+randomUUID(),userAgent:'PC' as const,returnUrl:cfg.config.origin+'/contracts/recurring',cancelUrl:cfg.config.origin+'/contracts/recurring'};
   const result=await batchCall(cfg.config.keys,cfg.config.relay,(url,init)=>fetch(url,{...init,redirect:'error'}),{operation:'AUTH',idempotencyKey:'auth:glovek:connection:'+id,fields:registrationAuthFields(common)});
   const proof='unknown' in result?{kind:'unknown' as const}:verifyAuth(result.fields,{orderId:id,amount:100});
   if(proof.kind!=='success'){const code=('unknown' in result?result.unknown:proof.kind==='failed'?proof.code:'UNVERIFIED').replace(/[^A-Za-z0-9_]/g,'').slice(0,64);return {ok:false,error:'AUTH 연결 확인 실패 ('+code+'). 중계·가맹점 키를 확인해 주세요. 카드 승인 요청은 하지 않았습니다.'};}
   await query('INSERT INTO brand_billing_events(event,actor) VALUES($1,$2)',['operator_connection_auth_verified',u.id]);
   return {ok:true,message:'AUTH 0000 · 암복호화와 중계 응답을 확인했습니다. 카드 등록·실승인·정기청구 성공을 뜻하지 않습니다.'};
  }
  if(input.op==='disable'){
   await query('UPDATE brand_billing_control SET operator_test_enabled=false,updated_by=$1,updated_at=now() WHERE id=true',[u.id]);
  }else if(input.op==='enable'){
   if(!operatorBillingConfig().ok)throw new Error('CONFIG_MISSING');
   const {kstDate}=await import('@/lib/danal/schedule');const today=kstDate();
   await tx(async c=>{
    const r=await c.query<{id:string}>(`SELECT r.id FROM recurring_contracts r JOIN contracts c ON c.id=r.contract_id
     WHERE r.id=$1 AND r.title LIKE '[운영자검증]%' AND r.monthly_amount=301 AND r.vat_mode='included' AND r.first_billing_date=$2::date
     AND c.status NOT IN ('terminated','expired') AND c.start_date<=$2::date AND c.end_date>=$2::date
     AND NOT EXISTS(SELECT 1 FROM brand_billing_subscriptions s WHERE s.recurring_contract_id=r.id AND s.is_operator_test=false) FOR UPDATE OF r`,[input.contractId||null,today]);
    if(!r.rowCount)throw new Error('OPERATOR_CONTRACT_INVALID');
    await c.query('UPDATE brand_billing_control SET enabled=false,renewals_enabled=false,operator_test_enabled=true,operator_test_contract_id=$1,updated_by=$2,updated_at=now() WHERE id=true',[input.contractId,u.id]);
    await c.query('INSERT INTO brand_billing_events(event,actor) VALUES($1,$2)',['operator_301_contract_scoped',u.id]);
   });
  }else throw new Error('INVALID_OP');
  revalidatePath('/contracts/recurring');return {ok:true,message:input.op==='enable'?'이 계약의 301원 1회 검증만 허용했습니다. 일반 고객 결제·자동갱신은 OFF입니다.':'운영자 검증을 중지했습니다.'};
 }catch{return {ok:false,error:'운영자 검증을 변경하지 못했습니다. 키·중계 연결과 오늘 시작하는 301원(VAT 포함) 전용 계약을 확인해 주세요.'};}
}
