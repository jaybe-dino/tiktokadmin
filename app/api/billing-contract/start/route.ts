import {verifyBillingFormProof} from '../../../../lib/danal/form-proof';
import {billingStartErrorCode} from '../../../../lib/danal/start-error';
import {NextRequest} from 'next/server';
import {startBrandCardRegistration} from '../../../../lib/danal/brand-billing';
import {isAllowedDanalStartUrl} from '../../../../lib/danal/danal-start-url';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function html(body:string,status=200){return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GloveK 카드 등록</title><body style="font-family:sans-serif;max-width:720px;margin:48px auto;padding:20px">'+body+'</body></html>',{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});}
export async function POST(req:NextRequest){
 const origin=process.env.DANAL_SITE_ORIGIN;
 const requestOrigin=req.headers.get('origin');
 if(!origin||(requestOrigin&&requestOrigin!=='null'&&requestOrigin!==origin))return html('<h1>요청 출처를 확인하지 못했습니다.</h1><p>계약 확인 페이지를 새로 열어 진행해 주세요.</p>',403);
 if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return html('<h1>지원하지 않는 요청입니다.</h1>',415);
 let text='';try{const reader=req.body?.getReader();if(!reader)return html('<h1>신청 내용이 없습니다.</h1>',400);const chunks:Uint8Array[]=[];let bytes=0;while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>4096){await reader.cancel();return html('<h1>요청이 너무 큽니다.</h1>',413);}chunks.push(r.value);}text=Buffer.concat(chunks).toString('utf8');}catch{return html('<h1>요청을 읽지 못했습니다.</h1>',400);}
 const data=new URLSearchParams(text),token=data.get('token')||'';
 if(data.getAll('token').length!==1||data.getAll('consent').length!==1||!/^[a-f0-9]{64}$/.test(token)||data.get('consent')!=='yes')return html('<h1>동의 항목을 확인해 주세요.</h1><p>계약 내용 확인과 동의 체크 후 다시 진행해 주세요.</p>',400);
 if(data.getAll('form_proof').length!==1||!verifyBillingFormProof(token,data.get('form_proof')||''))return html('<h1>계약 확인 요청이 만료되었거나 올바르지 않습니다.</h1><p>계약 확인 페이지를 새로고침한 뒤 동의하고 진행해 주세요.</p><a href="/billing-contract/'+token+'">계약 확인 화면으로 돌아가기</a>',403);
 try{
  const result=await startBrandCardRegistration(token,true);
  if(!result.url||!result.params||!isAllowedDanalStartUrl(result.url))throw new Error('CARD_WINDOW_UNAVAILABLE');
  return html('<h1>다날 카드 등록창으로 이동합니다.</h1><p>자동으로 이동하지 않으면 아래 버튼을 눌러 주세요. 카드 입력 후 승인 시 계약에 안내된 금액이 실제 결제됩니다.</p><form id="danal" method="POST" accept-charset="EUC-KR" action="'+escape(result.url)+'"><input type="hidden" name="STARTPARAMS" value="'+escape(result.params)+'"><button type="submit" style="padding:14px">다날 결제창 열기</button></form><script>document.getElementById("danal").submit()</script>');
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const message=code==='CARD_WINDOW_PREPARING'?'이미 카드 등록창을 준비하고 있습니다. 잠시 후 계약 화면에서 진행하면 기존 요청을 이어서 엽니다.':code==='CONTRACT_TERMS_CHANGED'?'계약 조건이 변경되어 확인이 필요합니다. 담당자에게 문의해 주세요.':code==='FIRST_BILLING_DATE_PASSED'?'최초 결제 예정일이 지났습니다. 담당자에게 계약 일정 확인을 요청해 주세요.':code==='SUBSCRIPTION_ALREADY_REGISTERED_OR_HELD'?'이미 카드 등록이 진행되었거나 확인이 필요한 계약입니다. 중복 시도하지 말고 담당자에게 확인해 주세요.':'카드 등록창을 열지 못했습니다. 결제 관리 화면의 최근 시도를 확인해 주세요. 실제 승인 여부가 확인되기 전에는 반복 결제하지 마세요.';
  return html('<h1>카드 등록 요청을 완료하지 못했습니다.</h1><p>'+message+'</p><p>확인코드: '+billingStartErrorCode(e)+'</p><a href="/billing-contract/'+token+'">계약 확인 화면으로 돌아가기</a>',409);
 }
}
