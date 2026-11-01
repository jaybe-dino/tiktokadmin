/* Glovek Workspace — 업무 규칙
 *   여기서만 정한다: 단계 의미, 단계 이동 게이트, 데이터 준비도(L0~L3),
 *   회사 연매출 표기, "우리 금액"과 "회사 매출"의 분리.
 */
(function (global) {
  "use strict";
  var GV = global.GV = global.GV || {};
  var U = GV.util;

  /* ── 영업 단계 ──────────────────────────────── */
  var STAGES = [
    { id: "contact_planned", label: "컨택예정" },
    { id: "contacting", label: "컨택중" },
    { id: "meeting", label: "미팅" },
    { id: "proposal", label: "제안·협의" },
    { id: "contract_review", label: "계약검토" }
  ];
  var STATUS = {
    open: "진행", won: "수주 완료", hold: "보류", lost: "실패"
  };
  function stageIndex(id) { return STAGES.findIndex(function (s) { return s.id === id; }); }
  function stageLabel(id) { var s = STAGES.find(function (x) { return x.id === id; }); return s ? s.label : id; }

  /* ── 회사 연매출 ────────────────────────────── */
  var SCOPES = {
    "": "미확인",
    brand: "브랜드 단위(회사 연매출 아님)",
    company_separate: "회사 별도 연매출",
    company_consolidated: "회사 연결 연매출"
  };
  var REV_STATUS = {
    unknown: "미확인", reported: "고객 신고", estimated: "추정(미확정)", verified: "근거 확인"
  };
  /* 경계는 "미만" 이다 — 10억원 정확히는 "10억~50억원" 에 들어간다. */
  var BANDS = [
    { under: 1e9, label: "10억원 미만" },
    { under: 5e9, label: "10억~50억원" },
    { under: 1e10, label: "50억~100억원" },
    { under: 5e10, label: "100억~500억원" }
  ];
  var BAND_TOP = "500억원 이상";
  /* 0 은 "확인된 0" 이다. 사업 초기라는 뜻이 아니다 — 미확인과도 구분한다. */
  var BAND_ZERO = "0원(확인값)";
  var BAND_UNKNOWN = "미확인";
  var BAND_LABELS = [BAND_UNKNOWN, BAND_ZERO].concat(BANDS.map(function (b) { return b.label; })).concat([BAND_TOP]);

  /** 금액 → 구간. 미확인은 빈칸이 아니라 "미확인", 0 은 "매출 발생 전" 이다. */
  function revenueBand(amount) {
    if (amount == null || !isFinite(amount)) return BAND_UNKNOWN;
    if (amount <= 0) return BAND_ZERO;
    for (var i = 0; i < BANDS.length; i++) if (amount < BANDS[i].under) return BANDS[i].label;
    return BAND_TOP;
  }

  /* 회사 연매출로 셀 수 있는 확인 상태 — 추정(estimated)은 참고값이다. */
  var COMPANY_STATUS = ["reported", "verified"];
  /**
   * "회사 연매출" 로 쓸 수 있는 금액.
   *   브랜드 단위 숫자와 AI 추정은 회사 연매출이 아니다 → null 을 돌려주고
   *   참고값(referenceRevenue)으로만 보여 준다. 기준연도가 없으면 역시 쓰지 않는다.
   */
  function companyRevenueAmount(e) {
    var r = e && e.revenue;
    if (!r || r.amount == null) return null;
    if (!isCompanyScope(r.scope)) return null;
    if (COMPANY_STATUS.indexOf(r.status) < 0) return null;
    if (!r.year) return null;
    return r.amount;
  }
  function companyRevenueBand(e) { return revenueBand(companyRevenueAmount(e)); }
  /** 회사 연매출로 쓸 수 없는 금액(브랜드 단위·추정·연도 없음)을 참고값으로 설명한다. */
  function referenceRevenue(e) {
    var r = e && e.revenue;
    if (!r || r.amount == null) return null;
    if (companyRevenueAmount(e) != null) return null;
    var why = !isCompanyScope(r.scope) ? (r.scope === "brand" ? "브랜드 단위" : "범위 미확인")
      : COMPANY_STATUS.indexOf(r.status) < 0 ? (REV_STATUS[r.status] || r.status)
      : "기준연도 없음";
    return { amount: r.amount, why: why };
  }

  /**
   * 근거 확인(verified)으로 쓸 수 있는 묶음인가.
   *   금액·기준연도·귀속 법인·회사 범위·근거 URL 이 모두 있어야 한다.
   *   하나라도 비면 verified/L3 로 올리지 않는다.
   */
  function verifiedBundle(rev) {
    var r = rev || {};
    var missing = [];
    if (r.amount == null) missing.push("금액");
    if (!r.year) missing.push("기준연도");
    if (!String(r.legalEntity || "").trim()) missing.push("귀속 법인");
    if (!isCompanyScope(r.scope)) missing.push("회사 범위(별도/연결)");
    if (!String(r.sourceUrl || "").trim()) missing.push("근거 URL");
    return { ok: missing.length === 0, missing: missing };
  }
  function revenueText(e) {
    var r = e && e.revenue;
    if (!r || r.amount == null) return "미확인";
    return U.won(r.amount) + " · " + (REV_STATUS[r.status] || r.status);
  }
  /** 회사 범위로 확정된 매출만 "회사 연매출" 로 센다. */
  function isCompanyScope(scope) {
    return scope === "company_separate" || scope === "company_consolidated";
  }

  /* ── 데이터 준비도 (영업 단계가 아니다) ─────── */
  var READINESS = {
    L0: "L0 적재됨", L1: "L1 연락처 확보", L2: "L2 신원·카테고리 확인", L3: "L3 매출 근거 확인"
  };
  function derivedReadiness(e) {
    var hasContact = (e.contacts || []).some(function (c) { return c.phone || c.email; }) || e.phone || e.email;
    var identified = !!(e.category && (e.kind === "creator" ? e.name : e.legalName));
    var revOk = !!(e.revenue && e.revenue.status === "verified" && verifiedBundle(e.revenue).ok);
    if (revOk && identified && hasContact) return "L3";
    if (identified && hasContact) return "L2";
    if (hasContact) return "L1";
    return "L0";
  }
  /** 사람이 지정한 값이 있으면 그것이 우선이다(감사 기록으로 남는다). */
  function readinessOf(e) {
    if (e.readinessOverride && e.readinessOverride.level) return e.readinessOverride.level;
    return derivedReadiness(e);
  }

  /* ── 라벨 ───────────────────────────────────── */
  var KINDS = { company: "회사·브랜드", creator: "크리에이터" };
  var CHANNELS = { email: "이메일", call: "전화", meeting: "미팅", chat: "채팅" };
  var DIRECTIONS = { in: "수신", out: "발신" };

  /* ── 단계 이동 게이트 ───────────────────────── */
  /**
   * 어떤 추가 입력이 필요한지 알려 준다. 필요한 값이 없으면 이동하지 않는다.
   *   계약검토·수주에는 금액·날짜가, 수주에는 매출 범위가, 보류·실패에는 사유가 필요하다.
   */
  function moveRequirements(target) {
    if (target === "won") {
      return { fields: ["contractAmount", "contractDate", "contractScope"], title: "수주 완료로 옮기기",
        help: "확정 계약 금액·계약일·계약 범위(무엇을 해 주는 계약인지)가 있어야 수주로 기록합니다. "
          + "이 금액은 우리가 받는 계약 금액이며 고객사 연매출과 무관합니다." };
    }
    if (target === "contract_review") {
      return { fields: ["expectedAmount", "contractDate"], title: "계약검토로 옮기기",
        help: "예상 계약 금액과 예정일이 있어야 계약검토 단계로 올립니다. 우리 회사 금액입니다." };
    }
    if (target === "hold" || target === "lost") {
      return { fields: ["reason"], title: target === "hold" ? "보류로 옮기기" : "실패로 기록",
        help: "왜 멈췄는지 남겨야 다음 사람이 같은 일을 반복하지 않습니다." };
    }
    return null;
  }
  /** 게이트 입력 검증 — 통과하지 못하면 아무것도 쓰지 않는다. */
  function validateMove(target, input) {
    var req = moveRequirements(target);
    if (!req) return { ok: true, patch: {} };
    var patch = {}, errors = [];
    if (req.fields.indexOf("expectedAmount") >= 0) {
      var ea = U.intOrNull(input.expectedAmount);
      if (ea == null || ea <= 0) errors.push("예상 계약 금액을 0보다 큰 숫자로 입력해 주세요.");
      else if (ea > 1e12) errors.push("예상 계약 금액이 너무 큽니다.");
      else patch.expectedAmount = ea;
    }
    if (req.fields.indexOf("contractAmount") >= 0) {
      var ca = U.intOrNull(input.contractAmount);
      if (ca == null || ca <= 0) errors.push("확정 계약 금액을 0보다 큰 숫자로 입력해 주세요.");
      else if (ca > 1e12) errors.push("확정 계약 금액이 너무 큽니다.");
      else patch.contractAmount = ca;
    }
    if (req.fields.indexOf("contractDate") >= 0) {
      var d = U.parseDate(input.contractDate);
      if (!d) errors.push("계약(예정)일을 YYYY-MM-DD 로 입력해 주세요.");
      else patch.contractDate = U.fmtDate(d);
    }
    if (req.fields.indexOf("contractScope") >= 0) {
      /* 고객사 회계 범위(별도/연결)와 다른 값이다. 우리가 수행할 범위를 적는다. */
      var cs = U.clean(input.contractScope, 120);
      if (cs.length < 2) errors.push("계약 범위를 적어 주세요(예: 일본 틱톡샵 운영 대행 · 월 단위).");
      else patch.contractScope = cs;
    }
    if (req.fields.indexOf("reason") >= 0) {
      var r = U.clean(input.reason, 300);
      if (r.length < 2) errors.push("사유를 적어 주세요(2자 이상).");
      else patch.reason = r;
    }
    return errors.length ? { ok: false, errors: errors } : { ok: true, patch: patch };
  }

  /** 같은 업체에 같은 서비스로 "진행 중" 기회가 또 생기지 않게 막는다. */
  function duplicateDeal(state, entityId, service, exceptId) {
    var s = U.clean(service, 80);
    return (state.deals || []).find(function (d) {
      return d.entityId === entityId && d.status === "open" && d.id !== exceptId
        && U.clean(d.service, 80) === s;
    }) || null;
  }

  function entityById(state, id) {
    return (state.entities || []).find(function (e) { return e.id === id; }) || null;
  }
  function dealById(state, id) {
    return (state.deals || []).find(function (d) { return d.id === id; }) || null;
  }
  function entityName(state, id) {
    var e = entityById(state, id);
    return e ? e.name : "(삭제된 업체)";
  }

  /** 업체의 다음 액션 = 진행 중 기회·미완료 할 일 중 가장 빠른 것. */
  function refreshNextAction(state, entityId) {
    var e = entityById(state, entityId);
    if (!e) return;
    var cands = [];
    (state.deals || []).forEach(function (d) {
      if (d.entityId === entityId && d.status === "open" && d.nextActionAt) {
        cands.push({ at: d.nextActionAt, label: d.nextAction || d.service });
      }
    });
    (state.tasks || []).forEach(function (t) {
      if (t.entityId === entityId && !t.done && t.dueAt) cands.push({ at: t.dueAt, label: t.title });
    });
    cands.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    e.nextActionAt = cands[0] ? cands[0].at : null;
    e.nextAction = cands[0] ? cands[0].label : "";
  }
  function refreshLastComm(state, entityId) {
    var e = entityById(state, entityId);
    if (!e) return;
    var latest = null;
    (state.comms || []).forEach(function (c) {
      if (c.entityId === entityId && (!latest || c.at > latest)) latest = c.at;
    });
    e.lastCommAt = latest;
  }

  /* ── 가져오기용 필드 정의 ───────────────────── */
  var IMPORT_FIELDS = [
    { key: "extId", label: "외부 ID(병합 키)", hint: "같은 값이면 기존 행을 갱신합니다." },
    { key: "name", label: "업체·크리에이터명", required: true },
    { key: "legalName", label: "법인명" },
    { key: "kind", label: "유형(회사/크리에이터)" },
    { key: "category", label: "카테고리" },
    { key: "source", label: "유입 출처" },
    { key: "inflowAt", label: "유입일(YYYY-MM-DD)" },
    { key: "owner", label: "담당자" },
    { key: "quality", label: "등급(A/B/C)" },
    { key: "phone", label: "대표 전화" },
    { key: "email", label: "대표 이메일" },
    { key: "website", label: "홈페이지" },
    { key: "contactName", label: "담당자명(연락처)" },
    { key: "revenueAmount", label: "회사 연매출 금액(원)" },
    { key: "revenueYear", label: "매출 기준연도" },
    { key: "revenueScope", label: "매출 범위" },
    { key: "revenueSourceUrl", label: "매출 근거 URL" },
    { key: "memo", label: "메모" }
  ];
  /** 헤더 이름 → 우리 필드 자동 추정(공백·대소문자 무시). */
  var HEADER_HINTS = {
    extId: ["외부id", "외부아이디", "extid", "externalid", "external_id", "id", "코드"],
    name: ["업체명", "브랜드명", "이름", "name", "회사명", "크리에이터"],
    legalName: ["법인명", "사업자명", "legalname"],
    kind: ["유형", "구분", "type", "kind"],
    category: ["카테고리", "분류", "category"],
    source: ["유입출처", "출처", "source", "채널"],
    inflowAt: ["유입일시", "유입일", "등록일", "inflowat", "inflow_at", "inflow", "date"],
    owner: ["담당자", "owner", "assignee", "담당"],
    quality: ["등급", "품질", "quality", "grade"],
    phone: ["전화", "전화번호", "연락처", "phone", "휴대폰"],
    email: ["이메일", "메일", "email"],
    website: ["홈페이지", "사이트", "url", "website", "브랜드링크"],
    contactName: ["담당자명", "담당자이름", "contactname", "contact_name", "contactperson"],
    revenueAmount: ["회사연매출금액", "회사연매출", "연매출", "매출액", "revenueamount", "revenue_amount", "annualrevenue", "매출", "revenue"],
    revenueYear: ["회사연매출연도", "매출기준연도", "매출연도", "기준연도", "revenueyear", "revenue_year", "fiscalyear", "연도"],
    revenueScope: ["매출범위", "scope", "범위"],
    revenueSourceUrl: ["매출근거url", "매출근거", "근거url", "revenuesourceurl", "revenue_source_url", "sourceurl", "source_url", "출처url"],
    memo: ["메모", "비고", "note", "memo"]
  };
  function normHead(h) { return String(h || "").replace(/\s|[()·_\-\[\]]/g, "").toLowerCase(); }
  /* 정확 일치용 표 + 길이순 힌트 목록을 한 번만 만든다. */
  var EXACT = (function () {
    var m = new Map();
    Object.keys(HEADER_HINTS).forEach(function (k) {
      m.set(normHead(k), k);
      HEADER_HINTS[k].forEach(function (hint) { if (!m.has(normHead(hint))) m.set(normHead(hint), k); });
    });
    return m;
  })();
  var RANKED = (function () {
    var list = [];
    Object.keys(HEADER_HINTS).forEach(function (k) {
      HEADER_HINTS[k].forEach(function (hint) { list.push({ key: k, hint: normHead(hint) }); });
    });
    /* 긴 힌트를 먼저 본다 — "매출연도" 가 "매출" 보다 앞서야 한다. */
    return list.sort(function (a, b) { return b.hint.length - a.hint.length; });
  })();

  /**
   * 파일 헤더 → 우리 필드.
   *   ① 정규화 후 정확히 일치하는 이름을 먼저 찾는다.
   *   ② 없으면 긴 힌트부터 포함 여부를 본다("매출연도" → revenueYear, "담당자명" → contactName).
   */
  function guessField(header) {
    var h = normHead(header);
    if (!h) return "";
    if (EXACT.has(h)) return EXACT.get(h);
    for (var i = 0; i < RANKED.length; i++) {
      if (h.indexOf(RANKED[i].hint) >= 0) return RANKED[i].key;
    }
    return "";
  }

  GV.model = {
    STAGES: STAGES, STATUS: STATUS, SCOPES: SCOPES, REV_STATUS: REV_STATUS,
    READINESS: READINESS, KINDS: KINDS, CHANNELS: CHANNELS, DIRECTIONS: DIRECTIONS,
    IMPORT_FIELDS: IMPORT_FIELDS,
    stageIndex: stageIndex, stageLabel: stageLabel,
    revenueBand: revenueBand, revenueText: revenueText, isCompanyScope: isCompanyScope,
    BAND_LABELS: BAND_LABELS, companyRevenueAmount: companyRevenueAmount,
    companyRevenueBand: companyRevenueBand, referenceRevenue: referenceRevenue,
    verifiedBundle: verifiedBundle, COMPANY_STATUS: COMPANY_STATUS,
    derivedReadiness: derivedReadiness, readinessOf: readinessOf,
    moveRequirements: moveRequirements, validateMove: validateMove, duplicateDeal: duplicateDeal,
    entityById: entityById, dealById: dealById, entityName: entityName,
    refreshNextAction: refreshNextAction, refreshLastComm: refreshLastComm,
    guessField: guessField
  };
})(window);
