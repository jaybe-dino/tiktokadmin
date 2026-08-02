import ScreenHeader from "@/components/ScreenHeader";

export const dynamic = "force-dynamic";

// 정적 온보딩 가이드 — 문서 19(STAFF-GUIDE) 취지. DB 조회 없음.

const SECTORS: { sector: string; ai: string; human: string; screen: string }[] = [
  { sector: "영업 인텔리전스", ai: "사전분석 브리프 · 등급/트랙 추천", human: "담당 수락 · 미팅에서 검증", screen: "홈 · 브랜드 360" },
  { sector: "미팅", ai: "예약 인지 · 전사 · 회의록 · 팔로업 초안", human: "미팅 진행 · 초안 수정·승인", screen: "미팅 캘린더 · 360" },
  { sector: "커뮤니케이션", ai: "답장 초안 · QnA 매칭 · 캠페인 초안", human: "새 질문 답변 작성 · 승인 발송", screen: "메일함 · QnA · 캠페인" },
  { sector: "인증·규제", ai: "국가별 요건 체크리스트 · 서류 목록·번역 초안", human: "검토·제출 · 확정 판단(전문기관 확인)", screen: "제품·인증·재고" },
  { sector: "콘텐츠", ai: "Remake Studio — 성과 콘텐츠 해체·재생산", human: "편집·발행 판단", screen: "운영 사이클" },
  { sector: "운영 감시", ai: "에이전트 5종 순찰 — SLA·연체·미제출 지적+초안", human: "알림 조치 · 리마인더 승인", screen: "워크큐 · SLA 모니터" },
  { sector: "경영 인사이트", ai: "주간 자가학습 — 병목·전환 분석·개선안", human: "개선안 승인·반려", screen: "AI 인사이트" },
];

const ROLES: { role: string; center: string; screen: string; sla: string }[] = [
  { role: "유입 담당", center: "신규 리드 수락 → 첫 컨택 → 미팅 예약 유도", screen: "홈 · 워크큐 · 리드 가져오기", sla: "리드 방치 7일 금지 · 배정 당일 수락" },
  { role: "영업 담당", center: "미팅 → 회의록·팔로업 승인 → 제안·계약 → 결제 안내", screen: "미팅 캘린더 · 제안서 · 계약·결제", sla: "미팅 체류 7일 · 미팅 후 24h 내 팔로업 승인" },
  { role: "마케팅", center: "프로젝트 제안(RFP) · 캠페인·윈백 · 콘텐츠", screen: "마케팅 프로젝트 · 캠페인·윈백", sla: "RFP 마감 준수 · 캠페인 승인 후 발송" },
  { role: "온보딩 담당", center: "서류 수급 · 인증 서류 · 초기 재고 · 셋업", screen: "서류·물류 · 제품·인증·재고", sla: "서류 체류 10일 · 리마인더 당일 승인" },
  { role: "운영 담당", center: "사이클·시딩·라이브·CS · 연체 대응 · 정산 초안", screen: "운영 사이클 · 정산", sla: "접촉 공백 7일 금지 · CS 기한 준수" },
  { role: "파트장", center: "결재함 · T2 에스컬레이션 · 배정 조정 · QnA 승인", screen: "결재함 · SLA 모니터 · 설정·조직", sla: "결재 48h 내 · T2 당일 개입" },
  { role: "대표(exec)", center: "T3 적색 목록 · 주간 리포트 · 정책(SLA·게이트) 승인", screen: "AI 인사이트 · 모니터", sla: "정책 변경은 대표 결재만" },
];

export default function GuidePage() {
  return (
    <div>
      <ScreenHeader
        title="사용 가이드 — AI 적용 섹터 · 담당자 사용 체계"
        desc="새 직원 온보딩 교육 자료 — 상세판은 문서 19(STAFF-GUIDE)"
      />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-hd">
          <b>① AI 적용 섹터 맵 — 어디서 AI가 일하고, 사람은 무엇을 하나</b>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>섹터</th>
              <th>AI가 하는 일</th>
              <th>사람(담당자)이 하는 일</th>
              <th>주 화면</th>
            </tr>
          </thead>
          <tbody>
            {SECTORS.map((s) => (
              <tr key={s.sector}>
                <td><b>{s.sector}</b></td>
                <td>{s.ai}</td>
                <td>{s.human}</td>
                <td>{s.screen}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ padding: "8px 16px" }}>
          공통 원칙: AI는 <b>요약·초안·제안까지</b> — 등급·게이트·정산 판정은 규칙 엔진, 발송·상태변경 실행은 항상 사람의 승인 버튼
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-hd">
          <b>② 역할별 사용 체계 — 아침 공통 루틴 후 각자의 동선</b>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>역할</th>
              <th>하루의 중심</th>
              <th>주 화면</th>
              <th>핵심 책무 (SLA)</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((r) => (
              <tr key={r.role}>
                <td><b>{r.role}</b></td>
                <td>{r.center}</td>
                <td>{r.screen}</td>
                <td>{r.sla}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-hd"><b>③ 아침 10분 공통 루틴</b></div>
          <div className="card-bd" style={{ fontSize: "12.5px", lineHeight: 1.8 }}>
            1&#65039;&#8419; <b>오늘(홈)</b> — &ldquo;승인 대기 — AI가 준비해둔 것&rdquo;부터 처리 (밤사이 AI가 만든 초안 승인/수정)<br />
            2&#65039;&#8419; <b>워크큐</b> — T1 이상 알림 조치 (스누즈는 반드시 기한 지정)<br />
            3&#65039;&#8419; <b>오늘 미팅</b> — 브리프 DM 확인 후 상담 준비<br />
            <span style={{ color: "var(--ink3)" }}>이 3가지만 매일 지키면 시스템이 나머지를 감시합니다 — 방치하면 사다리가 파트장·대표까지 올라갑니다</span>
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><b>④ 철칙 3 + 계정 규칙</b></div>
          <div className="card-bd" style={{ fontSize: "12.5px", lineHeight: 1.8 }}>
            <b>철칙</b> — ① 시스템 밖에서 일하지 않는다(통화·미팅·약속은 반드시 카드에 기록) ② AI 초안은 반드시 읽고 승인한다(오발송 책임은 승인자) ③ 게이트가 막으면 우회하지 말고 부족 항목을 채운다<br />
            <b>계정</b> — 연동 4종(Slack·Zoom·Gmail·예약링크) 완성해야 자동화에 포함 · 휴가 시 부재 설정+위임 필수 · 민감 조회는 감사 로그에 기록됨
          </div>
        </div>
      </div>
    </div>
  );
}
