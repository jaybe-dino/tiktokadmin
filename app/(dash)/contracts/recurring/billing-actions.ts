"use server";
import { currentUser } from '@/lib/auth';
import { query,tx } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { brandBillingConfig } from '@/lib/danal/config';
import { pauseBrandBilling,resumeBrandBilling } from '@/lib/danal/brand-billing';
export async function billingAdminAction(input:{op:string;id?:string;enabled?:boolean;renewals?:boolean}) {
 const u=await currentUser();if(!u||!['exec','lead','settle'].includes(u.role))return {ok:false,error:'결제 관리 권한이 필요합니다.'};
 try{
  if(input.op==='control'){
   if((input.enabled||input.renewals)&&!brandBillingConfig().ok)throw new Error('CONFIG_MISSING');
   if(input.renewals&&!input.enabled)throw new Error('CONTROL_INVALID');
   await tx(async c=>{
    await c.query('UPDATE brand_billing_control SET enabled=$1,renewals_enabled=$2,updated_by=$3,updated_at=now() WHERE id=true',[input.enabled===true,input.renewals===true,u.id]);
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
