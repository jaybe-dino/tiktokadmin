import { parseBatchKeys, type BatchKeys, type RelayConfig } from './danal-batch';
import { parseEncryptionKey } from './crypto';
export type BrandBillingConfig = { keys:BatchKeys; relay:RelayConfig; encryptionKey:Uint8Array; origin:string };
export function brandBillingConfig(env:Record<string,string|undefined> = process.env): {ok:true;config:BrandBillingConfig}|{ok:false;missing:string[]} {
 const missing:string[]=[];
 for(const flag of ['DANAL_ENABLED','DANAL_BILLING_CONTRACT_CONFIRMED','DANAL_BATCH_STATIC_EGRESS_CONFIRMED']) if(env[flag]!=='true')missing.push(flag);
 if(env.DANAL_API_MODE!=='legacy_cpid_batch')missing.push('DANAL_API_MODE');
 // This is a separate application, not permission to reuse EscapeMate's live customer keys.
 if(env.DANAL_SERVICE_CONFIRMED!=='glovek_brand_contracts')missing.push('DANAL_SERVICE_CONFIRMED');
 const keys=parseBatchKeys(env.DANAL_BATCH_CPID,env.DANAL_BATCH_CRYPTOKEY,env.DANAL_BATCH_IVKEY);
 if(!keys || keys.cpid!=='A010015125')missing.push('DANAL_BATCH_CPID|DANAL_BATCH_CRYPTOKEY|DANAL_BATCH_IVKEY');
 const encryptionKey=parseEncryptionKey(env.BILLING_KEY_ENCRYPTION_KEY);if(!encryptionKey)missing.push('BILLING_KEY_ENCRYPTION_KEY');
 const secret=env.DANAL_RELAY_SECRET||'';if(secret.length<32)missing.push('DANAL_RELAY_SECRET');
 let origin='',relay='';
 try{const u=new URL(env.DANAL_SITE_ORIGIN||'');if(u.protocol==='https:'&&!u.username&&!u.password&&u.origin===env.DANAL_SITE_ORIGIN)origin=u.origin;}catch{}
 if(!origin)missing.push('DANAL_SITE_ORIGIN');
 try{const u=new URL(env.DANAL_RELAY_URL||'');if(u.protocol==='https:'&&u.hostname==='relay.escapemate.games'&&u.origin===env.DANAL_RELAY_URL&&!u.username&&!u.password)relay=u.origin;}catch{}
 if(!relay)missing.push('DANAL_RELAY_URL');
 if(missing.length||!keys||!encryptionKey)return {ok:false,missing};
 return {ok:true,config:{keys,relay:{url:relay,secret},encryptionKey,origin}};
}
