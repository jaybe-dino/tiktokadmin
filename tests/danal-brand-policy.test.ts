import {describe,it,expect} from 'vitest';
import {brandBillingConfig,operatorBillingConfig,billingConnectionConfig,renewalBillingConfig} from '../lib/danal/config';
import {nextBillingDate,kstDate} from '../lib/danal/schedule';
import {authFields,otbillFields,registrationAuthFields,registrationIssueBillKeyFields,verifyIssueBillKey,verifyOtbill,verifyRegistrationIssueBillKey,parseBatchKeys,encodeRequest,decodeEncrypted} from '../lib/danal/danal-batch';
import {encryptSecret,decryptSecret} from '../lib/danal/crypto';
import {createDecipheriv} from 'node:crypto';
const env={DANAL_ENABLED:'true',DANAL_BILLING_CONTRACT_CONFIRMED:'true',DANAL_BATCH_STATIC_EGRESS_CONFIRMED:'true',DANAL_SERVICE_CONFIRMED:'glovek_brand_contracts',DANAL_API_MODE:'legacy_cpid_batch',DANAL_BATCH_CPID:'A010015125',DANAL_BATCH_CRYPTOKEY:'11'.repeat(32),DANAL_BATCH_IVKEY:'22'.repeat(16),BILLING_KEY_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64'),DANAL_RELAY_SECRET:'test-secret'.repeat(5),DANAL_RELAY_URL:'https://relay.escapemate.games',DANAL_SITE_ORIGIN:'https://admin.glovek.space'};
describe('GloveK recurring configuration',()=>{
 it('does not infer recurring readiness from general card or EscapeMate flags',()=>{expect(brandBillingConfig({}).ok).toBe(false);expect(brandBillingConfig({...env,DANAL_SERVICE_CONFIRMED:'escapemate'}).ok).toBe(false);expect(brandBillingConfig({...env,DANAL_BATCH_CPID:'A010015124'}).ok).toBe(false);expect(brandBillingConfig(env).ok).toBe(true);});
 it('fails closed for every missing secret and approval',()=>{for(const key of Object.keys(env).filter(k=>k!=='DANAL_BATCH_STATIC_EGRESS_CONFIRMED'))expect(brandBillingConfig({...env,[key]:''}).ok,key).toBe(false);});
 it('first approval can open while unverified OTBILL stays blocked',()=>{const first={...env,DANAL_BATCH_STATIC_EGRESS_CONFIRMED:'false'};expect(brandBillingConfig(first).ok).toBe(true);expect(renewalBillingConfig(first).ok).toBe(false);expect(renewalBillingConfig(env).ok).toBe(true);});
 it('operator readiness never opens ordinary billing',()=>{
  const test={...env,DANAL_ENABLED:'false',DANAL_OPERATOR_TEST_ENABLED:'true'};
  expect(operatorBillingConfig(test).ok).toBe(true);expect(brandBillingConfig(test).ok).toBe(false);
  expect(operatorBillingConfig({...test,DANAL_OPERATOR_TEST_ENABLED:'false'}).ok).toBe(false);
 });
 it('AUTH-only diagnosis requires real crypto and relay configuration even with billing gates closed',()=>{
  const closed={...env,DANAL_ENABLED:'false',DANAL_BILLING_CONTRACT_CONFIRMED:'false',DANAL_BATCH_STATIC_EGRESS_CONFIRMED:'false'};
  expect(billingConnectionConfig(closed).ok).toBe(true);expect(brandBillingConfig(closed).ok).toBe(false);
  expect(billingConnectionConfig({...closed,DANAL_RELAY_SECRET:''}).ok).toBe(false);
 });
 it('rejects unverified relay origins and malformed origin',()=>{for(const url of ['https://relay.escapemate.games.evil.test','https://user@relay.escapemate.games','http://relay.escapemate.games','https://relay.escapemate.games/path'])expect(brandBillingConfig({...env,DANAL_RELAY_URL:url}).ok).toBe(false);});
});
describe('Calendar and amount integrity',()=>{
 it('preserves original day through February and leap years',()=>{expect(nextBillingDate('2027-01-31','2027-01-31')).toBe('2027-02-28');expect(nextBillingDate('2027-01-31','2027-02-28')).toBe('2027-03-31');expect(nextBillingDate('2028-01-31','2028-01-31')).toBe('2028-02-29');expect(nextBillingDate('2026-12-30','2026-12-30')).toBe('2027-01-30');});
 it('uses Korean date at UTC rollover',()=>expect(kstDate(new Date('2026-10-15T15:00:00Z'))).toBe('2026-10-16'));
 it('keeps temporary card registration out of monthly payment',()=>{const a={orderId:'GKBtest',itemName:'GloveK Monthly',userId:'user',userAgent:'PC' as const,returnUrl:'https://admin.glovek.space/return?s=test',cancelUrl:'https://admin.glovek.space/cancel'};expect(Object.fromEntries(registrationAuthFields(a))).toMatchObject({ISBILL:'N',AMOUNT:'100',SERVICETYPE:'BATCH'});expect(Object.fromEntries(registrationIssueBillKeyFields({tid:'T1'}))).not.toHaveProperty('AMOUNT');expect(Object.fromEntries(authFields({...a,amount:3300000,notiUrl:null}))).toMatchObject({ISBILL:'Y',AMOUNT:'3300000'});expect(()=>otbillFields({orderId:'x',itemName:'GloveK',amount:300,userId:'u',billKey:'key'})).toThrow();});
});
describe('Danal proofs and encryption',()=>{
 it('0000 alone never proves payment or registration',()=>{const fields=new Map([['RETURNCODE','0000']]);expect(verifyIssueBillKey(fields,{tid:'T1',orderId:'x',amount:3300000}).kind).toBe('unknown');expect(verifyOtbill(fields,{orderId:'x',amount:3300000}).kind).toBe('unknown');expect(verifyRegistrationIssueBillKey(fields,{tid:'T1',orderId:'x'}).kind).toBe('unknown');});
 it('rejects order, amount, first-payment mode mismatches',()=>{const good=new Map(Object.entries({RETURNCODE:'0000',TID:'T1',ORDERID:'x',AMOUNT:'3300000',ISBILL:'Y',BILLKEY:'BKtest'}));expect(verifyIssueBillKey(good,{tid:'T1',orderId:'x',amount:3300000}).kind).toBe('success');for(const [k,v] of [['ORDERID','other'],['AMOUNT','1'],['ISBILL','N']])expect(verifyIssueBillKey(new Map([...good,[k,v]]),{tid:'T1',orderId:'x',amount:3300000}).kind).toBe('unknown');});
 it('wire format decrypts using independent Node AES and encodes outer Base64 once',async()=>{const keys=parseBatchKeys('TESTCPID','11'.repeat(32),'22'.repeat(16))!;const body=await encodeRequest(keys,[['TXTYPE','AUTH'],['ITEMNAME','GloveK Brand Monthly']]);const form=new URLSearchParams(body);const d=createDecipheriv('aes-256-cbc',Buffer.alloc(32,0x11),Buffer.alloc(16,0x22));const plain=Buffer.concat([d.update(Buffer.from(form.get('DATA')!,'base64')),d.final()]).toString();expect(plain).toBe('TXTYPE=AUTH&ITEMNAME=GloveK+Brand+Monthly');expect(form.get('CPID')).toBe('TESTCPID');expect((await decodeEncrypted(keys,form.get('DATA')!))?.get('TXTYPE')).toBe('AUTH');});
 it('row-bound encryption prevents moving billing tokens between subscriptions',async()=>{const k=new Uint8Array(32).fill(4),cipher=await encryptSecret(k,'synthetic-card-token','glovek:row1');expect(cipher).not.toContain('synthetic-card-token');expect(await decryptSecret(k,cipher,'glovek:row1')).toBe('synthetic-card-token');await expect(decryptSecret(k,cipher,'glovek:row2')).rejects.toThrow();});
});
