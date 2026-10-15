"use server";
import { startBrandCardRegistration } from '@/lib/danal/brand-billing';
export async function startCardAction(token:string,consent:boolean):Promise<{ok:boolean;url?:string;params?:string;error?:string}> {
 try{const result=await startBrandCardRegistration(token,consent);return {ok:true,...result};}
 catch(e){
  const code=e instanceof Error?e.message:'';
  const messages:Record<string,string>={BILLING_NOT_CONFIGURED:'카드 등록 연결을 준비 중입니다. 담당자에게 문의해 주세요.',BILLING_DISABLED:'현재 카드 등록이 중지되어 있습니다.',FIRST_BILLING_DATE_PASSED:'최초 결제 예정일이 지났습니다. 담당자에게 계약 조건 확인을 요청해 주세요.',SUBSCRIPTION_ALREADY_REGISTERED_OR_HELD:'이미 카드가 등록되었거나 담당자 확인이 필요한 계약입니다.'};
  return {ok:false,error:messages[code]||'카드 등록창을 열지 못했습니다. 담당자에게 확인해 주세요.'};
 }
}
