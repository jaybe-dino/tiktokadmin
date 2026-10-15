import { createHash, randomBytes } from "node:crypto";
import { query, queryOne, tx } from "./db";
import { recurringContractInput } from "./recurring-contract-policy";
export const hashContractToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function registerRecurringContract(form: FormData, userId: string) {
  const v = recurringContractInput.parse(Object.fromEntries(form.entries()));
  const file = form.get("contract_file");
  if (!(file instanceof File) || file.size > 2 * 1024 * 1024 || file.size < 5)
    throw new Error("계약서 PDF(최대 2MB)를 첨부하세요.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF 계약서만 업로드할 수 있습니다.");
  const filename = file.name.replace(/[\r\n\x00-\x1f/\\]/g, "_").slice(0, 180) || "contract.pdf";
  return tx(async c => {
    const brand = await c.query("SELECT id FROM brands WHERE id=$1", [v.brand_id]);
    if (!brand.rowCount) throw new Error("브랜드를 찾을 수 없습니다.");
    const contract = await c.query<{id:string}>(
      `INSERT INTO contracts(brand_id,kind,start_date,end_date,terms,note)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [v.brand_id,v.kind,v.start_date,v.end_date,JSON.stringify({monthly_amount:v.monthly_amount,currency:"KRW",vat_mode:v.vat_mode,fee_details:v.fee_details}),v.details]);
    const result = await c.query<{id:string}>(
      `INSERT INTO recurring_contracts(contract_id,brand_id,title,details,monthly_amount,vat_mode,first_billing_date,fee_details,cancellation_terms,file_name,file_bytes,file_sha256,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [contract.rows[0].id,v.brand_id,v.title,v.details,v.monthly_amount,v.vat_mode,v.first_billing_date,v.fee_details,v.cancellation_terms,filename,bytes,createHash("sha256").update(bytes).digest("hex"),userId]);
    return result.rows[0].id;
  });
}
export async function issueContractLink(id: string) {
  const token = randomBytes(32).toString("hex");
  const row = await queryOne<{id:string}>(
    `UPDATE recurring_contracts r SET token_hash=$2,link_expires_at=now()+interval '30 days',link_revoked_at=NULL
     FROM contracts c WHERE r.id=$1 AND c.id=r.contract_id AND c.status NOT IN ('terminated','expired') AND c.end_date >= current_date RETURNING r.id`,
    [id,hashContractToken(token)]);
  if (!row) throw new Error("만료·해지된 계약에는 링크를 발급할 수 없습니다.");
  return `/billing-contract/${token}`;
}
export async function revokeContractLink(id: string) {
  await query("UPDATE recurring_contracts SET token_hash=NULL,link_revoked_at=now() WHERE id=$1",[id]);
}
export async function publicRecurringContract(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return queryOne<{id:string;brand_name:string;title:string;details:string;monthly_amount:string;vat_mode:string;first_billing_date:string;fee_details:string;cancellation_terms:string;file_name:string;start_date:string;end_date:string}>(
    `SELECT r.id,b.brand_name,r.title,r.details,r.monthly_amount,r.vat_mode,r.first_billing_date,r.fee_details,r.cancellation_terms,r.file_name,c.start_date,c.end_date
     FROM recurring_contracts r JOIN brands b ON b.id=r.brand_id JOIN contracts c ON c.id=r.contract_id
     WHERE r.token_hash=$1 AND r.link_expires_at>now() AND r.link_revoked_at IS NULL
       AND c.status NOT IN ('terminated','expired') AND c.end_date>=current_date`,[hashContractToken(token)]);
}
