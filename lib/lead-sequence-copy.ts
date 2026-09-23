// 승인된 연속 안내 문안(1~4일차) — 대표 승인본. 세 유입 키에 같은 내용으로 쓴다.
//   · 줄바꿈·링크를 그대로 보존한다(편집 화면에서 「승인 문안 불러오기」로 채운 뒤 저장).
//   · 브랜드명이 없는 리드도 있으므로 인사에 치환변수를 넣지 않는다.
//   · 5일차(회사소개 단독 발송)는 이번 범위에서 제외 — 1~4일차만 둔다.
//   DB 의존 없음 — 편집 화면(클라이언트)에서도 그대로 쓴다.

export interface SeqCopy { day_no: number; email_subject: string; email_body: string; sms_body: string }

/** 상담 예약 링크 — 모든 회차 공통. */
export const CONSULT_URL = "https://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2";

export const APPROVED_COPY: SeqCopy[] = [
  {
    day_no: 1,
    email_subject: "[GloveK] 글로벌 50개국 가이드북 도착! 우리 브랜드, 틱톡샵부터 시작해도 될까요?",
    email_body: "안녕하세요. 디노스튜디오 GloveK입니다.\n\n해외 진출을 준비하시는 데 도움이 될 글로벌 50개국 해외 진출 가이드북을 보내드립니다.\n국가별 시장과 판매 채널, 인증·규제, 계약, 물류·정산 등 해외 진출에 필요한 내용을 담았습니다. 틱톡샵 진출·운영 특집도 함께 확인하실 수 있습니다.\n\n📖 글로벌 50개국 진출 가이드북 보기\nhttps://glovek.space/guidebook\n\n다양한 진출 방법 중 우리 브랜드가 틱톡샵을 검토하고 있다면, 먼저 확인할 질문이 있습니다.\n“우리 제품은 틱톡샵에 적합할까?”\n“어느 국가에서, 어떤 제품으로 시작하면 좋을까?”\n“입점과 판매를 위해 무엇을 준비해야 할까?”\n\nGloveK의 틱톡샵 1:1 상담에서 주요 제품과 현재 준비 상황을 바탕으로 함께 검토해 보세요.\n아직 입점을 결정하지 않으셔도 괜찮습니다. 우리 브랜드에 맞는 진출 방식인지 판단하는 것부터 상담하실 수 있습니다.\n\n📅 우리 브랜드 틱톡샵 진출 상담 예약\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2\n\n디노스튜디오 GloveK 드림",
    sms_body: "[디노스튜디오·GloveK]\n글로벌 50개국 해외 진출 가이드북을 보내드립니다. 국가별 진출 준비와 틱톡샵 운영 특집을 확인해 보세요.\n▶ 가이드북\nhttps://glovek.space/guidebook\n“우리 브랜드는 틱톡샵부터 시작해도 될까?”\n주요 제품과 준비 상황을 바탕으로 진출 국가·입점 준비·운영 방향을 함께 검토해 보세요.\n▶ 틱톡샵 1:1 상담 예약\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2",
  },
  {
    day_no: 2,
    email_subject: "[GloveK] 미국 틱톡샵, 우리 제품도 팔릴 수 있을까요?",
    email_body: "안녕하세요. 디노스튜디오 GloveK입니다.\n미국 틱톡샵에 관심이 생겼다면, 다음으로 궁금한 것은 ‘우리 제품에도 기회가 있을까?’일 것입니다.\n가능성을 살펴보려면 제품의 매력뿐 아니라 판매 가격, 물류와 운영 비용, 콘텐츠 준비도 함께 검토해야 합니다.\n이번 자료에서는 미국 틱톡샵 시장 동향과 진출 준비, 시딩 및 마케팅 사례를 살펴보실 수 있습니다.\n\n📖 미국 틱톡샵 시장·진출 준비 자료 보기\nhttps://app.notion.com/p/Glovek-01-3d7193cdf133809c825bd00acfc9f79b?source=copy_link\n\n자료 속 사례를 우리 브랜드에 적용하려면 무엇부터 확인해야 할까요?\n틱톡샵 1:1 상담에서 다음 내용을 중심으로 이야기해 보세요.\n- 어떤 제품을 우선 검토할지\n- 가격·물류·운영에서 무엇을 확인해야 할지\n- 현재 준비 단계에서 어떤 순서로 진행할지\n대표 제품과 현재 판매 가격을 알려주시면, 더 구체적인 상담에 도움이 됩니다.\n\n📅 우리 제품의 틱톡샵 진출 방향 상담하기\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2\n\n디노스튜디오 GloveK 드림",
    sms_body: "[디노스튜디오·GloveK]\n미국 틱톡샵, 우리 제품에도 기회가 있을까요?\n시장 동향과 진출 준비, 마케팅 사례를 확인해 보세요.\n▶ 자료 보기\nhttps://app.notion.com/p/Glovek-01-3d7193cdf133809c825bd00acfc9f79b?source=copy_link\n다음은 우리 제품의 가격·물류·운영 준비를 점검할 차례입니다.\n대표 제품을 바탕으로 무엇부터 준비하면 좋을지 1:1로 상담해 보세요.\n▶ 틱톡샵 진출 상담 예약\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2",
  },
  {
    day_no: 3,
    email_subject: "[GloveK] 우리 제품, 틱톡에서 어떤 콘텐츠로 팔아야 할까요?",
    email_body: "안녕하세요. 디노스튜디오 GloveK입니다.\n우리 제품을 틱톡샵에 올린다면, 고객이 관심을 가질 장면은 무엇일까요?\n제품을 사용하는 모습, 사용 전후의 차이, 고객이 자주 묻는 질문 등 브랜드마다 보여줄 수 있는 강점이 다릅니다.\n그 강점을 어떤 크리에이터가, 어떤 콘텐츠로 보여주고, 구매로 연결할지가 마케팅 계획의 중요한 출발점입니다.\n이번 자료에는 다음 내용이 담겨 있습니다.\n- 제품과 맞는 크리에이터 선정\n- 시딩·어필리에이트 협업\n- 상품 페이지와 상품 구성\n- 콘텐츠와 광고를 연결하는 전략\n- 현지 마케팅 사례\n\n📖 틱톡샵 마케팅 전략·사례 보기\nhttps://app.notion.com/p/Glovek-02-120-15-600-3d7193cdf13380b1aec6e946cca3503f?source=copy_link\n\n우리 브랜드는 어떤 제품으로, 어떤 콘텐츠부터 시작하면 좋을까요?\n틱톡샵 1:1 상담에서 대표 제품과 현재 마케팅 준비 상황을 바탕으로 크리에이터 협업과 초기 운영 방향을 함께 검토해 보세요.\n제품 상세페이지나 브랜드 홈페이지가 있다면 상담 시 참고할 수 있습니다.\n\n📅 우리 제품에 맞는 틱톡샵 마케팅 상담하기\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2\n\n디노스튜디오 GloveK 드림",
    sms_body: "[디노스튜디오·GloveK]\n우리 제품, 틱톡에서 어떤 콘텐츠로 보여줘야 할까요?\n크리에이터 선정부터 시딩, 상품 구성, 광고 연결까지 사례와 함께 확인해 보세요.\n▶ 마케팅 전략·사례\nhttps://app.notion.com/p/Glovek-02-120-15-600-3d7193cdf13380b1aec6e946cca3503f?source=copy_link\n우리 제품에 맞는 크리에이터 협업과 초기 운영 방향이 고민이라면, 1:1 상담에서 함께 검토해 보세요.\n▶ 틱톡샵 마케팅 상담 예약\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2",
  },
  {
    day_no: 4,
    email_subject: "[GloveK] 틱톡샵 진출, 무엇 때문에 다음 단계를 고민하고 계신가요?",
    email_body: "안녕하세요. 디노스튜디오 GloveK입니다.\n틱톡샵에 관심은 있지만 아직 다음 단계로 나아가지 못하셨다면, 어떤 점이 가장 고민되시나요?\n“비용이 어느 정도 들지 모르겠어요.”\n“입점 서류와 제품 준비가 충분한지 궁금해요.”\n“물류·정산·마케팅을 어떻게 운영해야 할지 막막해요.”\n“우리 인력으로 어디까지 해야 하는지 알고 싶어요.”\n입점과 운영에서 자주 나오는 질문을 아래에 정리했습니다. 운영 방식에 따라 적용 내용이 다를 수 있으니 궁금한 항목부터 살펴보세요.\n\n📖 틱톡샵 입점·운영 Q&A 보기\nhttps://glovek.space/tts/qna\n\n이 질문들이 정리되지 않았다면, 바로 그 내용을 상담에서 이야기하시면 됩니다.\n입점을 확정하거나 모든 준비를 마친 상태일 필요는 없습니다.\n현재 상황에서 무엇을 먼저 확인하고, 어떤 준비를 해야 다음 결정을 내릴 수 있을지 함께 정리해 보세요.\n예약 시 브랜드명, 주요 제품, 가장 궁금한 점을 남겨주시면 상담에 도움이 됩니다.\n\n📅 우리 브랜드 틱톡샵 1:1 상담 예약\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2\n\n디노스튜디오 GloveK 드림",
    sms_body: "[디노스튜디오·GloveK]\n틱톡샵 진출, 비용·서류·물류·마케팅 중 무엇이 가장 고민되시나요?\n▶ 입점·운영 Q&A\nhttps://glovek.space/tts/qna\n입점을 결정하거나 모든 준비를 끝낸 뒤 상담하실 필요는 없습니다.\n지금 고민되는 질문부터 이야기해 주세요. 우리 브랜드가 무엇부터 확인하고 준비해야 할지 함께 정리해 보세요.\n▶ 틱톡샵 1:1 상담 예약\nhttps://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2",
  },
];

/** 회차 번호로 승인 문안 찾기. */
export function approvedCopy(dayNo: number): SeqCopy | undefined {
  return APPROVED_COPY.find((c) => c.day_no === dayNo);
}
