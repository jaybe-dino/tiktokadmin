import Link from 'next/link';
import type {CSSProperties} from 'react';
import s from '@/app/billing.module.css';
import c from './calendar.module.css';
import {query} from '@/lib/db';
import {agreementHash,billingControl} from '@/lib/danal/brand-billing';
import {renewalBillingConfig} from '@/lib/danal/config';
import {kstDate} from '@/lib/danal/schedule';
import {billingMonthBounds,shiftBillingMonth,buildBillingRange,validBillingDate,type CalendarContract,type CalendarAttempt} from '@/lib/danal/billing-calendar';
export const dynamic='force-dynamic';
const money=(v:number)=>v.toLocaleString('ko-KR')+'원';
const groups=[{id:'all',name:'전체',color:'#64748b',bg:'#f0f3f7'},{id:'paid',name:'결제 완료',color:'#087447',bg:'#edf8f1'},{id:'scheduled',name:'결제 예정',color:'#2458c5',bg:'#edf3ff'},{id:'pending',name:'등록·처리 대기',color:'#7350ad',bg:'#f5f0fc'},{id:'attention',name:'확인 필요',color:'#96600c',bg:'#fff6e5'},{id:'history',name:'임시 인증·이력',color:'#64748b',bg:'#f0f3f7'}];
const styleFor=(group:string)=>{const g=groups.find(g=>g.id===group)||groups[0];return {'--event-color':g.color,'--event-bg':g.bg} as CSSProperties;};
const friendly=(text:string)=>({'BILLING_KEY_ALREADY_REGISTERED':'승인은 확인됐습니다. 기존 카드와 중복되어 자동결제 연결 확인이 필요합니다.','BILLING_KEY_STORAGE_FAILED':'승인은 확인됐습니다. 자동결제 카드 연결을 확인해 주세요.','LEDGER_OR_KEY_COLLISION':'기존 승인 결과와 카드 연결을 확인해 주세요. 다시 청구하지 마세요.','전체 결제 OFF':'신규 결제·카드 등록 중지','월 자동청구 OFF':'매월 자동청구 중지','예정':'결제 예정','승인 미확정 · 재청구 금지':'승인 확인 중 · 재청구 금지'}[text]||(/^[A-Z0-9_]+$/.test(text)?'처리 상태 확인이 필요합니다. 계약 화면에서 상세 내역을 확인해 주세요.':text));
export default async function Page({searchParams}:{searchParams:Promise<{month?:string;q?:string;state?:string;day?:string;from?:string;to?:string;view?:string}>}){
 const p=await searchParams,today=kstDate();let month=p.month||(validBillingDate(p.from||'')?p.from!.slice(0,7):today.slice(0,7));try{billingMonthBounds(month);}catch{month=today.slice(0,7);}
 const bounds=billingMonthBounds(month),explicitRange=!!(p.from||p.to),invalidRange=explicitRange&&(!validBillingDate(p.from||'')||!validBillingDate(p.to||'')||p.from! > p.to!);
 const from=explicitRange&&!invalidRange?p.from!:bounds.from,to=explicitRange&&!invalidRange?p.to!:bounds.to;
 const view=p.view==='table'?'table':'calendar',q=(p.q||'').trim().slice(0,100),state=['scheduled','paid','attention','pending','history'].includes(p.state||'')?p.state!:'all',day=p.day&&p.day>=from&&p.day<=to&&validBillingDate(p.day)?p.day:'';
 type Row=CalendarContract&{monthly_amount:string;details:string;fee_details:string;cancellation_terms:string;file_sha256:string;consent_snapshot_hash:string|null};
 let rows:Row[]=[],attempts:CalendarAttempt[]=[],control:{enabled:boolean;renewals_enabled:boolean}|null=null,failed=false;
 try{
  [rows,attempts,control]=await Promise.all([
   query<Row>(`SELECT r.*,b.brand_name,c.start_date,c.end_date,c.status,s.id AS subscription_id,s.status AS billing_status,s.next_billing_date,s.is_operator_test,s.consent_snapshot_hash,(s.billing_key_ciphertext IS NOT NULL) AS has_billing_key
    FROM recurring_contracts r JOIN brands b ON b.id=r.brand_id JOIN contracts c ON c.id=r.contract_id LEFT JOIN brand_billing_subscriptions s ON s.recurring_contract_id=r.id ORDER BY b.brand_name,r.title`),
   query<CalendarAttempt>(`SELECT a.id,s.recurring_contract_id,a.due_date,(coalesce(a.completed_at,a.created_at) AT TIME ZONE 'Asia/Seoul')::date AS event_date,a.kind,a.amount,a.status,a.provider_tid,a.provider_code,a.failure_code,a.completed_at
    FROM brand_billing_attempts a JOIN brand_billing_subscriptions s ON s.id=a.subscription_id
    WHERE a.due_date BETWEEN $1::date AND $2::date OR (coalesce(a.completed_at,a.created_at) AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date`,[from,to]),
   billingControl()
  ]);
 }catch{failed=true;}
 if(failed)return <main className={s.shell}><Link href="/contracts/recurring">← 정기결제 관리</Link><h1>결제 캘린더</h1><div className={`${s.notice} ${s.warn}`} role="alert"><strong>결제 내역을 불러오지 못했습니다.</strong><p>일정이 없다는 뜻은 아닙니다. 잠시 후 다시 확인해 주세요.</p><Link className={s.button} href="/contracts/recurring/calendar">다시 불러오기</Link></div></main>;
 const contracts=rows.map(r=>({...r,terms_match:!r.subscription_id||r.consent_snapshot_hash===agreementHash(r)}));
 const renewalsConfigured=renewalBillingConfig().ok;
 const result=buildBillingRange(contracts,attempts,from,to,{enabled:control?.enabled===true,renewals:control?.renewals_enabled===true&&renewalsConfigured,today});
 const scoped=result.entries.filter(e=>!q||(e.brand_name+' '+e.title).toLocaleLowerCase().includes(q.toLocaleLowerCase()));
 const matching=scoped.filter(e=>state==='all'||e.group===state),calendar=matching.filter(e=>e.day.slice(0,7)===month);
 const table=matching.filter(e=>!day||e.day===day),excluded=result.excluded.filter(e=>!q||(e.contract.brand_name+' '+e.contract.title).toLocaleLowerCase().includes(q.toLocaleLowerCase()));
 const url=(m=month,d='',v=view,filter=state,keepRange=true)=>'/contracts/recurring/calendar?'+new URLSearchParams({month:m,view:v,...(keepRange&&explicitRange&&!invalidRange?{from,to}:{}),...(q?{q}:{}),...(filter!=='all'?{state:filter}:{}),...(d?{day:d}:{})}).toString();
 const firstWeekday=new Date(bounds.from+'T00:00:00Z').getUTCDay(),days=Number(bounds.to.slice(-2)),slots=Math.ceil((firstWeekday+days)/7)*7;
 const attentionContracts=excluded.filter(e=>!['계약 종료','운영자 검증 · 자동갱신 제외','결제 중지'].includes(e.reason));
 const attentionCount=new Set([...scoped.filter(e=>e.group==='attention').map(e=>e.contract_id),...attentionContracts.map(e=>e.contract.id)]).size;
 const paid=scoped.filter(e=>e.group==='paid'),scheduled=scoped.filter(e=>e.group==='scheduled'),pending=scoped.filter(e=>e.group==='pending');
 const excludedShown=state==='attention'?attentionContracts:excluded;
 const badge=(group:string)=>`${s.badge} ${group==='paid'?s.good:group==='attention'?s.warn:group==='scheduled'?s.blue:''}`;
 const summary=[{name:'결제 완료 · 합계금액',value:money(paid.reduce((n,e)=>n+e.amount,0)),hint:`실제 승인 ${paid.length}건 · 부가세 포함`,filter:'paid',tone:c.paidValue},{name:'받을 예정 금액',value:money(scheduled.reduce((n,e)=>n+e.amount,0)),hint:`자동청구 대상 ${scheduled.length}건`,filter:'scheduled',tone:c.scheduledValue},{name:'카드 등록·처리 대기',value:pending.length+'건',hint:'아직 결제 완료가 아닙니다.',filter:'pending',tone:''},{name:'확인 필요한 계약',value:attentionCount+'건',hint:'승인 결과·청구 설정 확인',filter:'attention',tone:c.attentionValue}];
 const timeLabel=(value:string|null)=>value?value.replace('T',' ').replace(/(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/,''):'';
 return <main className={s.shell}>
 <Link className={s.muted} href="/contracts/recurring">← 정기결제 관리로 돌아가기</Link>
 <header className={s.header}><div><h1>결제 캘린더</h1><p className={s.muted}>언제 얼마를 받는지, 결제가 끝났는지 한눈에 확인하세요.</p></div><Link className={s.button} href="/contracts/recurring">계약 만들기·관리 →</Link></header>
 {!control?.enabled||!control.renewals_enabled||!renewalsConfigured?<div className={`${s.notice} ${s.warn}`}><strong>{!control?.enabled?'현재 고객 카드 등록과 매월 자동청구가 중지되어 있습니다.':!control.renewals_enabled?'매월 자동청구가 중지되어 있습니다.':'자동청구 연결 확인이 필요합니다.'}</strong><p>예정일이 있어도 자동으로 청구되지 않습니다. 중지된 일정은 받을 예정 금액에 포함하지 않습니다.</p><Link className={c.noticeLink} href="/contracts/recurring">결제 설정 확인하기 →</Link></div>:<p className={`${s.badge} ${s.good}`}>매월 자동청구 사용 중</p>}
 <section className={s.panel} aria-label="조회 조건"><h2>어느 기간을 볼까요?</h2><form method="GET" className={c.filterGrid}><input type="hidden" name="view" value={view}/>{state!=='all'&&<input type="hidden" name="state" value={state}/>}
 <label>시작일<input type="date" name="from" defaultValue={from} required/></label><label>종료일<input type="date" name="to" defaultValue={to} required/></label><label className={c.searchLabel}>브랜드·계약 검색<input name="q" defaultValue={q} placeholder="전체 또는 브랜드·계약명" maxLength={100}/></label><button className={`${s.button} ${s.primary}`} type="submit">조회하기</button></form>
 <div className={c.quickDates}><Link href={url(today.slice(0,7),'',view,state,false)}>이번 달</Link><Link href={url(shiftBillingMonth(today.slice(0,7),-1),'',view,state,false)}>지난달</Link><Link href={url(shiftBillingMonth(today.slice(0,7),1),'',view,state,false)}>다음 달</Link><Link href={'/contracts/recurring/calendar?view='+view}>조건 초기화</Link></div>
 {invalidRange&&<p role="alert" className={s.errorText}>기간을 확인해 주세요. 종료일은 시작일 이후로 입력해야 합니다. 현재 선택 월을 표시하고 있습니다.</p>}
 </section>
 <div className={s.titleLine}><h2>기간 요약 <span className={c.countLabel}>{from} ~ {to}</span></h2></div>
 <div className={s.stats}>{summary.map(item=><Link className={`${s.stat} ${c.summaryLink}`} key={item.name} href={url(month,'',view,item.filter)+(item.filter==='attention'?'#attention-contracts':'#schedule-table')}><span className={s.muted}>{item.name}</span><strong className={item.tone}>{item.value}</strong><small>{item.hint}</small></Link>)}</div>
 <p className={s.help}>금액은 선택 기간·브랜드 검색 기준이며, 확인 필요한 계약은 현재 상태 기준입니다. 상태·날짜 선택은 목록만 바꿉니다. 임시 100원 인증은 결제완료 금액에서 제외합니다.</p>
 <div className={c.toolbar}><div className={c.viewSwitch} aria-label="보기 방식"><Link className={`${s.button} ${view==='calendar'?c.selected:''}`} aria-current={view==='calendar'?'page':undefined} href={url(month,day,'calendar')}>달력으로 보기</Link><Link className={`${s.button} ${view==='table'?c.selected:''}`} aria-current={view==='table'?'page':undefined} href={url(month,day,'table')}>표·목록으로 보기</Link></div><span className={c.periodHint}>한국 시간 기준 · 금액은 부가세 포함</span></div>
 <nav className={c.tabs} aria-label="상태별 보기">{groups.map(g=><Link key={g.id} href={url(month,day,view,g.id)} className={`${c.tab} ${state===g.id?c.tabSelected:''}`} aria-current={state===g.id?'page':undefined}><span className={c.dot} style={styleFor(g.id)}/>{g.name}<small>{g.id==='all'?scoped.length:g.id==='attention'?attentionCount:scoped.filter(e=>e.group===g.id).length}</small></Link>)}</nav>
 {view==='calendar'&&<section className={`${s.panel} ${c.calendarPanel}`}><div className={c.monthBar}><Link className={s.button} href={url(shiftBillingMonth(month,-1),'',view,state,false)}>← 이전 달</Link><h2>{month.slice(0,4)}년 {Number(month.slice(5))}월</h2><Link className={s.button} href={url(shiftBillingMonth(month,1),'',view,state,false)}>다음 달 →</Link></div>
 <p className={s.help}>날짜를 누르면 아래에서 그날의 상세 내역을 볼 수 있습니다.</p>
 {(from!==bounds.from||to!==bounds.to)&&<div className={s.notice}>위 합계는 {from} ~ {to} 기준이며, 달력은 {Number(month.slice(5))}월만 표시합니다. <Link href={url(month,'','table')+'#schedule-table'}>기간 전체 목록 보기 →</Link></div>}
 <div className={c.calendarGrid} role="group" aria-label={`${month} 결제 일정`}>
 {['일','월','화','수','목','금','토'].map((w,i)=><div key={w} className={`${c.weekday} ${i===0?c.sunday:''}`}>{w}</div>)}
 {Array.from({length:slots},(_,i)=>{const d=i-firstWeekday+1;if(d<1||d>days)return <div aria-hidden="true" key={i} className={`${c.day} ${c.outside}`}/>;const date=month+'-'+String(d).padStart(2,'0'),events=calendar.filter(e=>e.day===date),href=url(month,date,'calendar')+'#schedule-table';return <div key={i} className={`${c.day} ${date===today?c.today:''} ${date===day?c.selectedDay:''}`}><Link className={c.dateLink} href={href} aria-label={`${Number(month.slice(5))}월 ${d}일${date===today?' 오늘':''}, 일정 ${events.length}건 보기`} aria-current={date===day?'date':undefined}><span className={c.dateNumber}>{d}</span><span className={c.dayCount}>{events.length?events.length+'건':date===today?'오늘':''}</span></Link>
 {events.slice(0,3).map(e=><Link href={href} className={c.event} style={styleFor(e.group)} key={e.id} title={`${e.brand_name} · ${money(e.amount)} · ${friendly(e.label)}`}><strong>{e.brand_name}</strong><span>{money(e.amount)} · {friendly(e.label)}</span></Link>)}
 {events.length>3&&<Link href={href} className={c.more}>+ {events.length-3}건 더 보기</Link>}
 <div className={c.mobileDots} aria-hidden="true">{Array.from(new Set(events.map(e=>e.group))).map(g=><span className={c.dot} style={styleFor(g)} key={g}/>)}</div></div>;})}
 </div><div className={c.legend}>{groups.slice(1).map(g=><span key={g.id}><i className={c.dot} style={styleFor(g.id)}/>{g.name}</span>)}</div>
 {!calendar.length&&<p className={c.emptyCalendar}>이 달에는 현재 조건에 맞는 일정이 없습니다.{excluded.length>0&&<> 아래에서 자동청구 제외 계약도 확인해 주세요.</>}</p>}
 </section>}
 <section id="schedule-table" className={c.sectionAnchor}><div className={s.titleLine}><div><h2>{day?`${Number(day.slice(5,7))}월 ${Number(day.slice(8))}일 상세 내역`:'기간 상세 내역'} <span className={c.countLabel}>{table.length}건</span></h2><p className={s.muted}>{day?day:from+' ~ '+to}{state!=='all'?' · '+groups.find(g=>g.id===state)?.name:''}</p></div>{day&&<Link className={s.button} href={url(month,'',view)+'#schedule-table'}>전체 기간 보기</Link>}</div>
 <div className={`${s.tablewrap} ${c.desktopList}`}><table className={s.table}><thead><tr><th>날짜</th><th>브랜드·계약</th><th>금액</th><th>결과·다음 행동</th><th>거래 확인</th></tr></thead><tbody>{table.map(e=><tr key={e.id}><td>{e.day}<small>{e.source==='projection'?'청구 예정일':e.completed_at?'처리 완료일':'요청일'}</small>{e.day!==e.due_date&&<small>청구 예정일 {e.due_date}</small>}</td><td className={c.tableName}><Link href={'/contracts/recurring?brand='+e.brand_id}><strong>{e.brand_name}</strong></Link><small>{e.title}</small></td><td><strong>{money(e.amount)}</strong><small>{e.type}</small></td><td className={c.statusCell}><span className={badge(e.group)}>{friendly(e.label)}</span><small>{friendly(e.detail)||'—'}</small></td><td>{e.tid?<div className={s.reference}>{e.tid}</div>:<span className={s.muted}>{e.source==='projection'?'승인 전':'—'}</span>}{e.provider_code&&<small>다날 응답 {e.provider_code}{e.provider_code==='0000'?' · 정상 처리':''}</small>}{e.completed_at&&<small>{timeLabel(e.completed_at)} KST</small>}<small>{e.source==='projection'?'현재 계약 기준의 예정 일정':'실제 처리 내역'}</small></td></tr>)}{!table.length&&<tr><td colSpan={5} className={s.empty}>조건에 맞는 내역이 없습니다.{attentionContracts.length>0&&<p><Link href="#attention-contracts">확인이 필요한 계약 {attentionContracts.length}건 보기 ↓</Link></p>}</td></tr>}</tbody></table></div>
 <div className={c.mobileList}>{table.map(e=><article className={c.mobileItem} key={e.id}><div className={c.itemTop}><span className={badge(e.group)}>{friendly(e.label)}</span><span className={c.itemDate}>{e.day}</span></div><h3>{e.brand_name}</h3><p className={s.muted}>{e.title}</p><p className={c.itemAmount}>{money(e.amount)}</p><p className={c.listMeta}>{e.type} · {e.source==='projection'?'청구 예정':'실제 내역'}{e.day!==e.due_date?` · 청구일 ${e.due_date}`:''}</p>{e.detail&&<p className={s.help}>{friendly(e.detail)}</p>}{e.tid&&<details className={c.referenceDetails}><summary>거래번호·처리 정보 보기</summary><p>{e.tid}</p>{e.provider_code&&<p>다날 응답 {e.provider_code}{e.provider_code==='0000'?' · 정상 처리':''}</p>}<p>{timeLabel(e.completed_at)} KST</p></details>}<Link className={c.jump} href={'/contracts/recurring?brand='+e.brand_id}>이 계약 확인하기 →</Link></article>)}{!table.length&&<div className={`${s.panel} ${s.empty}`}>조건에 맞는 내역이 없습니다.</div>}</div>
 </section>
 <details id="attention-contracts" className={`${s.panel} ${s.details} ${c.sectionAnchor}`} open={state==='attention'||!table.length&&excludedShown.length>0}><summary><span>{state==='attention'?'확인이 필요한 계약':'자동청구에서 제외·보류된 계약'} <span className={c.countLabel}>{excludedShown.length}건</span></span></summary><p className={s.muted}>아래 계약은 받을 예정 금액에 포함하지 않습니다. 이미 승인된 결제는 위 결제완료 내역에 그대로 표시됩니다.</p>
 <div className={c.excludedCards}>{excludedShown.map(({contract:r,reason})=><article key={r.id} className={c.excludedCard}><span className={`${s.badge} ${reason==='담당자 확인 필요'?s.warn:''}`}>{reason}</span><strong style={{marginTop:10}}>{r.brand_name} · {r.title}</strong><p className={s.help}>계약 기간 {r.start_date} ~ {r.end_date}<br/>등록된 다음 청구일 {r.next_billing_date||'없음'} · 참고용</p><Link href={'/contracts/recurring?brand='+r.brand_id}>계약 확인하기 →</Link></article>)}</div>{!excludedShown.length&&<p className={s.empty}>현재 해당하는 계약이 없습니다.</p>}</details>
 <details className={`${s.panel} ${s.details}`}><summary>금액과 날짜는 어떻게 계산하나요?</summary><p className={s.help}>결제완료 금액은 실제 승인된 금액의 합계이며 부가세를 포함합니다. 회계상 매출 인식이나 환불 차감 금액과는 다를 수 있습니다. 임시 100원 인증과 기타 수수료는 포함하지 않습니다.</p><p className={s.help}>예정 금액은 현재 계약·다음 청구일·자동청구 설정으로 계산한 값입니다. 다날에 미리 예약된 거래를 뜻하지 않습니다. 이미 완료된 거래는 처리 완료일, 진행 중인 거래는 요청일에 표시하며 원래 청구일은 상세 내역에서 확인할 수 있습니다.</p><p className={s.help}>이전 달·다음 달 이동은 조회 기간도 해당 월 전체로 바꿉니다. 직접 고른 기간의 전체 내역은 「표·목록으로 보기」에서 확인하세요.</p></details>
 </main>;
}
