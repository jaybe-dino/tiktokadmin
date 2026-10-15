import { beforeEach, describe, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({query:vi.fn(),queryOne:vi.fn(),tx:vi.fn(),client:{query:vi.fn()}}));
vi.mock('../lib/db',()=>db);
import { hashContractToken, issueContractLink, publicRecurringContract, registerRecurringContract, revokeContractLink } from '../lib/recurring-contracts';
import { recurringContractInput, recurringTotal, DANAL_RECURRING_READY } from '../lib/recurring-contract-policy';
const input={brand_id:'12345678-1234-4234-8234-123456789012',kind:'marketing_retainer',title:'운영대행',details:'계약 상세',start_date:'2026-10-15',end_date:'2027-10-14',first_billing_date:'2026-10-31',monthly_amount:3000000,vat_mode:'excluded',fee_details:'매출 10% 별도 정산',cancellation_terms:'해지 30일 전 통보'};
function form(bytes='%PDF-1.7\n test'){const f=new FormData();Object.entries(input).forEach(([k,v])=>f.set(k,String(v)));f.set('contract_file',new File([bytes],'contract.pdf',{type:'application/pdf'}));return f;}
beforeEach(()=>{vi.clearAllMocks();db.tx.mockImplementation(fn=>fn(db.client));});
describe('계약 조건과 금액',()=>{
 it('잘못된 날짜·기간·최초 결제일을 거절한다',()=>{for(const patch of [{end_date:'2026-10-14'},{start_date:'2026-02-30'},{first_billing_date:'2027-10-15'}])expect(recurringContractInput.safeParse({...input,...patch}).success).toBe(false);});
 it('소수·음수·비정상 금액은 거절한다',()=>{for(const monthly_amount of [-1,0,1.1,NaN,Infinity,1000000001])expect(recurringContractInput.safeParse({...input,monthly_amount}).success).toBe(false);});
 it('부가세를 한 번 적용하며 별도 수수료를 합산하지 않는다',()=>{expect(recurringTotal(3000000,'included')).toBe(3000000);expect(recurringTotal(3000000,'excluded')).toBe(3300000);});
 it('다날 검증 전 자동청구는 비활성이다',()=>expect(DANAL_RECURRING_READY).toBe(false));
});
describe('파일·원자적 등록',()=>{
 it('MIME을 위조한 파일을 DB 쓰기 전 거절한다',async()=>{await expect(registerRecurringContract(form('<html>bad</html>'),'tester')).rejects.toThrow('PDF');expect(db.tx).not.toHaveBeenCalled();});
 it('2MB 초과·누락 파일을 거절한다',async()=>{const f=form();f.set('contract_file',new File([new Uint8Array(2097153)],'a.pdf'));await expect(registerRecurringContract(f,'tester')).rejects.toThrow('2MB');f.delete('contract_file');await expect(registerRecurringContract(f,'tester')).rejects.toThrow('첨부');expect(db.tx).not.toHaveBeenCalled();});
 it('브랜드가 없으면 계약을 생성하지 않는다',async()=>{db.client.query.mockResolvedValueOnce({rowCount:0,rows:[]});await expect(registerRecurringContract(form(),'tester')).rejects.toThrow('브랜드');expect(db.client.query).toHaveBeenCalledTimes(1);});
 it('계약·파일은 같은 트랜잭션으로 저장하며 링크/결제/서명을 자동 생성하지 않는다',async()=>{db.client.query.mockResolvedValueOnce({rowCount:1}).mockResolvedValueOnce({rows:[{id:'contract'}]}).mockResolvedValueOnce({rows:[{id:'recurring'}]});expect(await registerRecurringContract(form(),'tester')).toBe('recurring');expect(db.tx).toHaveBeenCalledTimes(1);const args=db.client.query.mock.calls;expect(args[1][0]).not.toMatch(/signed|paid/);expect(args[2][0]).not.toContain('token_hash');expect(args[2][1][10]).toBeInstanceOf(Buffer);expect(args[2][1][11]).toMatch(/^[a-f0-9]{64}$/);});
});
describe('외부 계약 링크',()=>{
 it('충분한 무작위 토큰을 발급하고 DB에는 해시만 저장한다',async()=>{db.queryOne.mockResolvedValue({id:'x'});const a=await issueContractLink('x');const b=await issueContractLink('x');expect(a).not.toBe(b);const t=a.split('/').pop()!;expect(t).toMatch(/^[a-f0-9]{64}$/);expect(db.queryOne.mock.calls[0][1]).toEqual(['x',hashContractToken(t)]);expect(db.queryOne.mock.calls[0][0]).toContain("interval '30 days'");});
 it('만료·해지된 계약에 링크를 발급하지 않는다',async()=>{db.queryOne.mockResolvedValue(null);await expect(issueContractLink('x')).rejects.toThrow('만료');expect(db.queryOne.mock.calls[0][0]).toContain("c.end_date >= current_date");});
 it('잘못된 토큰은 DB에 조회하지 않는다',async()=>{expect(await publicRecurringContract('bad')).toBeNull();expect(db.queryOne).not.toHaveBeenCalled();});
 it('유효한 토큰도 만료·차단·계약종료 조건을 함께 검증한다',async()=>{db.queryOne.mockResolvedValue(null);expect(await publicRecurringContract('a'.repeat(64))).toBeNull();const sql=db.queryOne.mock.calls[0][0];for(const check of ['r.link_expires_at>now()','r.link_revoked_at IS NULL',"c.status NOT IN ('terminated','expired')",'c.end_date>=current_date'])expect(sql).toContain(check);expect(sql).not.toMatch(/b\.email|b\.phone|file_bytes/);});
 it('차단하면 토큰을 제거한다',async()=>{await revokeContractLink('x');expect(db.query.mock.calls[0][0]).toContain('token_hash=NULL');});
});
