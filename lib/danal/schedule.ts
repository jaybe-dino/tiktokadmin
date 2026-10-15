export function kstDate(now = new Date()) { return new Date(now.getTime()+9*3600000).toISOString().slice(0,10); }
/** Advance from the original anchor, never from a clamped February date or delayed execution date. */
export function nextBillingDate(first:string, current:string):string {
 const [fy,fm,fd]=first.split('-').map(Number);
 const [cy,cm]=current.split('-').map(Number);
 if(![fy,fm,fd,cy,cm].every(Number.isInteger))throw new Error('INVALID_DATE');
 const offset=(cy-fy)*12+cm-fm+1;
 const month=new Date(Date.UTC(fy,fm-1+offset,1));
 const y=month.getUTCFullYear(),m=month.getUTCMonth();
 const d=Math.min(fd,new Date(Date.UTC(y,m+1,0)).getUTCDate());
 return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
