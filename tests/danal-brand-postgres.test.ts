// Explicit opt-in: launches an isolated local PostgreSQL, synthetic rows and an in-memory PG relay.
// No production connection and no outbound fetch. Run GLOVEK_BILLING_PG_TEST=1 npm test -- tests/danal-brand-postgres.test.ts
import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,createHmac,createHash,randomUUID,randomBytes} from 'node:crypto';
import {query,getPool} from '../lib/db';
import {startBrandCardRegistration,completeBrandCardRegistration,runBrandRenewals,pauseBrandBilling,testSavedBrandCard} from '../lib/danal/brand-billing';
import {type BillingDependencies} from '../lib/danal/brand-billing';
import {parseBatchKeys,relayResponseCanonical} from '../lib/danal/danal-batch';
const enabled=process.env.GLOVEK_BILLING_PG_TEST==='1';
const suite=enabled?describe:describe.skip;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const KEY=Buffer.alloc(32,0x11),IV=Buffer.alloc(16,0x22),SECRET='synthetic-relay-secret-'.repeat(3);
function enc(fields:Record<string,string>){const plain=new URLSearchParams(fields).toString();const c=createCipheriv('aes-256-cbc',KEY,IV);return Buffer.concat([c.update(plain),c.final()]).toString('base64');}
function dec(v:string){const d=createDecipheriv('aes-256-cbc',KEY,IV);return Object.fromEntries(new URLSearchParams(Buffer.concat([d.update(Buffer.from(v,'base64')),d.final()]).toString()));}
function harness(now=new Date('2027-01-31T01:00:00Z')) {
 const calls:Record<string,string>[]=[];const auths=new Map<string,Record<string,string>>();let state='',tid='';
 const behavior={issue:'ok',otbill:'ok',fixedKey:'',pauseDuringRenewal:false};
 const config={keys:parseBatchKeys('TESTCPID',KEY.toString('hex'),IV.toString('hex'))!,relay:{url:'https://relay.invalid',secret:SECRET},encryptionKey:new Uint8Array(32).fill(5),origin:'https://admin.example.test'};
 const deps:BillingDependencies={now,config,transport:async(_url,init)=>{
  const body=JSON.parse(String(init.body)),outer=new URLSearchParams(body.body),f=dec(outer.get('DATA')!);calls.push(f);
  // Match the deployed relay's operation-scoped idempotency contract.
  expect(body.idempotencyKey).toMatch(/^(auth|issuebillkey|otbill|delbillkey|cancel):[A-Za-z0-9:_-]{8,200}$/);
  expect(body.idempotencyKey.startsWith(body.operation.toLowerCase()+':')).toBe(true);
  let result:Record<string,string>;
  if(f.TXTYPE==='AUTH'){
   tid='T'+randomUUID().replace(/-/g,'');state=new URL(f.RETURNURL).searchParams.get('s')!;auths.set(tid,f);
   result={RETURNCODE:'0000',TID:tid,ORDERID:f.ORDERID,AMOUNT:f.AMOUNT,STARTURL:'https://checkout.teledit.com/start',STARTPARAMS:'synthetic-opaque-start'};
  }else if(f.TXTYPE==='ISSUEBILLKEY'){
   if(behavior.issue==='timeout')throw new Error('network ambiguity');
   if(behavior.issue==='decline')result={RETURNCODE:'2002'};
   else{const a=auths.get(f.TID)!;result={RETURNCODE:'0000',TID:f.TID,ORDERID:a.ORDERID,ISBILL:a.ISBILL,AMOUNT:behavior.issue==='wrong_amount'?'1':a.ISBILL==='Y'?a.AMOUNT:'100',BILLKEY:behavior.fixedKey||'BK'+f.TID};}
  }else if(f.TXTYPE==='OTBILL'){
   if(behavior.otbill==='timeout')throw new Error('network ambiguity');
   if(behavior.pauseDuringRenewal)await query("UPDATE brand_billing_subscriptions SET status='paused'");
   result={RETURNCODE:'0000',TID:'R'+randomUUID().replace(/-/g,''),ORDERID:f.ORDERID,AMOUNT:behavior.otbill==='wrong_amount'?'1':f.AMOUNT};
  }else throw new Error('unexpected money operation');
  const text=JSON.stringify({ok:true,httpStatus:200,body:'DATA='+encodeURIComponent(enc(result))});
  const nonce=new Headers(init.headers).get('X-Relay-Nonce')!;
  const sig=createHmac('sha256',SECRET).update(relayResponseCanonical(nonce,hash(text))).digest('hex');
  return new Response(text,{headers:{'X-Relay-Response-Signature':sig}});
 }};
 return {deps,calls,behavior,get state(){return state;},get tid(){return tid;},returnParams:(foreign=false)=>enc({RETURNCODE:'0000',TID:foreign?'FOREIGNTID':tid}),auths};
}
suite('Danal GloveK isolated PostgreSQL + mock relay',()=>{
 let root='',data='',socket='';
 beforeAll(async()=>{
  root=mkdtempSync(join(tmpdir(),'gk-billing-test-'));data=join(root,'data');socket=join(root,'socket');mkdirSync(socket);
  execFileSync('initdb',['-D',data,'-A','trust','--no-locale','-U','postgres'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',data,'-l',join(root,'pg.log'),'-o',`-k ${socket} -h '' -p 56448`,'-w','start'],{stdio:'ignore'});
  process.env.DATABASE_URL=`postgresql://postgres@localhost:56448/postgres?host=${socket}`;
  await query('CREATE TABLE brands(id uuid PRIMARY KEY,brand_name text); CREATE TABLE contracts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),brand_id uuid REFERENCES brands(id),kind text,start_date date,end_date date,status text DEFAULT \'draft\',terms jsonb,note text);');
  await query(readFileSync('migrations/0116_recurring_contracts.sql','utf8'));await query(readFileSync('migrations/0117_danal_brand_billing.sql','utf8'));
  await query(readFileSync('migrations/0118_danal_operator_validation.sql','utf8'));
  await query(readFileSync('migrations/0119_danal_card_window_resume.sql','utf8'));
  await query(readFileSync('migrations/0120_danal_saved_card_test.sql','utf8'));
  await query(readFileSync('migrations/0118_danal_operator_validation.sql','utf8'));
 },30000);
 afterAll(async()=>{if(globalThis.__glovekPool){await getPool().end();globalThis.__glovekPool=undefined;}if(data)execFileSync('pg_ctl',['-D',data,'-m','fast','-w','stop'],{stdio:'ignore'});});
 beforeEach(async()=>{
  await query('DROP TRIGGER IF EXISTS test_off ON brand_billing_attempts; DROP TRIGGER IF EXISTS test_fail ON brand_billing_attempts;');
  await query('TRUNCATE brand_billing_events,brand_billing_attempts,brand_billing_subscriptions,recurring_contracts,contracts,brands CASCADE');
  await query('INSERT INTO brand_billing_control(id,enabled,renewals_enabled) VALUES(true,true,true) ON CONFLICT(id) DO UPDATE SET enabled=true,renewals_enabled=true,operator_test_enabled=false,operator_test_contract_id=NULL');
 });
 async function agreement(first='2027-01-31'){
  const bid=randomUUID(),cid=randomUUID(),rid=randomUUID(),token=randomBytes(32).toString('hex');
  await query('INSERT INTO brands VALUES($1,$2)',[bid,'SYNTHETIC BRAND']);
  await query('INSERT INTO contracts(id,brand_id,start_date,end_date) VALUES($1,$2,$3,$4)',[cid,bid,first,'2028-12-31']);
  await query(`INSERT INTO recurring_contracts(id,contract_id,brand_id,title,details,monthly_amount,vat_mode,first_billing_date,cancellation_terms,file_name,file_bytes,file_sha256,created_by,token_hash,link_expires_at)
   VALUES($1,$2,$3,'Synthetic Contract','Test terms',3000000,'excluded',$4,'Test cancellation','test.pdf',$5,'test','tester',$6,now()+interval '365 days')`,[rid,cid,bid,first,Buffer.from('%PDF-test'),hash(token)]);
  return {rid,cid,token};
 }
 const count=(h:ReturnType<typeof harness>,op:string)=>h.calls.filter(f=>f.TXTYPE===op).length;
 it('one explicit 301 OTBILL test charges once without advancing the next renewal date',async()=>{const a=await agreement(),h=harness();await query("UPDATE recurring_contracts SET title='테스트',monthly_amount=301,vat_mode='included' WHERE id=$1",[a.rid]);await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);const [sub]=await query('SELECT id,next_billing_date FROM brand_billing_subscriptions');h.deps.renewalsReady=false;await query('UPDATE brand_billing_control SET renewals_enabled=false');const results=await Promise.all([testSavedBrandCard(sub.id,'exec',301,h.deps),testSavedBrandCard(sub.id,'exec',301,h.deps)]);expect(results.some(r=>r.status==='paid')).toBe(true);expect(count(h,'OTBILL')).toBe(1);await testSavedBrandCard(sub.id,'exec',301,h.deps);expect(count(h,'OTBILL')).toBe(1);expect((await query('SELECT next_billing_date FROM brand_billing_subscriptions'))[0].next_billing_date).toBe(sub.next_billing_date);await expect(testSavedBrandCard(sub.id,'exec',302,h.deps)).rejects.toThrow('SCOPE');});
 it('ambiguous one-off OTBILL is never retried',async()=>{const a=await agreement(),h=harness();await query("UPDATE recurring_contracts SET title='테스트',monthly_amount=301,vat_mode='included' WHERE id=$1",[a.rid]);await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);const [sub]=await query('SELECT id FROM brand_billing_subscriptions');h.behavior.otbill='timeout';expect((await testSavedBrandCard(sub.id,'exec',301,h.deps)).status).toBe('unknown');await expect(testSavedBrandCard(sub.id,'exec',301,h.deps)).rejects.toThrow();expect(count(h,'OTBILL')).toBe(1);});
 it('resumes an existing ready window without another AUTH or attempt',async()=>{const a=await agreement(),h=harness();const first=await startBrandCardRegistration(a.token,true,h.deps);const again=await startBrandCardRegistration(a.token,true,h.deps);expect(again).toEqual(first);expect(count(h,'AUTH')).toBe(1);expect((await query('SELECT id FROM brand_billing_attempts')).length).toBe(1);const [row]=await query('SELECT card_window_ciphertext FROM brand_billing_attempts');expect(row.card_window_ciphertext).not.toContain('synthetic-opaque-start');await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(1);});
 it('rotated links expire only pending AUTH and prevent the old callback approving',async()=>{const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);const oldState=h.state,oldReturn=h.returnParams(),next=randomBytes(32).toString('hex');await query('UPDATE recurring_contracts SET token_hash=$1 WHERE id=$2',[hash(next),a.rid]);await startBrandCardRegistration(next,true,h.deps);expect(count(h,'AUTH')).toBe(2);await completeBrandCardRegistration(oldState,oldReturn,h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(0);expect((await query("SELECT id FROM brand_billing_attempts WHERE status='expired'")).length).toBe(1);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(1);});
 it('replaces legacy ready AUTH without stored window but never clears an ambiguous approval',async()=>{const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);await query('UPDATE brand_billing_attempts SET card_window_ciphertext=NULL');await startBrandCardRegistration(a.token,true,h.deps);expect(count(h,'AUTH')).toBe(2);await query("UPDATE brand_billing_attempts SET status='unknown' WHERE status='ready'");await expect(startBrandCardRegistration(a.token,true,h.deps)).rejects.toThrow('HELD');expect(count(h,'AUTH')).toBe(2);});
 it('first card approval succeeds with renewal egress still unconfirmed',async()=>{const a=await agreement(),h=harness();h.deps.renewalsReady=false;await startBrandCardRegistration(a.token,true,h.deps);expect(count(h,'AUTH')).toBe(1);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(1);expect((await query("SELECT id FROM brand_billing_attempts WHERE status='paid'")).length).toBe(1);await expect(runBrandRenewals(h.deps)).rejects.toThrow('RENEWAL_EGRESS_NOT_CONFIRMED');expect(count(h,'OTBILL')).toBe(0);});
 it('unconfirmed renewal egress never contacts the provider even when DB renewal is ON',async()=>{const h=harness();h.deps.renewalsReady=false;await expect(runBrandRenewals(h.deps)).rejects.toThrow('RENEWAL_EGRESS_NOT_CONFIRMED');expect(h.calls).toHaveLength(0);});
 it('only one of concurrent start/callback clicks can charge the first month',async()=>{
  const a=await agreement(),h=harness();const starts=await Promise.allSettled([startBrandCardRegistration(a.token,true,h.deps),startBrandCardRegistration(a.token,true,h.deps)]);
  const fulfilled=starts.filter((v):v is PromiseFulfilledResult<{url:string;params:string}>=>v.status==='fulfilled');expect(fulfilled.length).toBeGreaterThanOrEqual(1);if(fulfilled.length===2)expect(fulfilled[0].value).toEqual(fulfilled[1].value);expect(count(h,'AUTH')).toBe(1);
  await Promise.all([completeBrandCardRegistration(h.state,h.returnParams(),h.deps),completeBrandCardRegistration(h.state,h.returnParams(),h.deps)]);
  await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(1);
  const [s]=await query('SELECT * FROM brand_billing_subscriptions');expect(s.status).toBe('active');expect(s.next_billing_date).toBe('2027-02-28');expect(s.billing_key_ciphertext).not.toContain('BK'+h.tid);expect(s.consent_snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await query("SELECT * FROM brand_billing_attempts WHERE status='paid'")).length).toBe(1);
 });
 it('blocks consent omission, foreign TID, revoked and rotated links without approval',async()=>{
  const a=await agreement(),h=harness();await expect(startBrandCardRegistration(a.token,false,h.deps)).rejects.toThrow();expect(h.calls).toHaveLength(0);
  await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(true),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(0);
  await query('UPDATE recurring_contracts SET token_hash=$1',[hash('rotated')]);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(0);
 });
 it('OFF before approval never reaches the provider',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);await query('UPDATE brand_billing_control SET enabled=false');await expect(completeBrandCardRegistration(h.state,h.returnParams(),h.deps)).rejects.toThrow('DISABLED');expect(count(h,'ISSUEBILLKEY')).toBe(0);
 });
 it('checks OFF again after the single-flight claim',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);
  await query(`CREATE OR REPLACE FUNCTION test_off_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='approving' THEN UPDATE brand_billing_control SET enabled=false; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_off BEFORE UPDATE ON brand_billing_attempts FOR EACH ROW EXECUTE FUNCTION test_off_fn();`);
  await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(0);expect((await query('SELECT status FROM brand_billing_attempts'))[0].status).toBe('blocked');
 });
 it('ambiguous approval locks the row and prevents replay or a new checkout',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);h.behavior.issue='timeout';await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);
  await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);await expect(startBrandCardRegistration(a.token,true,h.deps)).rejects.toThrow();expect(count(h,'ISSUEBILLKEY')).toBe(1);expect((await query('SELECT status FROM brand_billing_attempts'))[0].status).toBe('unknown');
 });
 it('first future contract only registers a key, then bills exactly once on its due date',async()=>{
  const a=await agreement('2027-02-28'),h=harness();await startBrandCardRegistration(a.token,true,h.deps);expect(h.calls[0].ISBILL).toBe('N');expect(h.calls[0].AMOUNT).toBe('100');await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);
  expect((await query('SELECT status FROM brand_billing_attempts'))[0].status).toBe('registered');expect((await query('SELECT next_billing_date FROM brand_billing_subscriptions'))[0].next_billing_date).toBe('2027-02-28');
  h.deps.now=new Date('2027-02-28T01:00:00Z');await Promise.all([runBrandRenewals(h.deps),runBrandRenewals(h.deps)]);expect(count(h,'OTBILL')).toBe(1);expect(h.calls.find(f=>f.TXTYPE==='OTBILL')!.AMOUNT).toBe('3300000');expect(h.calls.find(f=>f.TXTYPE==='OTBILL')!.USERID).toBe(h.calls[0].USERID);
 });
 it('same-day first charge is never also charged by the renewal worker; preserves month-end anchor',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);await runBrandRenewals(h.deps);expect(count(h,'OTBILL')).toBe(0);
  h.deps.now=new Date('2027-02-28T01:00:00Z');await Promise.all([runBrandRenewals(h.deps),runBrandRenewals(h.deps)]);expect(count(h,'OTBILL')).toBe(1);expect((await query('SELECT next_billing_date FROM brand_billing_subscriptions'))[0].next_billing_date).toBe('2027-03-31');
 });
 it('pause during an in-flight renewal stays paused after successful approval',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);h.deps.now=new Date('2027-02-28T01:00:00Z');h.behavior.pauseDuringRenewal=true;await runBrandRenewals(h.deps);expect((await query('SELECT status FROM brand_billing_subscriptions'))[0].status).toBe('paused');
 });
 it('unknown renewal and wrong amounts never mark paid or advance the schedule',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);h.deps.now=new Date('2027-02-28T01:00:00Z');h.behavior.otbill='wrong_amount';await runBrandRenewals(h.deps);await runBrandRenewals(h.deps);expect(count(h,'OTBILL')).toBe(1);const [s]=await query('SELECT status,next_billing_date FROM brand_billing_subscriptions');expect(s.status).toBe('needs_review');expect(s.next_billing_date).toBe('2027-02-28');
 });
 it('stopped, ended, or missed-date agreements are not silently charged',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);await query("UPDATE contracts SET status='terminated'");h.deps.now=new Date('2027-02-28T01:00:00Z');await runBrandRenewals(h.deps);expect(count(h,'OTBILL')).toBe(0);expect((await query('SELECT status FROM brand_billing_subscriptions'))[0].status).toBe('ended');
 });
 it('a ledger failure after approval holds for review and never repeats approval',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);
  await query(`CREATE OR REPLACE FUNCTION test_fail_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='paid' THEN RAISE EXCEPTION 'synthetic ledger failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail BEFORE UPDATE ON brand_billing_attempts FOR EACH ROW EXECUTE FUNCTION test_fail_fn();`);
  await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(1);expect((await query('SELECT status FROM brand_billing_subscriptions'))[0].status).toBe('needs_review');expect((await query('SELECT status FROM brand_billing_attempts'))[0].status).toBe('unknown');
 });
 it('contract changes require renewed consent before a renewal',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);
  await query('UPDATE recurring_contracts SET monthly_amount=4000000');h.deps.now=new Date('2027-02-28T01:00:00Z');await runBrandRenewals(h.deps);
  expect(count(h,'OTBILL')).toBe(0);expect((await query('SELECT status FROM brand_billing_subscriptions'))[0].status).toBe('needs_review');
 });
 it('a pause committed during the approval claim is rechecked before reaching the provider',async()=>{
  const a=await agreement(),h=harness();await startBrandCardRegistration(a.token,true,h.deps);
  await query(`CREATE OR REPLACE FUNCTION test_off_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='approving' THEN UPDATE brand_billing_subscriptions SET status='paused' WHERE id=NEW.subscription_id; END IF; RETURN NEW; END $$;
   CREATE TRIGGER test_off BEFORE UPDATE ON brand_billing_attempts FOR EACH ROW EXECUTE FUNCTION test_off_fn();`);
  await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);expect(count(h,'ISSUEBILLKEY')).toBe(0);expect((await query('SELECT status FROM brand_billing_attempts'))[0].status).toBe('blocked');
 });
 it('operator 301 verification works with public billing OFF and remains forever excluded from renewals',async()=>{
  const a=await agreement(),h=harness();h.deps.operatorOnly=true;h.deps.operatorReady=true;
  await query("UPDATE recurring_contracts SET title='[운영자검증] synthetic',monthly_amount=301,vat_mode='included' WHERE id=$1",[a.rid]);
  await query('UPDATE brand_billing_control SET enabled=false,renewals_enabled=false,operator_test_enabled=true,operator_test_contract_id=$1',[a.rid]);
  await startBrandCardRegistration(a.token,true,h.deps);expect(h.calls[0].AMOUNT).toBe('301');await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);
  const [sub]=await query('SELECT * FROM brand_billing_subscriptions');expect(sub.is_operator_test).toBe(true);expect(sub.status).toBe('active');
  expect((await query('SELECT event FROM brand_billing_events ORDER BY id DESC LIMIT 1'))[0].event).toBe('operator_301_charge_verified');
  await query('UPDATE brand_billing_control SET enabled=true,renewals_enabled=true,operator_test_enabled=false');h.deps.operatorOnly=false;h.deps.operatorReady=false;h.deps.now=new Date('2027-02-28T01:00:00Z');
  await runBrandRenewals(h.deps);expect(count(h,'OTBILL')).toBe(0);
 });
 it('operator verification cannot start a different contract or approve after being disabled',async()=>{
  const a=await agreement(),b=await agreement(),h=harness();h.deps.operatorOnly=true;h.deps.operatorReady=true;
  await query("UPDATE recurring_contracts SET monthly_amount=301,vat_mode='included'");
  await query('UPDATE brand_billing_control SET enabled=false,operator_test_enabled=true,operator_test_contract_id=$1',[a.rid]);
  await expect(startBrandCardRegistration(b.token,true,h.deps)).rejects.toThrow('REGULAR_BILLING_DISABLED');expect(h.calls).toHaveLength(0);
  await startBrandCardRegistration(a.token,true,h.deps);await query('UPDATE brand_billing_control SET operator_test_enabled=false');
  await expect(completeBrandCardRegistration(h.state,h.returnParams(),h.deps)).rejects.toThrow('OPERATOR_TEST_DISABLED');expect(count(h,'ISSUEBILLKEY')).toBe(0);
 });
 it('operator scope rejects a real monthly amount above 301 KRW before AUTH',async()=>{
  const a=await agreement(),h=harness();h.deps.operatorOnly=true;h.deps.operatorReady=true;
  await query('UPDATE brand_billing_control SET enabled=false,operator_test_enabled=true,operator_test_contract_id=$1',[a.rid]);
  await expect(startBrandCardRegistration(a.token,true,h.deps)).rejects.toThrow('OPERATOR_CONTRACT_MUST_BE_301_TODAY');expect(h.calls).toHaveLength(0);
 });
 it('duplicate BILLKEY across contracts is held without deleting or charging the key again',async()=>{
  const a=await agreement(),h=harness();h.behavior.fixedKey='synthetic-shared-key';await startBrandCardRegistration(a.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);
  const b=await agreement();await startBrandCardRegistration(b.token,true,h.deps);await completeBrandCardRegistration(h.state,h.returnParams(),h.deps);const all=await query('SELECT status FROM brand_billing_subscriptions');expect(all.map(s=>s.status).sort()).toEqual(['active','needs_review']);expect(count(h,'OTBILL')).toBe(0);expect(h.calls.some(f=>f.TXTYPE==='DELBILLKEY')).toBe(false);
 });
});
