import { NextRequest, NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/cron-auth';
import { brandBillingConfig } from '@/lib/danal/config';
import { billingControl,runBrandRenewals } from '@/lib/danal/brand-billing';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
export async function GET(req:NextRequest) {
 if(!cronAuthorized(req))return NextResponse.json({error:'unauthorized'},{status:401});
 if(!brandBillingConfig().ok)return NextResponse.json({ok:true,skipped:'not_configured'});
 try{const c=await billingControl();if(!c.enabled||!c.renewals_enabled)return NextResponse.json({ok:true,skipped:'disabled'});
 return NextResponse.json({ok:true,...await runBrandRenewals()});}catch{return NextResponse.json({ok:false,error:'billing_review_required'},{status:503});}
}
