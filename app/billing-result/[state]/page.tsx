import { notFound } from 'next/navigation';
import { billingResult } from '@/lib/danal/brand-billing';
export const dynamic='force-dynamic';export const metadata={title:'GloveK 카드 등록 결과',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{state:string}>}) {
 const {state}=await params;const r=await billingResult(state);if(!r)notFound();
 const labels:Record<string,string>={paid:'첫 월 이용료 결제 승인이 확인되었습니다.',registered:'카드 등록이 확인되었습니다. 임시 100원 승인 취소 여부는 카드사 내역에서 확인해 주세요.',unknown:'승인 결과 확인이 필요합니다. 재결제하지 말고 담당자에게 문의해 주세요.',approving:'승인 결과를 확인 중입니다. 재결제하지 말고 담당자에게 문의해 주세요.',failed:'카드 등록 또는 승인이 완료되지 않았습니다. 담당자에게 문의해 주세요.',expired:'카드 등록창의 유효시간이 지났습니다.',blocked:'카드 등록 처리가 중지되었습니다.'};
 return <main style={{maxWidth:640,margin:'60px auto',padding:24}}><h1>{r.is_operator_test?'운영자 결제 검증 결과':'카드 등록 결과'}</h1><p>{r.is_operator_test&&r.status==='paid'?'운영자 301원 1회 결제와 카드 등록이 확인되었습니다.':labels[r.status]||'카드 등록이 아직 완료되지 않았습니다.'}</p>{r.status==='paid'&&<p>확인된 결제금액: {Number(r.amount).toLocaleString('ko-KR')}원</p>}{r.provider_tid&&<p>거래번호: {r.provider_tid}</p>}{r.provider_code&&<p>다날 응답코드: {r.provider_code}</p>}{r.order_id&&<p>주문번호: {r.order_id}</p>}{['BILLING_KEY_ALREADY_REGISTERED','BILLING_KEY_STORAGE_FAILED'].includes(r.failure_code||'')&&<p role="alert">위 승인 결과는 확인되었습니다. 월 자동결제 카드 연결은 담당자 확인이 필요해 보류되었습니다. 추가 카드 등록이나 재결제를 진행하지 마세요.</p>}{r.is_operator_test&&<p>이 테스트 계약은 이후의 월별 자동갱신에서 영구 제외됩니다. 실제 다음 달 정기청구의 성공을 뜻하지 않습니다.</p>}<p>이 화면은 계약서 전자서명을 대신하지 않습니다.</p></main>;
}
