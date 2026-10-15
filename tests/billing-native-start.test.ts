import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
vi.mock('../lib/danal/brand-billing',()=>({startBrandCardRegistration:vi.fn()}));
import {startBrandCardRegistration} from '../lib/danal/brand-billing';
import {billingStartErrorCode} from '../lib/danal/start-error';
import {POST} from '../app/api/billing-contract/start/route';
const start=vi.mocked(startBrandCardRegistration),token='a'.repeat(64),origin='https://admin.glovek.space';
function req(body:string,from=origin){return new NextRequest(origin+'/api/billing-contract/start',{method:'POST',headers:{origin:from,'content-type':'application/x-www-form-urlencoded'},body});}
beforeEach(()=>{vi.resetAllMocks();process.env.DANAL_SITE_ORIGIN=origin;});
describe('Native card registration submission',()=>{
 it('diagnostics expose only bounded codes',()=>{expect(billingStartErrorCode({code:'42703',message:'private SQL'})).toBe('DB_42703');expect(billingStartErrorCode(new Error('private SQL'))).toBe('PREPARE_FAILED');});
 it('blocks foreign origins, omitted consent and duplicate consent before any provider call',async()=>{
  expect((await POST(req('token='+token+'&consent=yes','https://foreign.invalid'))).status).toBe(403);
  expect((await POST(req('token='+token))).status).toBe(400);
  expect((await POST(req('token='+token+'&consent=yes&consent=yes'))).status).toBe(400);
  expect(start).not.toHaveBeenCalled();
 });
 it('creates the provider POST form with a manual fallback and escaped opaque fields',async()=>{
  start.mockResolvedValue({url:'https://checkout.teledit.com/start',params:'a"<&value'});
  const r=await POST(req('token='+token+'&consent=yes')),s=await r.text();
  expect(r.status).toBe(200);expect(start).toHaveBeenCalledWith(token,true);
  expect(s).toContain('method="POST"');expect(s).toContain('name="STARTPARAMS" value="a&quot;&lt;&amp;value"');expect(s).toContain('다날 결제창 열기');expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it('rejects oversized requests without entering card registration',async()=>{expect((await POST(req('token='+token+'&consent=yes&x='+'x'.repeat(5000)))).status).toBe(413);expect(start).not.toHaveBeenCalled();});
 it('renders a visible error instead of a silent click and never echoes a raw failure',async()=>{start.mockRejectedValue(new Error('private provider error'));const r=await POST(req('token='+token+'&consent=yes')),s=await r.text();expect(r.status).toBe(409);expect(s).toContain('카드 등록 요청을 완료하지 못했습니다');expect(s).not.toContain('private provider error');});
});
