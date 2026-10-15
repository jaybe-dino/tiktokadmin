import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, queryOne, tx } from '../db';
import { hashContractToken } from '../recurring-contracts';
import { recurringTotal } from '../recurring-contract-policy';
import { brandBillingConfig, operatorBillingConfig, renewalBillingConfig, type BrandBillingConfig } from './config';
import { encryptSecret, decryptSecret } from './crypto';
import { authFields, registrationAuthFields, registrationIssueBillKeyFields, issueBillKeyFields, otbillFields,
 batchCall, decodeEncrypted, readReturnParams, verifyAuth, verifyIssueBillKey, verifyRegistrationIssueBillKey, verifyOtbill, type RelayTransport } from './danal-batch';
import { kstDate, nextBillingDate } from './schedule';
export const BILLING_CONSENT_VERSION='glovek-monthly-2026-10-15-v1';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const itemName='GloveK Brand Contract Monthly';
type Attempt={id:string;subscription_id:string;order_id:string;due_date:string;amount:string;is_bill:boolean;status:string;auth_tid:string|null;kind:'initial'|'renewal';auth_expires_at:string|null;contract_link_hash:string|null};
type Sub={id:string;recurring_contract_id:string;billing_user_key:string;status:string;billing_key_ciphertext:string|null;next_billing_date:string|null;consent_snapshot_hash:string;is_operator_test:boolean};
type Agreement={id:string;monthly_amount:string;vat_mode:string;first_billing_date:string;end_date:string;start_date:string;details:string;fee_details:string;cancellation_terms:string;file_sha256:string;status:string};
function agreementHash(a:Agreement) { return digest(JSON.stringify([a.id,a.monthly_amount,a.vat_mode,a.first_billing_date,a.start_date,a.end_date,a.details,a.fee_details,a.cancellation_terms,a.file_sha256])); }
export type BillingDependencies={config:BrandBillingConfig;transport:RelayTransport;now:Date;clock?:()=>Date;operatorOnly?:boolean;operatorReady?:boolean;renewalsReady?:boolean};
export function billingDependencies():BillingDependencies {
 const normal=brandBillingConfig(),operator=operatorBillingConfig();
 const c=normal.ok?normal:operator;if(!c.ok)throw new Error('BILLING_NOT_CONFIGURED');
 return {renewalsReady:renewalBillingConfig().ok,operatorOnly:!normal.ok,operatorReady:operator.ok,config:c.config,transport:(url,init)=>fetch(url,{...init,redirect:'error'}),now:new Date(),clock:()=>new Date()};
}
export async function billingControl(client?:PoolClient) {
 type Control={enabled:boolean;renewals_enabled:boolean;operator_test_enabled:boolean;operator_test_contract_id:string|null};
 const sql='SELECT enabled,renewals_enabled,operator_test_enabled,operator_test_contract_id FROM brand_billing_control WHERE id=true';
 const c=client?(await client.query<Control>(sql)).rows[0]:await queryOne<Control>(sql);
 if(!c)throw new Error('BILLING_CONTROL_MISSING');return c;
}
async function checkEnabled(renewal=false) {
 const c=await billingControl();if(!c.enabled||(renewal&&!c.renewals_enabled))throw new Error('BILLING_DISABLED');
}
async function checkScope(contractId:string,isOperator:boolean,deps:BillingDependencies,renewal=false,client?:PoolClient) {
 const c=await billingControl(client);
 if(renewal&&deps.renewalsReady===false)throw new Error('RENEWAL_EGRESS_NOT_CONFIRMED');
 if(isOperator){
  if(!deps.operatorReady||renewal||!c.operator_test_enabled||c.operator_test_contract_id!==contractId)throw new Error('OPERATOR_TEST_DISABLED');
 }else{
  if(deps.renewalsReady===false)throw new Error('RENEWAL_EGRESS_NOT_CONFIRMED');
 if(deps.operatorOnly)throw new Error('REGULAR_BILLING_DISABLED');
  if(!c.enabled||(renewal&&!c.renewals_enabled))throw new Error('BILLING_DISABLED');
 }
}
async function preProvider(a:Attempt, now:Date,deps:BillingDependencies) {
 const r=await queryOne<Agreement & {sub_status:string;consent_snapshot_hash:string;is_operator_test:boolean;token_hash:string|null;link_expires_at:string|null;link_revoked_at:string|null}>(
  `SELECT r.*,c.start_date,c.end_date,c.status,s.status AS sub_status,s.consent_snapshot_hash,s.is_operator_test FROM recurring_contracts r
   JOIN contracts c ON c.id=r.contract_id JOIN brand_billing_subscriptions s ON s.recurring_contract_id=r.id WHERE s.id=$1`,[a.subscription_id]);
 if(!r)throw new Error('STATE_CHANGED');
 await checkScope(r.id,r.is_operator_test,deps,a.kind==='renewal');
 const today=kstDate(now);
 if(r.is_operator_test&&(Number(a.amount)!==301||!a.is_bill))throw new Error('OPERATOR_AMOUNT_MISMATCH');
 if(!r||['terminated','expired'].includes(r.status)||r.end_date<today||agreementHash(r)!==r.consent_snapshot_hash)throw new Error('STATE_CHANGED');
 if(a.kind==='renewal'&&(r.sub_status!=='active'||r.start_date>today||a.due_date!==today))throw new Error('STATE_CHANGED');
 if(a.kind==='initial'&&((a.is_bill&&a.due_date!==today)||a.due_date<today||r.sub_status!=='awaiting_card'||r.token_hash!==a.contract_link_hash||r.link_revoked_at||!r.link_expires_at||new Date(r.link_expires_at).getTime()<=Date.now()))throw new Error('STATE_CHANGED');
}
async function event(subscriptionId:string,attemptId:string|null,name:string,actor='system') {
 await query('INSERT INTO brand_billing_events(subscription_id,attempt_id,event,actor) VALUES($1,$2,$3,$4)',[subscriptionId,attemptId,name,actor]);
}
async function outcomeFailure(a:Attempt,code:string,unknown:boolean) {
 await tx(async c=>{
  await c.query("UPDATE brand_billing_attempts SET status=$2,failure_code=$3,updated_at=now() WHERE id=$1 AND status='approving'",[a.id,unknown?'unknown':'failed',code.replace(/[^A-Za-z0-9_]/g,'').slice(0,64)]);
  await c.query("UPDATE brand_billing_subscriptions SET status=$2,updated_at=now() WHERE id=$1",[a.subscription_id,!unknown&&a.kind==='initial'?'awaiting_card':'needs_review']);
 });
 await event(a.subscription_id,a.id,unknown?'approval_unknown':'approval_declined');
}
export async function startBrandCardRegistration(token:string,consent:boolean,deps=billingDependencies()) {
 if(consent!==true||!/^[a-f0-9]{64}$/.test(token))throw new Error('CONSENT_OR_LINK_REQUIRED');
 const state=randomBytes(32).toString('hex'),today=kstDate(deps.now);
 const prepared=await tx(async c=>{
  // Lock the agreement, so two clicks cannot start separate first payments.
  const r=await c.query<Agreement>(`SELECT r.*,c.start_date,c.end_date,c.status FROM recurring_contracts r
   JOIN contracts c ON c.id=r.contract_id WHERE r.token_hash=$1 AND r.link_expires_at>now() AND r.link_revoked_at IS NULL
   AND c.status NOT IN ('terminated','expired') AND c.end_date >= $2::date FOR UPDATE OF r`,[hashContractToken(token),today]);
  const a=r.rows[0];if(!a)throw new Error('INVALID_CONTRACT_LINK');
  const control=await billingControl(c);const isOperator=control.operator_test_enabled&&control.operator_test_contract_id===a.id;
  await checkScope(a.id,isOperator,deps,false,c);
  if(isOperator&&(recurringTotal(Number(a.monthly_amount),a.vat_mode)!==301||a.first_billing_date!==today))throw new Error('OPERATOR_CONTRACT_MUST_BE_301_TODAY');
  if(a.first_billing_date<today)throw new Error('FIRST_BILLING_DATE_PASSED');
  const amount=recurringTotal(Number(a.monthly_amount),a.vat_mode);if(amount<301)throw new Error('MINIMUM_BILLING_AMOUNT_301');
  const snapshot=agreementHash(a);
  const s=await c.query<Sub>(`INSERT INTO brand_billing_subscriptions(recurring_contract_id,billing_user_key,consent_at,consent_version,consent_snapshot_hash,is_operator_test)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(recurring_contract_id) DO UPDATE SET updated_at=brand_billing_subscriptions.updated_at RETURNING *`,[a.id,'gk_'+randomUUID(),deps.now.toISOString(),BILLING_CONSENT_VERSION,snapshot,isOperator]);
  const sub=s.rows[0];if(sub.is_operator_test!==isOperator)throw new Error('BILLING_MODE_MISMATCH');if(sub.status!=='awaiting_card')throw new Error('SUBSCRIPTION_ALREADY_REGISTERED_OR_HELD');
  await c.query("UPDATE brand_billing_attempts SET status='expired' WHERE subscription_id=$1 AND kind='initial' AND status IN ('preparing','ready') AND auth_expires_at < $2",[sub.id,deps.now.toISOString()]);
  const p=await c.query<Attempt>(`INSERT INTO brand_billing_attempts(subscription_id,kind,order_id,due_date,amount,is_bill,status,callback_state_hash,auth_expires_at,contract_link_hash)
   VALUES($1,'initial',$2,$3,$4,$5,'preparing',$6,$7,$8) RETURNING *`,[sub.id,'GKB'+randomUUID().replace(/-/g,''),a.first_billing_date,a.first_billing_date===today?amount:100,a.first_billing_date===today,digest(state),new Date(deps.now.getTime()+30*60000).toISOString(),hashContractToken(token)]);
  await c.query('INSERT INTO brand_billing_events(subscription_id,attempt_id,event,actor) VALUES($1,$2,$3,$4)',[sub.id,p.rows[0].id,'card_registration_consented','client']);
  return {a,sub,attempt:p.rows[0]};
 });
 const p=prepared.attempt;
 const urls={returnUrl:`${deps.config.origin}/api/billing-contract/return?s=${state}`,cancelUrl:`${deps.config.origin}/billing-result/${state}`};
 const common={orderId:p.order_id,itemName,userId:prepared.sub.billing_user_key,userAgent:'PC' as const,...urls};
 let result;
 try{
  await checkScope(prepared.a.id,prepared.sub.is_operator_test,deps);
  const call=await batchCall(deps.config.keys,deps.config.relay,deps.transport,{operation:'AUTH',idempotencyKey:`auth:glovek:${p.order_id}`,fields:p.is_bill?authFields({...common,amount:Number(p.amount),notiUrl:null}):registrationAuthFields(common)});
  result='unknown' in call?{kind:'unknown' as const,reason:call.unknown}:verifyAuth(call.fields,{orderId:p.order_id,amount:Number(p.amount)});
 }catch{result={kind:'unknown' as const,reason:'AUTH_UNAVAILABLE'};}
 if(result.kind!=='success'){
  await query("UPDATE brand_billing_attempts SET status='failed',failure_code='AUTH_UNAVAILABLE',updated_at=now() WHERE id=$1 AND status='preparing'",[p.id]);
  throw new Error('CARD_WINDOW_UNAVAILABLE'); // AUTH did not charge; a new attempt is allowed.
 }
 const updated=await queryOne<{id:string}>("UPDATE brand_billing_attempts SET auth_tid=$2,status='ready',updated_at=now() WHERE id=$1 AND status='preparing' RETURNING id",[p.id,result.data.tid]);
 if(!updated)throw new Error('CARD_WINDOW_STATE_CHANGED');
 return {url:result.data.startUrl,params:result.data.startParams};
}
export async function completeBrandCardRegistration(state:string,returnParams:string,deps=billingDependencies()) {
 if(!/^[a-f0-9]{64}$/.test(state)||!returnParams||returnParams.length>8192)return;
 const a=await queryOne<Attempt>('SELECT * FROM brand_billing_attempts WHERE callback_state_hash=$1 AND kind=\'initial\'',[digest(state)]);
 if(!a||a.status!=='ready'||!a.auth_tid)return;
 const scope=await queryOne<Sub>('SELECT * FROM brand_billing_subscriptions WHERE id=$1',[a.subscription_id]);
 if(!scope)return;await checkScope(scope.recurring_contract_id,scope.is_operator_test,deps);
 const info=readReturnParams(await decodeEncrypted(deps.config.keys,returnParams));
 if(!info||info.tid!==a.auth_tid||(info.orderId!==null&&info.orderId!==a.order_id))return;
 if(info.returnCode!=='0000'){
  await query("UPDATE brand_billing_attempts SET status='failed',failure_code='CARD_AUTH_DECLINED',updated_at=now() WHERE id=$1 AND status='ready'",[a.id]);return;
 }
 const today=kstDate(deps.now);
 const claim=await tx(async c=>{
  const s=await c.query<Sub>("SELECT * FROM brand_billing_subscriptions WHERE id=$1 FOR UPDATE",[a.subscription_id]);const sub=s.rows[0];
  if(!sub||sub.status!=='awaiting_card')return null;
  const agreement=await c.query<Agreement>(`SELECT r.*,c.start_date,c.end_date,c.status FROM recurring_contracts r JOIN contracts c ON c.id=r.contract_id
    WHERE r.id=$1 AND r.link_expires_at>now() AND r.link_revoked_at IS NULL AND r.token_hash=$3
    AND c.status NOT IN ('terminated','expired') AND c.end_date >= $2::date`,[sub.recurring_contract_id,today,a.contract_link_hash]);
  const r=agreement.rows[0];if(!r||agreementHash(r)!==sub.consent_snapshot_hash)return null;
  if((a.is_bill&&a.due_date!==today)||(!a.is_bill&&a.due_date<today))return null;
  if(a.is_bill&&Number(a.amount)!==recurringTotal(Number(r.monthly_amount),r.vat_mode))return null;
  const p=await c.query<Attempt>("UPDATE brand_billing_attempts SET status='approving',updated_at=now() WHERE id=$1 AND status='ready' AND auth_expires_at>$2 RETURNING *",[a.id,deps.now.toISOString()]);
  return p.rows[0]?{sub,agreement:r}:null;
 });
 if(!claim)return;
 // This row remains approving/unknown on any DB failure after a provider request; never retry ISSUEBILLKEY.
 try{await preProvider(a,deps.clock?.()||deps.now,deps);}catch{
  await query("UPDATE brand_billing_attempts SET status='blocked',failure_code='PRE_PROVIDER_HOLD' WHERE id=$1 AND status='approving'",[a.id]);return;
 }
 let outcome;
 try{
  const call=await batchCall(deps.config.keys,deps.config.relay,deps.transport,{operation:'ISSUEBILLKEY',idempotencyKey:`issuebillkey:glovek:${a.order_id}`,fields:a.is_bill?issueBillKeyFields({tid:a.auth_tid,amount:Number(a.amount)}):registrationIssueBillKeyFields({tid:a.auth_tid})});
  outcome='unknown' in call?{kind:'unknown' as const,reason:call.unknown}:a.is_bill?verifyIssueBillKey(call.fields,{tid:a.auth_tid,orderId:a.order_id,amount:Number(a.amount)}):verifyRegistrationIssueBillKey(call.fields,{tid:a.auth_tid,orderId:a.order_id});
 }catch{outcome={kind:'unknown' as const,reason:'APPROVAL_UNAVAILABLE'};}
 if(outcome.kind!=='success'){await outcomeFailure(a,outcome.kind==='failed'?outcome.code:outcome.reason,outcome.kind==='unknown');return;}
 const key=outcome.data.billKey;
 try{
  const cipher=await encryptSecret(deps.config.encryptionKey,key,`glovek:${claim.sub.id}`);
  await tx(async c=>{
   // A duplicate BILLKEY is held for review. Never delete or re-charge a shared key.
   await c.query("UPDATE brand_billing_subscriptions SET billing_key_ciphertext=$2,billing_key_hash=$3,status=CASE WHEN status='awaiting_card' THEN 'active' ELSE status END,next_billing_date=$4,updated_at=now() WHERE id=$1",[claim.sub.id,cipher,digest(key),a.is_bill?nextBillingDate(claim.agreement.first_billing_date,a.due_date):claim.agreement.first_billing_date]);
   await c.query("UPDATE brand_billing_attempts SET status=$2,provider_tid=$3,provider_code='0000',completed_at=now(),updated_at=now() WHERE id=$1 AND status='approving'",[a.id,a.is_bill?'paid':'registered',a.auth_tid]);
   await c.query('INSERT INTO brand_billing_events(subscription_id,attempt_id,event,actor) VALUES($1,$2,$3,$4)',[claim.sub.id,a.id,claim.sub.is_operator_test?'operator_301_charge_verified':a.is_bill?'first_charge_verified':'temporary_registration_verified','provider']);
  });
 }catch{await outcomeFailure(a,'LEDGER_OR_KEY_COLLISION',true);}
}
export async function runBrandRenewals(deps=billingDependencies()) {
 if(deps.renewalsReady===false)throw new Error('RENEWAL_EGRESS_NOT_CONFIRMED');
 if(deps.operatorOnly)throw new Error('REGULAR_BILLING_DISABLED');
 await checkEnabled(true);const today=kstDate(deps.now);
 // Missed dates require a review; never silently charge multiple accumulated months.
 await query("UPDATE brand_billing_subscriptions SET status='needs_review',updated_at=now() WHERE status='active' AND is_operator_test=false AND next_billing_date<$1::date",[today]);
 const due=await query<{id:string}>("SELECT id FROM brand_billing_subscriptions WHERE status='active' AND is_operator_test=false AND next_billing_date=$1::date ORDER BY next_billing_date,id LIMIT 5",[today]);
 let processed=0;
 for(const row of due){
  await checkEnabled(true);
  const p=await tx(async c=>{
   const s=await c.query<Sub>("SELECT * FROM brand_billing_subscriptions WHERE id=$1 AND status='active' AND is_operator_test=false AND next_billing_date=$2::date FOR UPDATE",[row.id,today]);const sub=s.rows[0];if(!sub||!sub.billing_key_ciphertext)return null;
   const r=await c.query<Agreement>(`SELECT r.*,c.start_date,c.end_date,c.status FROM recurring_contracts r JOIN contracts c ON c.id=r.contract_id WHERE r.id=$1 AND c.status NOT IN ('terminated','expired') AND c.start_date<=$2::date AND c.end_date>=$2::date`,[sub.recurring_contract_id,today]);
   const agreement=r.rows[0];if(agreement&&agreementHash(agreement)!==sub.consent_snapshot_hash){await c.query("UPDATE brand_billing_subscriptions SET status='needs_review',updated_at=now() WHERE id=$1",[sub.id]);return null;}if(!agreement){await c.query("UPDATE brand_billing_subscriptions SET status='ended',updated_at=now() WHERE id=$1",[sub.id]);return null;}
   const a=await c.query<Attempt>(`INSERT INTO brand_billing_attempts(subscription_id,kind,order_id,due_date,amount,is_bill,status)
    VALUES($1,'renewal',$2,$3,$4,true,'approving') ON CONFLICT(subscription_id,due_date) WHERE kind='renewal' DO UPDATE SET status='approving',failure_code=NULL,updated_at=now() WHERE brand_billing_attempts.status='blocked' AND brand_billing_attempts.failure_code='PRE_PROVIDER_HOLD' RETURNING *`,[sub.id,'GKB'+randomUUID().replace(/-/g,''),today,recurringTotal(Number(agreement.monthly_amount),agreement.vat_mode)]);
   return a.rows[0]?{sub,agreement,attempt:a.rows[0]}:null;
  });
  if(!p)continue;
  try{await preProvider(p.attempt,deps.clock?.()||deps.now,deps);}catch{
   await query("UPDATE brand_billing_attempts SET status='blocked',failure_code='PRE_PROVIDER_HOLD' WHERE id=$1 AND status='approving'",[p.attempt.id]);continue;
  }
  let result;
  try{
   const key=await decryptSecret(deps.config.encryptionKey,p.sub.billing_key_ciphertext!,`glovek:${p.sub.id}`);
   const call=await batchCall(deps.config.keys,deps.config.relay,deps.transport,{operation:'OTBILL',idempotencyKey:`otbill:glovek:${p.attempt.order_id}`,fields:otbillFields({orderId:p.attempt.order_id,itemName,amount:Number(p.attempt.amount),userId:p.sub.billing_user_key,billKey:key})});
   result='unknown' in call?{kind:'unknown' as const,reason:call.unknown}:verifyOtbill(call.fields,{orderId:p.attempt.order_id,amount:Number(p.attempt.amount)});
  }catch{result={kind:'unknown' as const,reason:'RENEWAL_UNAVAILABLE'};}
  if(result.kind!=='success'){await outcomeFailure(p.attempt,result.kind==='failed'?result.code:result.reason,result.kind==='unknown');continue;}
  try{
  await tx(async c=>{
   await c.query("UPDATE brand_billing_attempts SET status='paid',provider_tid=$2,provider_code='0000',completed_at=now(),updated_at=now() WHERE id=$1 AND status='approving'",[p.attempt.id,result.data.tid]);
   // A pause during an in-flight charge stays paused; only advance the billing date.
   await c.query('UPDATE brand_billing_subscriptions SET next_billing_date=$2,updated_at=now() WHERE id=$1',[p.sub.id,nextBillingDate(p.agreement.first_billing_date,today)]);
   await c.query('INSERT INTO brand_billing_events(subscription_id,attempt_id,event,actor) VALUES($1,$2,$3,$4)',[p.sub.id,p.attempt.id,'renewal_verified','provider']);
  });processed++;
  }catch{await outcomeFailure(p.attempt,'RENEWAL_LEDGER_FAILED',true);}
 }
 return {processed};
}
export async function pauseBrandBilling(id:string,actor:string) {
 await tx(async c=>{
  const row=await c.query<{id:string}>("UPDATE brand_billing_subscriptions SET status='paused',paused_by=$2,paused_at=now(),updated_at=now() WHERE id=$1 AND status IN ('active','awaiting_card') RETURNING id",[id,actor]);
  if(!row.rowCount)throw new Error('SUBSCRIPTION_NOT_PAUSABLE');
  await c.query('INSERT INTO brand_billing_events(subscription_id,event,actor) VALUES($1,$2,$3)',[id,'subscription_paused',actor]);
 });
}
export async function billingResult(state:string) {
 if(!/^[a-f0-9]{64}$/.test(state))return null;
 return queryOne<{status:string;is_bill:boolean;amount:string;is_operator_test:boolean}>("SELECT a.status,a.is_bill,a.amount,s.is_operator_test FROM brand_billing_attempts a JOIN brand_billing_subscriptions s ON s.id=a.subscription_id WHERE a.callback_state_hash=$1",[digest(state)]);
}
export async function resumeBrandBilling(id:string,actor:string) {
 await tx(async c=>{
  const s=await c.query<Sub>("SELECT * FROM brand_billing_subscriptions WHERE id=$1 FOR UPDATE",[id]);const sub=s.rows[0];
  if(!sub||sub.is_operator_test||sub.status!=='paused'||!sub.billing_key_ciphertext||!sub.next_billing_date||sub.next_billing_date<kstDate())throw new Error('RESUME_REQUIRES_REVIEW');
  const unresolved=await c.query("SELECT id FROM brand_billing_attempts WHERE subscription_id=$1 AND status IN ('approving','unknown')",[id]);
  if(unresolved.rowCount)throw new Error('UNRESOLVED_PAYMENT');
  const valid=await c.query(`SELECT r.id FROM recurring_contracts r JOIN contracts c ON c.id=r.contract_id WHERE r.id=$1 AND c.status NOT IN ('terminated','expired') AND c.end_date >= current_date`,[sub.recurring_contract_id]);
  if(!valid.rowCount)throw new Error('CONTRACT_ENDED');
  await c.query("UPDATE brand_billing_subscriptions SET status='active',paused_by=NULL,paused_at=NULL,updated_at=now() WHERE id=$1",[id]);
  await c.query('INSERT INTO brand_billing_events(subscription_id,event,actor) VALUES($1,$2,$3)',[id,'subscription_resumed',actor]);
 });
}
