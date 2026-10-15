import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const ttl=30*60*1000;
function sign(contractToken:string,value:string,secret:string){return createHmac('sha256',secret).update('glovek-card-form-v1\n'+contractToken+'\n'+value).digest('hex');}
/** Issued by the contract page; binds consent submission to this contract for 30 minutes. */
export function createBillingFormProof(contractToken:string,now=Date.now(),secret=process.env.ADMIN_SESSION_SECRET||''){
 if(secret.length<16||!/^[a-f0-9]{64}$/.test(contractToken))throw new Error('FORM_SIGNING_NOT_CONFIGURED');
 const value=now+'.'+randomBytes(16).toString('hex');return value+'.'+sign(contractToken,value,secret);
}
export function verifyBillingFormProof(contractToken:string,proof:string,now=Date.now(),secret=process.env.ADMIN_SESSION_SECRET||''){
 if(secret.length<16||!/^[a-f0-9]{64}$/.test(contractToken))return false;
 const match=/^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(proof);if(!match)return false;
 const issued=Number(match[1]);if(issued>now+60000||now-issued>ttl)return false;
 return timingSafeEqual(Buffer.from(match[3],'hex'),Buffer.from(sign(contractToken,match[1]+'.'+match[2],secret),'hex'));
}
