import { notFound } from 'next/navigation';
import { billingResult } from '@/lib/danal/brand-billing';
export const dynamic='force-dynamic';export const metadata={title:'GloveK 카드 등록 결과',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{state:string}>}) {
 const {state}=await params;const r=await billingResult(state);if(!r)notFound();
 const labels:Record<string,string>={paid:'첫 월 이용료 결제와 카드 등록이 확인되었습니다.',registered:'카드 등록이 확인되었습니다. 임시 100원 승인 취소 여부는 카드사 내역에서 확인해 주세요.',unknown:'승인 결과 확인이 필요합니다. 재결제하지 말고 담당자에게 문의해 주세요.',approving:'승인 결과를 확인 중입니다. 재결제하지 말고 담당자에게 문의해 주세요.',failed:'카드 등록 또는 승인이 완료되지 않았습니다. 담당자에게 문의해 주세요.',expired:'카드 등록창의 유효시간이 지났습니다.',blocked:'카드 등록 처리가 중지되었습니다.'};
 return <main style={{maxWidth:640,margin:'60px auto',padding:24}}><h1>카드 등록 결과</h1><p>{labels[r.status]||'카드 등록이 아직 완료되지 않았습니다.'}</p>{r.status==='paid'&&<p>확인된 결제금액: {Number(r.amount).toLocaleString('ko-KR')}원</p>}<p>이 화면은 계약서 전자서명을 대신하지 않습니다.</p></main>;
}
