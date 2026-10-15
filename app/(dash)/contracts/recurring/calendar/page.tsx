import Link from 'next/link';
import {query} from '@/lib/db';
import {agreementHash,billingControl} from '@/lib/danal/brand-billing';
import {renewalBillingConfig} from '@/lib/danal/config';
import {kstDate} from '@/lib/danal/schedule';
import {billingMonthBounds,shiftBillingMonth,buildBillingRange,validBillingDate,type CalendarContract,type CalendarAttempt} from '@/lib/danal/billing-calendar';
export const dynamic='force-dynamic';
const money=(v:number)=>v.toLocaleString('ko-KR')+'원';
const colors:Record<string,string>={scheduled:'#1d4ed8',paid:'#047857',attention:'#b45309',pending:'#6d28d9',history:'#64748b'};
export default async function Page({searchParams}:{searchParams:Promise<{month?:string;q?:string;state?:string;day?:string;from?:string;to?:string;view?:string}>}){
 const p=await searchParams,today=kstDate();let month=p.month||today.slice(0,7);try{billingMonthBounds(month);}catch{month=today.slice(0,7);}
 const bounds=billingMonthBounds(month),explicitRange=!!(p.from||p.to),invalidRange=explicitRange&&(!validBillingDate(p.from||'')||!validBillingDate(p.to||'')||p.from! > p.to!);
 const from=explicitRange&&!invalidRange?p.from!:bounds.from,to=explicitRange&&!invalidRange?p.to!:bounds.to;
 const view=p.view==='table'?'table':'calendar',q=(p.q||'').trim().slice(0,100),state=['scheduled','paid','attention','pending','history'].includes(p.state||'')?p.state!:'all',day=p.day&&p.day>=from&&p.day<=to&&validBillingDate(p.day)?p.day:'';
 type Row=CalendarContract&{monthly_amount:string;details:string;fee_details:string;cancellation_terms:string;file_sha256:string;consent_snapshot_hash:string|null};
 let rows:Row[]=[],attempts:CalendarAttempt[]=[],control:{enabled:boolean;renewals_enabled:boolean}|null=null,failed=false;
 try{
  [rows,attempts,control]=await Promise.all([
   query<Row>(`SELECT r.*,b.brand_name,c.start_date,c.end_date,c.status,s.id AS subscription_id,s.status AS billing_status,s.next_billing_date,s.is_operator_test,s.consent_snapshot_hash,(s.billing_key_ciphertext IS NOT NULL) AS has_billing_key
    FROM recurring_contracts r JOIN brands b ON b.id=r.brand_id JOIN contracts c ON c.id=r.contract_id LEFT JOIN brand_billing_subscriptions s ON s.recurring_contract_id=r.id ORDER BY b.brand_name,r.title`),
   query<CalendarAttempt>(`SELECT a.id,s.recurring_contract_id,a.due_date,(coalesce(a.completed_at,a.created_at) AT TIME ZONE 'Asia/Seoul')::date AS event_date,a.kind,a.amount,a.status,a.provider_tid,a.failure_code,a.completed_at
    FROM brand_billing_attempts a JOIN brand_billing_subscriptions s ON s.id=a.subscription_id
    WHERE a.due_date BETWEEN $1::date AND $2::date OR (coalesce(a.completed_at,a.created_at) AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date`,[from,to]),
   billingControl()
  ]);
 }catch{failed=true;}
 if(failed)return <main><Link href="/contracts/recurring">← 정기결제 관리</Link><h1>결제 캘린더</h1><p role="alert">결제 일정을 불러오지 못했습니다. 일정이 없는 것으로 처리하지 않습니다. 잠시 후 새로고침해 주세요.</p></main>;
 const contracts=rows.map(r=>({...r,terms_match:!r.subscription_id||r.consent_snapshot_hash===agreementHash(r)}));
 const result=buildBillingRange(contracts,attempts,from,to,{enabled:control?.enabled===true,renewals:control?.renewals_enabled===true&&renewalBillingConfig().ok,today});
 const scoped=result.entries.filter(e=>!q||(e.brand_name+' '+e.title).toLocaleLowerCase().includes(q.toLocaleLowerCase()));
 const matching=scoped.filter(e=>state==='all'||e.group===state),calendar=matching.filter(e=>e.day.slice(0,7)===month);
 const table=matching.filter(e=>!day||e.day===day),excluded=result.excluded.filter(e=>!q||(e.contract.brand_name+' '+e.contract.title).toLocaleLowerCase().includes(q.toLocaleLowerCase()));
 const url=(m=month,d='',v=view)=>'/contracts/recurring/calendar?'+new URLSearchParams({month:m,view:v,...(explicitRange&&!invalidRange?{from,to}:{}),...(q?{q}:{}),...(state!=='all'?{state}:{}),...(d?{day:d}:{})}).toString();
 const firstWeekday=new Date(bounds.from+'T00:00:00Z').getUTCDay(),days=Number(bounds.to.slice(-2)),slots=Math.ceil((firstWeekday+days)/7)*7;
 const summaries=[['기간 합계매출 · 결제완료',money(scoped.filter(e=>e.group==='paid').reduce((n,e)=>n+e.amount,0))],['기간 결제 예정액',money(scoped.filter(e=>e.group==='scheduled').reduce((n,e)=>n+e.amount,0))],['카드 등록·처리 대기',scoped.filter(e=>e.group==='pending').length+'건'],['확인 필요',scoped.filter(e=>e.group==='attention').length+'건']];
 return <main style={{maxWidth:1500}}><Link href="/contracts/recurring">← 브랜드 정기결제 관리</Link><h1 style={{fontSize:26,fontWeight:800,margin:"12px 0"}}>결제 캘린더·매출 현황</h1>
 <p>한국 시간 기준 · 카드 등록·결제 {control?.enabled?'ON':'OFF'} · 월 자동청구 {control?.renewals_enabled?'ON':'OFF'} · 매시간 청구일 대상 확인</p>
 <p style={{color:'var(--ink3)'}}>예정 일정은 현재 계약·다음 청구일로 계산한 값입니다. 중지·종료·확인 필요 계약은 자동청구 예정액에서 제외합니다. 카드 등록 전 일정은 청구 확정이 아닙니다. 기타 수수료는 포함하지 않습니다.</p>
 {invalidRange&&<p role="alert" style={{color:"#b45309"}}>기간을 확인해 주세요. 올바른 시작일·종료일을 입력해야 합니다. 현재 선택 월을 표시합니다.</p>}
 <form method="GET" style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end',margin:'20px 0'}}>
  <input type="hidden" name="view" value={view}/><label>달력 월<input className="f" type="month" name="month" defaultValue={month}/></label><label>시작일<input className="f" type="date" name="from" defaultValue={from} required/></label><label>종료일<input className="f" type="date" name="to" defaultValue={to} required/></label><label>브랜드·계약 검색<input className="f" name="q" defaultValue={q} placeholder="브랜드 또는 계약명"/></label>
  <label>표시 상태<select className="f" name="state" defaultValue={state}><option value="all">전체</option><option value="scheduled">예정</option><option value="paid">결제완료</option><option value="pending">카드 등록·처리 대기</option><option value="attention">확인 필요</option><option value="history">임시 인증·만료 이력</option></select></label><button className="btn pri" type="submit">조회</button><Link className="btn" href="/contracts/recurring/calendar">이번 달</Link>
 </form>
 <div style={{display:"flex",gap:8,marginBottom:16}}><Link className={view==="calendar"?"btn pri":"btn"} aria-current={view==="calendar"?"page":undefined} href={url(month,"","calendar")}>📅 달력 보기</Link><Link className={view==="table"?"btn pri":"btn"} aria-current={view==="table"?"page":undefined} href={url(month,"","table")}>☷ 표 보기</Link></div>
 <p style={{marginBottom:12}}>집계 기간: <strong>{from} ~ {to}</strong> · 합계매출은 결제완료 금액(VAT 포함) 기준이며, 브랜드·계약 검색을 반영합니다. 상태·날짜 선택은 목록만 필터합니다. 회계상 매출 인식·환불 차감은 별도입니다.</p>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginBottom:20}}>{summaries.map(([label,value])=><section className="card" style={{padding:18}} key={label}><div style={{color:'var(--ink3)'}}>{label}</div><strong style={{fontSize:26}}>{value}</strong></section>)}</div>
 {view==='calendar'&&<>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><Link className="btn" href={url(shiftBillingMonth(month,-1))}>← 이전 달</Link><h2 style={{margin:0}}>{month.replace('-','년 ')}월</h2><Link className="btn" href={url(shiftBillingMonth(month,1))}>다음 달 →</Link></div>
 <p style={{color:"var(--ink3)",marginBottom:10}}>달력은 선택 월을 표시하고, 집계·표는 위 기간 전체를 표시합니다.</p>
 <div style={{overflowX:'auto'}}><div role="grid" aria-label={`${month} 결제 캘린더`} style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(115px,1fr))',minWidth:840,border:'1px solid var(--line,#dbe2ea)',borderRadius:12,overflow:'hidden'}}>
 {['일','월','화','수','목','금','토'].map(w=><div role="columnheader" key={w} style={{padding:12,textAlign:'center',background:'#eef2f7',fontWeight:700,color:'#334155'}}>{w}</div>)}
 {Array.from({length:slots},(_,i)=>{const d=i-firstWeekday+1;if(d<1||d>days)return <div role="gridcell" key={i} style={{background:'#f8fafc',minHeight:115}}/>;const date=month+'-'+String(d).padStart(2,'0'),events=calendar.filter(e=>e.day===date);return <div role="gridcell" key={i} style={{padding:9,minHeight:115,borderTop:'1px solid #e2e8f0',borderRight:'1px solid #e2e8f0',background:day===date?'#eef2ff':date===today?'#f0fdf4':'white'}}><Link href={url(month,date,'table')+'#schedule-table'} style={{display:'block',fontWeight:700,marginBottom:7,color:date===today?'#047857':'#334155'}}>{d}{date===today?' · 오늘':''} <small style={{fontWeight:400}}>{events.length?events.length+'건':''}</small></Link>{events.map(e=><Link href={url(month,date,'table')+'#schedule-table'} key={e.id} style={{display:'block',fontSize:12,marginTop:5,padding:6,borderRadius:6,background:'#f8fafc',color:colors[e.group],textDecoration:'none'}}><strong>{e.brand_name}</strong><div>{money(e.amount)} · {e.label}</div></Link>)}</div>;})}
 </div></div>
 </>}
 <p style={{fontSize:12,color:'var(--ink3)'}}>파랑: 예정 · 초록: 결제완료 · 보라: 카드 등록·처리 대기 · 주황: 확인 필요 · 회색: 이력. 완료된 시도는 처리 완료일, 미완료 시도는 요청일에 표시합니다. 원래 청구일은 아래 표에서 확인합니다.</p>
 <section id="schedule-table" style={{scrollMarginTop:90}}><h2>{day?day+' 결제 일정':'기간 결제 일정·이력'} <small>({table.length}건)</small></h2>{day&&<Link href={url()+'#schedule-table'}>날짜 선택 해제 · 전체 기간 보기</Link>}<div style={{overflowX:'auto'}}><table className="t" style={{minWidth:1050}}><thead><tr><th>표시일 / 청구일</th><th>브랜드·계약</th><th>유형</th><th>금액(VAT 포함)</th><th>상태</th><th>처리 시각(KST) / 거래번호</th><th>안내</th></tr></thead><tbody>{table.map(e=><tr key={e.id}><td>{e.day}<br/><small>청구일 {e.due_date}</small></td><td><Link href={'/brand/'+e.brand_id}>{e.brand_name}</Link><br/>{e.title}</td><td>{e.type}<br/><small>{e.source==='projection'?'계산 일정':'실제 이력'}</small></td><td>{money(e.amount)}</td><td style={{color:colors[e.group],fontWeight:700}}>{e.label}</td><td>{e.completed_at?.replace(/\+09(?::00)?$/,'')||'—'}<br/>{e.tid||'—'}</td><td>{e.detail||'—'}</td></tr>)}{!table.length&&<tr><td colSpan={7}>조건에 맞는 일정·이력이 없습니다.</td></tr>}</tbody></table></div></section>
 <h2>청구 제외·일정 확인 대상 ({excluded.length}건)</h2><p>아래 날짜는 등록된 참고값이며 자동청구 일정이 아닙니다. 중지된 계약의 날짜를 새 청구로 생성하지 않습니다.</p><div style={{overflowX:'auto'}}><table className="t"><thead><tr><th>브랜드·계약</th><th>계약기간</th><th>등록된 다음 청구일(참고)</th><th>제외 사유</th><th>관리</th></tr></thead><tbody>{excluded.map(({contract:c,reason})=><tr key={c.id}><td>{c.brand_name} · {c.title}</td><td>{c.start_date} ~ {c.end_date}</td><td>{c.next_billing_date||'미등록'}</td><td>{reason}</td><td><Link href={'/contracts/recurring?brand='+c.brand_id}>계약 확인</Link></td></tr>)}{!excluded.length&&<tr><td colSpan={5}>현재 청구 제외 대상이 없습니다.</td></tr>}</tbody></table></div>
 </main>;
}
