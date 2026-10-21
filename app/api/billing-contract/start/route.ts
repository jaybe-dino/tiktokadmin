import {verifyBillingFormProof} from '../../../../lib/danal/form-proof';
import {billingStartErrorCode} from '../../../../lib/danal/start-error';
import {NextRequest} from 'next/server';
import {startBrandCardRegistration} from '../../../../lib/danal/brand-billing';
import {isAllowedDanalStartUrl} from '../../../../lib/danal/danal-start-url';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function html(body:string,status=200){
 const style='*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#17263c;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;word-break:keep-all}main{max-width:640px;margin:60px auto;padding:30px;background:white;border:1px solid #e0e6ef;border-radius:18px}h1{font-size:26px;line-height:1.4;letter-spacing:-.6px;margin:22px 0 16px}p{color:#52647a}a,button{display:inline-block;min-height:48px;padding:11px 20px;background:#2563eb;color:white;border:0;border-radius:10px;text-decoration:none;font:600 15px/1.6 inherit;cursor:pointer}summary{cursor:pointer;color:#64748b}details{margin:20px 0;font-size:13px;overflow-wrap:anywhere}.brand{color:#2563eb;font-weight:800;letter-spacing:2px;font-size:14px}.help{font-size:13px;margin-top:24px}@media(max-width:680px){main{margin:24px 16px;padding:24px}h1{font-size:24px}a,button{width:100%;text-align:center}}';
 return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GloveK 카드 등록</title><style>'+style+'</style><body><main><div class="brand">GloveK</div>'+body+'<p class="help">도움이 필요하면 이 링크를 전달한 계약 담당자에게 문의해 주세요.</p></main></body></html>',{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
}
export async function POST(req:NextRequest){
 const origin=process.env.DANAL_SITE_ORIGIN;
 const requestOrigin=req.headers.get('origin');
 if(!origin||(requestOrigin&&requestOrigin!=='null'&&requestOrigin!==origin))return html('<h1>계약 확인 화면에서 시작해 주세요.</h1><p>담당자에게 받은 계약 링크를 다시 열고 진행해 주세요.</p>',403);
 if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return html('<h1>지원하지 않는 요청입니다.</h1>',415);
 let text='';try{const reader=req.body?.getReader();if(!reader)return html('<h1>신청 내용이 없습니다.</h1>',400);const chunks:Uint8Array[]=[];let bytes=0;while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>4096){await reader.cancel();return html('<h1>요청이 너무 큽니다.</h1>',413);}chunks.push(r.value);}text=Buffer.concat(chunks).toString('utf8');}catch{return html('<h1>요청을 읽지 못했습니다.</h1>',400);}
 const data=new URLSearchParams(text),token=data.get('token')||'';
 if(data.getAll('token').length!==1||data.getAll('consent').length!==1||!/^[a-f0-9]{64}$/.test(token)||data.get('consent')!=='yes')return html('<h1>동의 항목을 확인해 주세요.</h1><p>계약 내용 확인과 동의 체크 후 다시 진행해 주세요.</p>',400);
 if(data.getAll('form_proof').length!==1||!verifyBillingFormProof(token,data.get('form_proof')||''))return html('<h1>계약 확인 시간이 지났습니다.</h1><p>아래 버튼으로 계약 화면을 다시 열고, 내용을 확인한 뒤 동의해 주세요.</p><a href="/billing-contract/'+token+'">계약 확인 화면으로 돌아가기</a>',403);
 try{
  const result=await startBrandCardRegistration(token,true);
  if(!result.url||!result.params||!isAllowedDanalStartUrl(result.url))throw new Error('CARD_WINDOW_UNAVAILABLE');
  return html('<h1>다날 카드 등록창으로 이동합니다.</h1><p>자동으로 이동하지 않으면 아래 버튼을 눌러 주세요. 카드 정보를 입력하면 계약 화면에서 안내한 결제·카드 등록 절차가 진행됩니다.</p><form id="danal" method="POST" accept-charset="EUC-KR" action="'+escape(result.url)+'"><input type="hidden" name="STARTPARAMS" value="'+escape(result.params)+'"><button type="submit" style="padding:14px">카드 입력창 열기</button></form><script>document.getElementById("danal").submit()</script>');
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const message=code==='CARD_WINDOW_PREPARING'?'이미 카드 등록창을 준비하고 있습니다. 잠시 후 계약 화면에서 진행하면 기존 요청을 이어서 엽니다.':code==='CONTRACT_TERMS_CHANGED'?'계약 조건이 변경되어 확인이 필요합니다. 담당자에게 문의해 주세요.':code==='FIRST_BILLING_DATE_PASSED'?'최초 결제 예정일이 지났습니다. 담당자에게 계약 일정 확인을 요청해 주세요.':code==='SUBSCRIPTION_ALREADY_REGISTERED_OR_HELD'?'이미 카드 등록이 진행되었거나 확인이 필요한 계약입니다. 중복 시도하지 말고 담당자에게 확인해 주세요.':'계약 담당자에게 이 화면을 전달해 주세요. 이미 결제를 진행했다면 결과 확인 전에는 다시 시도하지 마세요.';
  return html('<h1>잠시 확인이 필요합니다.</h1><p>'+message+'</p><details><summary>담당자에게 전달할 확인 정보</summary><p>확인코드: '+billingStartErrorCode(e)+'</p></details><a href="/billing-contract/'+token+'">계약 확인 화면으로 돌아가기</a>',409);
 }
}
