import { NextResponse } from 'next/server';
import { completeBrandCardRegistration } from '@/lib/danal/brand-billing';
import { brandBillingConfig } from '@/lib/danal/config';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(req:Request) {
 const config=brandBillingConfig();if(!config.ok)return new NextResponse('Payment unavailable',{status:503});
 const state=new URL(req.url).searchParams.get('s')||'';
 if(!/^[a-f0-9]{64}$/.test(state))return new NextResponse('Invalid reference',{status:400});
 // Bound both advertised and actual body size. Never log provider payloads.
 if(Number(req.headers.get('content-length')||'0')>20000)return new NextResponse('Too large',{status:413});
 const reader=req.body?.getReader();if(!reader)return new NextResponse('Invalid body',{status:400});
 let raw='',size=0;
 try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>20000){await reader.cancel();return new NextResponse('Too large',{status:413});}raw+=new TextDecoder().decode(p.value);}}finally{reader.releaseLock();}
 try{const form=new URLSearchParams(raw);if(form.getAll('RETURNPARAMS').length===1)await completeBrandCardRegistration(state,form.get('RETURNPARAMS')||'');}catch{/* Approval state remains locked for review; no implicit retry. */}
 return NextResponse.redirect(new URL(`/billing-result/${state}`,config.config.origin),303);
}
