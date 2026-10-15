import { NextResponse } from "next/server";
import { publicRecurringContract } from "@/lib/recurring-contracts";
import { queryOne } from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET(_req:Request,{params}:{params:Promise<{token:string}>}) {
 const {token}=await params;const c=await publicRecurringContract(token);
 if(!c)return new NextResponse("Not found",{status:404});
 const f=await queryOne<{file_bytes:Buffer;file_name:string}>("SELECT file_bytes,file_name FROM recurring_contracts WHERE id=$1",[c.id]);
 if(!f)return new NextResponse("Not found",{status:404});
 return new NextResponse(new Uint8Array(f.file_bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="contract.pdf"; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"}});
}
