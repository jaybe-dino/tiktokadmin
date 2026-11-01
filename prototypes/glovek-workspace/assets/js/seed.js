/* Glovek Workspace — 예시 데이터
 *   전부 가상 업체·가상 담당자·가상 도메인(example.invalid)이다.
 *   실제 연락처·실제 매출을 담지 않는다. 날짜는 "오늘" 기준 상대값으로 만든다.
 */
(function (global) {
  "use strict";
  var GV = global.GV = global.GV || {};
  var U = GV.util;

  var OWNERS = ["미배정", "김지호", "최재영", "주소미", "박다연"];
  var SOURCES = ["Glovek 상담", "메타 광고", "세미나", "엑셀 업로드", "소개", "홈페이지 문의"];
  var CAT_CO = ["스킨케어", "색조", "헤어·바디", "식품", "건강기능식품", "리빙", "패션", "반려동물", "생활용품", "유아"];
  var CAT_CR = ["뷰티", "리빙", "라이프스타일", "푸드", "패션"];
  var SERVICES = ["틱톡샵 일본 운영", "미국 시딩 캠페인", "크로스보더 입점", "월 운영 계약",
    "글로벌 운영 계약", "일본 마케팅", "미국 시장 진출", "숏폼 제작 패키지"];

  /* [이름, 법인명, 카테고리, 매출(억·null=미확인), 범위, 상태] */
  var CO = [
    ["루미에르랩", "루미에르코스㈜", "스킨케어", 240, "company_separate", "verified"],
    ["오브뉴", "오브뉴랩㈜", "헤어·바디", null, "", "unknown"],
    ["그로브케어", "그로브케어㈜", "생활용품", 860, "company_consolidated", "verified"],
    ["누아트푸드", "누아트푸드㈜", "식품", 52, "company_separate", "reported"],
    ["플로우리빙", "플로우리빙㈜", "리빙", 135, "company_separate", "verified"],
    ["베러펫", "베러펫㈜", "반려동물", 32, "brand", "reported"],
    ["온유코스", "온유코스㈜", "스킨케어", 1200, "company_consolidated", "verified"],
    ["서울앤코", "서울앤코㈜", "패션", null, "", "unknown"],
    ["모먼트뷰티", "모먼트뷰티㈜", "색조", 8, "brand", "reported"],
    ["클리어하우스", "클리어하우스㈜", "리빙", 380, "company_separate", "verified"],
    ["하루온", "하루온㈜", "건강기능식품", null, "", "unknown"],
    ["아뜰리에온", "아뜰리에온㈜", "패션", 74, "company_separate", "reported"],
    ["단정식품", "단정에프앤비㈜", "식품", 420, "company_consolidated", "verified"],
    ["피토랩", "피토랩㈜", "건강기능식품", 96, "company_separate", "estimated"],
    ["코지홈", "코지홈㈜", "리빙", null, "", "unknown"],
    ["비욘드글로", "비욘드글로㈜", "스킨케어", 310, "company_separate", "verified"],
    ["래빗베이비", "래빗베이비㈜", "유아", 18, "brand", "reported"],
    ["소프트리", "소프트리㈜", "생활용품", 205, "company_separate", "estimated"],
    ["더바른", "더바른헬스케어㈜", "건강기능식품", 640, "company_consolidated", "verified"],
    ["윈터무드", "윈터무드㈜", "패션", null, "", "unknown"],
    ["그린테이블", "그린테이블㈜", "식품", 27, "brand", "reported"],
    ["아우라코스", "아우라코스메틱㈜", "색조", 158, "company_separate", "verified"],
    ["펫프렌즈랩", "펫프렌즈랩㈜", "반려동물", 61, "company_separate", "estimated"],
    ["리프레쉬온", "리프레쉬온㈜", "헤어·바디", null, "", "unknown"],
    ["무드케어", "무드케어㈜", "스킨케어", 44, "brand", "reported"],
    ["해밀홈", "해밀홈㈜", "리빙", 92, "company_separate", "verified"],
    ["퓨어핏", "퓨어핏㈜", "건강기능식품", 1540, "company_consolidated", "verified"],
    ["노블리프", "노블리프㈜", "유아", null, "", "unknown"],
    ["살루스랩", "살루스랩㈜", "건강기능식품", 36, "brand", "reported"],
    ["브릿지뷰티", "브릿지뷰티㈜", "색조", 118, "company_separate", "estimated"],
    ["담다식품", "담다식품㈜", "식품", 73, "company_separate", "reported"],
    ["스텝인", "스텝인㈜", "패션", null, "", "unknown"],
    ["로우브", "로우브㈜", "리빙", 266, "company_separate", "verified"],
    ["티엠케어", "티엠케어㈜", "생활용품", 15, "brand", "reported"],
    ["올데이핏", "올데이핏㈜", "건강기능식품", null, "", "unknown"]
  ];
  var CR = [
    ["소담로그", "뷰티", 12], ["오늘의준", "리빙", 31], ["크리에이터 민지", "뷰티", 48],
    ["유니데이", "라이프스타일", 9], ["맛잘알태오", "푸드", 22], ["리빙하우", "리빙", 5],
    ["해나의하루", "패션", 17], ["뷰티로그윤", "뷰티", 64], ["푸드메이트현", "푸드", 3],
    ["스타일링지", "패션", 28], ["데일리온", "라이프스타일", 11], ["코스메틱랩소", "뷰티", 39]
  ];
  var CONTACT_FIRST = ["지현", "민수", "서연", "도윤", "하늘", "예진", "준호", "다은", "성우", "유나"];
  var CONTACT_ROLE = ["대표", "마케팅 팀장", "이커머스 담당", "해외사업 매니저", "브랜드 매니저"];
  var MEMO = [
    "첫 상담에서 일본 진출 우선이라고 함. 예산은 다음 분기 확정 예정.",
    "리드 광고로 들어온 건. 담당자 연결 전이라 정보 확인 필요.",
    "세미나 참석 후 바로 견적 요청. 물류 단가가 관심사.",
    "", "", "",
    "작년 매출 자료는 공시 기준으로 확인했음. 범위는 법인 별도.",
    "미국 먼저 보고 싶다고 함. 시딩 캠페인 사례 요청.",
    ""
  ];

  function pick(arr, i) { return arr[i % arr.length]; }

  function fill(state) {
    var today = new Date();
    var members = OWNERS.filter(function (o) { return o !== "미배정"; }).map(function (name, i) {
      return { id: U.uid("mem"), name: name, role: i === 0 ? "영업 리드" : "영업 담당", active: true };
    });
    state.members = members;

    var entities = [];
    CO.forEach(function (row, i) {
      entities.push(makeEntity({
        kind: "company", index: i, name: row[0], legalName: row[1], category: row[2],
        revenueEok: row[3], scope: row[4], revStatus: row[5], today: today
      }));
    });
    CR.forEach(function (row, i) {
      entities.push(makeEntity({
        kind: "creator", index: CO.length + i, name: row[0], legalName: row[0],
        category: row[1], followers: row[2], revenueEok: null, scope: "", revStatus: "unknown", today: today
      }));
    });
    state.entities = entities;

    /* 영업 기회 — 일부 업체만. 회사 연매출과 섞지 않는 "우리 금액"이다. */
    var deals = [];
    var stageOf = ["contact_planned", "contacting", "meeting", "proposal", "contract_review"];
    var dealPlan = [
      [0, 0, null, 2], [2, 1, 12000000, 0], [5, 1, 4000000, -2], [3, 2, 6000000, 1],
      [9, 2, 8000000, 0], [4, 3, 9000000, 0], [6, 4, 18000000, 2], [12, 3, 15000000, 4],
      [15, 1, 5500000, -1], [18, 4, 24000000, 3], [21, 2, 7000000, 5], [25, 0, null, 6],
      [26, 4, 31000000, 1], [29, 1, 6500000, -3], [32, 3, 11000000, 2]
    ];
    dealPlan.forEach(function (p, i) {
      var e = entities[p[0]];
      deals.push({
        id: U.uid("deal"), entityId: e.id, service: pick(SERVICES, i),
        stage: stageOf[p[1]], status: "open",
        expectedAmount: p[2], contractAmount: null, contractDate: null,
        contractScope: "", reason: "",
        owner: e.owner === "미배정" ? pick(OWNERS.slice(1), i) : e.owner,
        nextAction: pick(["니즈·예산 확인", "전화 팔로업", "제안서 공유", "온라인 미팅", "견적 조건 검토", "계약 범위 확인"], i),
        nextActionAt: U.addDays(today, p[3]).toISOString(),
        createdAt: U.addDays(today, -(14 + i)).toISOString(),
        updatedAt: U.addDays(today, -(2 + (i % 5))).toISOString(),
        closedAt: null
      });
    });
    /* 종료된 기회도 섞는다 — 수주/보류/실패 토글을 실제로 볼 수 있게. */
    deals.push({
      id: U.uid("deal"), entityId: entities[1].id, service: "숏폼 제작 패키지",
      stage: "contract_review", status: "won",
      expectedAmount: 9000000, contractAmount: 8600000,
      contractDate: U.fmtDate(U.addDays(today, -9)),
      contractScope: "숏폼 제작 패키지 · 월 8편 · 3개월", reason: "",
      owner: "김지호", nextAction: "", nextActionAt: null,
      createdAt: U.addDays(today, -41).toISOString(), updatedAt: U.addDays(today, -9).toISOString(),
      closedAt: U.addDays(today, -9).toISOString()
    });
    deals.push({
      id: U.uid("deal"), entityId: entities[7].id, service: "미국 시딩 캠페인",
      stage: "proposal", status: "hold",
      expectedAmount: 7000000, contractAmount: null, contractDate: null, contractScope: "",
      reason: "내부 예산 편성이 다음 분기로 밀렸습니다.",
      owner: "최재영", nextAction: "", nextActionAt: null,
      createdAt: U.addDays(today, -33).toISOString(), updatedAt: U.addDays(today, -6).toISOString(),
      closedAt: U.addDays(today, -6).toISOString()
    });
    deals.push({
      id: U.uid("deal"), entityId: entities[19].id, service: "틱톡샵 일본 운영",
      stage: "meeting", status: "lost",
      expectedAmount: 5000000, contractAmount: null, contractDate: null, contractScope: "",
      reason: "타 대행사와 이미 계약을 마쳤다고 합니다.",
      owner: "주소미", nextAction: "", nextActionAt: null,
      createdAt: U.addDays(today, -52).toISOString(), updatedAt: U.addDays(today, -15).toISOString(),
      closedAt: U.addDays(today, -15).toISOString()
    });
    state.deals = deals;

    /* 할 일 — 지남/오늘/예정/완료가 모두 생기도록 */
    var tasks = [];
    [[-3, false], [-1, false], [0, false], [0, false], [1, false], [2, false], [4, false],
     [7, false], [-5, true], [-2, true], [-8, true]].forEach(function (t, i) {
      var e = entities[(i * 3) % entities.length];
      var d = deals[i % 10];
      tasks.push({
        id: U.uid("task"),
        title: pick(["제안서 초안 작성", "전화 팔로업", "견적서 발송", "미팅 일정 확정",
          "계약서 조건 확인", "자료 회신 확인", "담당자 재확인", "샘플 발송 확인"], i),
        entityId: e.id, dealId: i % 3 === 0 && d ? d.id : null,
        owner: pick(OWNERS.slice(1), i),
        dueAt: U.addDays(today, t[0]).toISOString(),
        done: t[1], doneAt: t[1] ? U.addDays(today, t[0]).toISOString() : null,
        createdAt: U.addDays(today, t[0] - 4).toISOString()
      });
    });
    state.tasks = tasks;

    /* 커뮤니케이션 기록 — 수신/발신, 채널 혼합. 실제 메일 연동이 아니라 수기 기록이다. */
    var comms = [];
    var bodies = [
      "일본 진출 일정과 수수료 구조를 물어보셨습니다. 자료 정리해 보내기로 했습니다.",
      "통화 연결됨. 다음 주 화요일 오전 미팅으로 합의.",
      "제안서 1차본 발송. 물류 단가 부분만 다시 확인 요청 받았습니다.",
      "부재중. 문자로 안내 남김.",
      "미팅 진행. 예산 범위는 월 500만원대, 결정은 대표님 확인 후.",
      "메일 회신 받음. 계약 조건 중 정산 주기를 월 2회로 요청.",
      "채팅으로 샘플 수령 확인. 촬영 일정 조율 예정."
    ];
    for (var i = 0; i < 26; i++) {
      var e = entities[(i * 5) % entities.length];
      var dir = i % 3 === 0 ? "in" : "out";
      comms.push({
        id: U.uid("comm"), entityId: e.id, dealId: null,
        direction: dir, channel: pick(["email", "call", "meeting", "chat"], i),
        contactId: e.contacts[0] ? e.contacts[0].id : null,
        owner: e.owner === "미배정" ? pick(OWNERS.slice(1), i) : e.owner,
        at: U.addDays(today, -(1 + (i % 21))).toISOString(),
        body: pick(bodies, i),
        outcome: pick(["자료 발송 예정", "미팅 확정", "회신 대기", "검토 중", "조건 협의"], i),
        createdAt: U.addDays(today, -(1 + (i % 21))).toISOString()
      });
    }
    state.comms = comms;

    /* 마지막 커뮤니케이션 시각을 엔티티에 반영 */
    comms.forEach(function (c) {
      var e = state.entities.find(function (x) { return x.id === c.entityId; });
      if (e && (!e.lastCommAt || c.at > e.lastCommAt)) e.lastCommAt = c.at;
    });
    /* 다음 액션은 기회·할 일에서 끌어온다 */
    state.entities.forEach(function (e) {
      var open = deals.filter(function (d) { return d.entityId === e.id && d.status === "open" && d.nextActionAt; });
      var t = tasks.filter(function (x) { return x.entityId === e.id && !x.done; });
      var cands = open.map(function (d) { return { at: d.nextActionAt, label: d.nextAction }; })
        .concat(t.map(function (x) { return { at: x.dueAt, label: x.title }; }));
      cands.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      if (cands[0]) { e.nextActionAt = cands[0].at; e.nextAction = cands[0].label; }
    });

    state.imports = [{
      id: U.uid("imp"), at: U.addDays(today, -11).toISOString(), actor: "로컬 사용자",
      file: "예시-초기적재.csv", rows: 35, created: 35, updated: 0, skipped: 0, errors: 0,
      note: "예시 데이터 초기 적재(시연용 기록)"
    }];
    return state;
  }

  function makeEntity(o) {
    var i = o.index;
    var today = o.today;
    var inflow = U.addDays(today, -(1 + (i * 2) % 90));
    inflow.setHours(9 + (i % 9), (i * 7) % 60, 0, 0);
    var owner = pick(OWNERS, i + 1);
    if (i % 7 === 1) owner = "미배정";
    var slug = "brand" + (i + 101);
    var contacts = [];
    var nContacts = owner === "미배정" ? 0 : (i % 5 === 0 ? 2 : 1);
    for (var c = 0; c < nContacts; c++) {
      contacts.push({
        id: U.uid("ct"),
        name: pick(CONTACT_FIRST, i + c) + " " + pick(CONTACT_ROLE, i + c).slice(0, 2),
        role: pick(CONTACT_ROLE, i + c),
        phone: "010-" + String(1000 + ((i * 37 + c * 11) % 9000)) + "-" + String(1000 + ((i * 53 + c * 7) % 9000)),
        email: slug + (c ? "." + (c + 1) : "") + "@example.invalid",
        primary: c === 0
      });
    }
    var hasRevenue = o.revenueEok != null;
    var readiness = "L0";
    if (contacts.length) readiness = "L1";
    if (contacts.length && o.category) readiness = "L2";
    if (readiness === "L2" && o.revStatus === "verified") readiness = "L3";
    return {
      id: U.uid("ent"),
      extId: "GV-" + String(1000 + i),
      kind: o.kind,
      name: o.name,
      legalName: o.legalName || "",
      category: o.category,
      source: pick(SOURCES, i),
      inflowAt: inflow.toISOString(),
      owner: owner,
      quality: pick(["A", "B", "C", "미분류"], i + 2),
      readiness: readiness,
      readinessOverride: null,
      phone: contacts[0] ? contacts[0].phone : "",
      email: contacts[0] ? contacts[0].email : "",
      website: o.kind === "company" ? "https://" + slug + ".example.invalid" : "",
      followers: o.followers || null,
      revenue: {
        amount: hasRevenue ? o.revenueEok * 100000000 : null,
        year: hasRevenue ? today.getFullYear() - 1 : null,
        currency: "KRW",
        legalEntity: hasRevenue ? (o.legalName || o.name) : "",
        scope: o.scope || "",
        status: o.revStatus,
        sourceUrl: o.revStatus === "verified" ? "https://dart.example.invalid/report/" + slug : ""
      },
      memo: pick(MEMO, i),
      contacts: contacts,
      createdAt: inflow.toISOString(),
      updatedAt: U.addDays(today, -(i % 12)).toISOString(),
      lastCommAt: null,
      nextActionAt: null,
      nextAction: ""
    };
  }

  GV.seed = { fill: fill, OWNERS: OWNERS, SOURCES: SOURCES, CATEGORIES: CAT_CO.concat(CAT_CR) };
})(window);
