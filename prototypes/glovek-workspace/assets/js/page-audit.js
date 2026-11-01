/* Glovek Workspace — 변경 이력
 *   로컬에서 일어난 쓰기(수정·생성·단계이동·가져오기·복원)의 before/after 와 시각·행위자.
 *   CSV 로 내보낼 수 있다. 이 기록은 로컬 저장소 안에만 있다.
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;
  var view = { op: "", type: "", q: "", limit: 80 };

  var OP_LABEL = {
    "seed": "예시 데이터 생성", "entity.create": "업체 추가", "entity.update": "업체 수정",
    "entity.memo": "메모 저장", "entity.readiness": "준비도 지정", "entity.batchOwner": "담당자 일괄",
    "entity.batchQuality": "등급 일괄", "contact.create": "연락처 추가", "contact.delete": "연락처 삭제",
    "deal.create": "기회 생성", "deal.update": "기회 수정", "deal.move": "단계 이동",
    "deal.undo": "이동 되돌리기", "deal.reopen": "기회 재개",
    "task.create": "할 일 추가", "task.update": "할 일 수정", "task.complete": "할 일 완료",
    "task.reopen": "할 일 재개", "comm.create": "커뮤니케이션 기록",
    "import.commit": "가져오기 반영", "restore": "백업 복원", "reset": "초기화",
    "settings.update": "설정 변경", "member.create": "구성원 추가", "member.delete": "구성원 삭제",
    "connection.save": "연결 설정 저장"
  };
  function opLabel(op) { return OP_LABEL[op] || op; }

  var TARGET_LABEL = {
    entity: "업체", deal: "영업 기회", task: "할 일", comm: "커뮤니케이션",
    prefs: "설정", member: "구성원", "import": "가져오기", store: "저장소"
  };
  /* 내부 필드 이름을 업무 용어로 바꾼다. 화면에는 이 말만 보인다. */
  var FIELD_LABEL = {
    name: "업체명", legalName: "법인명", kind: "유형", category: "카테고리", source: "유입 출처",
    inflowAt: "유입일시", owner: "담당자", quality: "등급", memo: "메모", phone: "전화",
    email: "이메일", website: "홈페이지", readiness: "데이터 준비도", revenue: "회사 매출 정보",
    stage: "영업 단계", status: "상태", service: "서비스", expectedAmount: "예상 계약 금액",
    contractAmount: "확정 계약 금액", contractDate: "계약일", contractScope: "계약 범위",
    reason: "사유", nextAction: "다음 액션", nextActionAt: "다음 액션 일자",
    title: "할 일", dueAt: "기한", done: "완료 여부", direction: "방향", channel: "채널",
    role: "역할", defaultPage: "시작 화면", density: "표 밀도", lastBackupAt: "마지막 백업",
    adminApiUrl: "어드민 주소(메모)", sheetId: "시트 ID(메모)", note: "메모",
    rows: "전체 행", created: "신규", updated: "갱신", skipped: "변경 없음",
    errors: "오류", preserved: "보존", entities: "업체 수", deals: "영업 기회 수",
    amount: "금액", year: "기준연도", scope: "매출 범위", sourceUrl: "근거 URL",
    legalEntity: "귀속 법인", level: "단계"
  };
  var VALUE_LABEL = {
    company: "회사·브랜드", creator: "크리에이터",
    open: "진행", won: "수주 완료", hold: "보류", lost: "실패",
    "in": "수신", out: "발신", email: "이메일", call: "전화", meeting: "미팅", chat: "채팅",
    brand: "브랜드 단위", company_separate: "회사 별도", company_consolidated: "회사 연결",
    unknown: "미확인", reported: "고객 신고", estimated: "추정(미확정)", verified: "근거 확인"
  };
  var MONEY_FIELDS = ["expectedAmount", "contractAmount", "amount"];
  var DATE_FIELDS = ["inflowAt", "nextActionAt", "dueAt", "doneAt", "lastBackupAt", "createdAt", "updatedAt", "closedAt"];

  function fieldLabel(k) { return FIELD_LABEL[k] || k; }
  function valueText(key, v) {
    if (v == null || v === "") return "(없음)";
    if (typeof v === "boolean") return key === "done" ? (v ? "완료" : "미완료") : (v ? "예" : "아니오");
    if (M.STAGES.some(function (x) { return x.id === v; })) return M.stageLabel(v);
    if (VALUE_LABEL[v] != null) return VALUE_LABEL[v];
    if (MONEY_FIELDS.indexOf(key) >= 0 && typeof v === "number") return U.won(v);
    if (DATE_FIELDS.indexOf(key) >= 0) return U.fmtKst(v) || String(v);
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.length + "건";
    if (typeof v === "object") {
      return Object.keys(v).filter(function (k) { return v[k] != null && v[k] !== ""; })
        .map(function (k) { return fieldLabel(k) + " " + valueText(k, v[k]); }).join(", ") || "(없음)";
    }
    return String(v);
  }

  /** before/after → [{label, from, to}] 로 바꾼다. 바뀐 칸만 담는다. */
  function diffRows(a) {
    var before = a.before, after = a.after;
    var bObj = before && typeof before === "object" && !Array.isArray(before);
    var aObj = after && typeof after === "object" && !Array.isArray(after);
    if (!bObj && !aObj) {
      if (before == null && after == null) return [];
      return [{ label: "값", from: valueText("", before), to: valueText("", after) }];
    }
    var keys = [];
    if (bObj) Object.keys(before).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    if (aObj) Object.keys(after).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var out = [];
    keys.forEach(function (k) {
      var f = bObj ? before[k] : undefined;
      var t = aObj ? after[k] : undefined;
      var fs = f === undefined ? null : valueText(k, f);
      var ts = t === undefined ? null : valueText(k, t);
      if (fs === ts) return;
      out.push({ label: fieldLabel(k), from: fs == null ? "(기록 없음)" : fs, to: ts == null ? "(기록 없음)" : ts });
    });
    return out;
  }
  /** 표에 한 줄로 보여 줄 요약. */
  function diffSummary(a) {
    var rows = diffRows(a);
    if (!rows.length) return a.note || "";
    var head = rows.slice(0, 2).map(function (r) { return r.label + " " + r.from + " → " + r.to; }).join(" · ");
    return rows.length > 2 ? head + " 외 " + (rows.length - 2) + "건" : head;
  }


  function render(state, api) {
    var wrap = U.el("div");
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "변경 이력" }));
    left.appendChild(U.el("p", { text: "이 브라우저에서 일어난 쓰기만 담습니다. 최근 600건까지 보관합니다." }));
    head.appendChild(left);
    var acts = U.el("div", { class: "gv-actions" });
    acts.appendChild(GV.pages.database.btn("이력 내보내기", "download", false, function () { exportCsv(state, api); }));
    head.appendChild(acts);
    wrap.appendChild(head);

    var logs = state.audit || [];
    var ops = Array.from(new Set(logs.map(function (a) { return a.op; })));
    var types = Array.from(new Set(logs.map(function (a) { return a.targetType; }).filter(Boolean)));

    var bar = U.el("div", { class: "gv-filterbar" });
    var search = U.el("div", { class: "gv-search" });
    search.appendChild(U.iconNode("search"));
    var qi = U.el("input", { type: "search", value: view.q, placeholder: "대상·메모 검색", "aria-label": "이력 검색" });
    qi.addEventListener("input", U.debounce(function () { view.q = qi.value; GV.app.render(); }, 220));
    search.appendChild(qi);
    bar.appendChild(search);
    bar.appendChild(GV.pages.database.select("작업 전체", ops, view.op,
      function (v) { view.op = v; GV.app.render(); }, "작업 필터", OP_LABEL));
    bar.appendChild(GV.pages.database.select("대상 전체", types, view.type,
      function (v) { view.type = v; GV.app.render(); }, "대상 필터"));
    bar.appendChild(U.el("button", {
      type: "button", text: "필터 초기화",
      onclick: function () { view.op = ""; view.type = ""; view.q = ""; GV.app.render(); }
    }));
    wrap.appendChild(bar);

    var q = U.clean(view.q).toLowerCase();
    var rows = logs.filter(function (a) {
      if (view.op && a.op !== view.op) return false;
      if (view.type && a.targetType !== view.type) return false;
      if (!q) return true;
      return [a.targetName, a.note, a.actor, a.op].some(function (f) { return f && String(f).toLowerCase().indexOf(q) >= 0; });
    });

    var cards = U.el("div", { class: "gv-cards" });
    cards.appendChild(GV.pages.database.stat("전체 이력", logs.length + "건", ""));
    cards.appendChild(GV.pages.database.stat("이번 조건", rows.length + "건", ""));
    cards.appendChild(GV.pages.database.stat("최근 기록", logs[0] ? U.fmtDateTime(logs[0].at) : "없음", ""));
    cards.appendChild(GV.pages.database.stat("저장 크기", Math.round(S.health().bytes / 1024) + " KB", "브라우저 저장소"));
    wrap.appendChild(cards);

    if (!rows.length) {
      wrap.appendChild(U.el("div", { class: "gv-empty", text: "조건에 맞는 이력이 없습니다." }));
      return wrap;
    }

    var sheet = U.el("div", { class: "gv-sheet" });
    var tw = U.el("div", { class: "gv-table-wrap" });
    var table = U.el("table");
    var thead = U.el("thead");
    var hr = U.el("tr");
    ["시각", "작업", "대상", "바뀐 내용", "행위자", ""].forEach(function (h) {
      hr.appendChild(U.el("th", { scope: "col", text: h }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = U.el("tbody");
    rows.slice(0, view.limit).forEach(function (a) {
      var tr = U.el("tr");
      tr.appendChild(U.el("td", { class: "gv-number gv-nowrap", text: U.fmtKst(a.at) }));
      tr.appendChild(U.el("td", { class: "gv-nowrap" }, [U.el("span", { class: "gv-chip", text: opLabel(a.op) })]));
      tr.appendChild(U.el("td", { text: a.targetName || TARGET_LABEL[a.targetType] || "-" }));
      tr.appendChild(U.el("td", { text: diffSummary(a) || "-" }));
      tr.appendChild(U.el("td", { class: "gv-nowrap", text: a.actor || "-" }));
      var td = U.el("td");
      td.appendChild(U.el("button", {
        type: "button", class: "gv-quiet", text: "자세히",
        onclick: function () { showDiff(a); }
      }));
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tw.appendChild(table);
    sheet.appendChild(tw);
    wrap.appendChild(sheet);
    if (rows.length > view.limit) {
      wrap.appendChild(U.el("button", {
        type: "button", style: "margin-top:12px",
        text: "더 보기 (" + (rows.length - view.limit) + "건 남음)",
        onclick: function () { view.limit += 80; GV.app.render(); }
      }));
    }
    return wrap;
  }

  function showDiff(a) {
    var body = U.el("div");
    var dl = U.el("dl", { class: "gv-kv" });
    function kv(k, v) { dl.appendChild(U.el("dt", { text: k })); dl.appendChild(U.el("dd", { text: v })); }
    kv("시각", U.fmtKst(a.at));
    kv("작업", opLabel(a.op));
    kv("대상", (a.targetName || "-") + (a.targetType ? " (" + (TARGET_LABEL[a.targetType] || a.targetType) + ")" : ""));
    kv("한 사람", a.actor || "-");
    if (a.note) kv("메모", a.note);
    body.appendChild(dl);

    var rows = diffRows(a);
    body.appendChild(U.el("h3", { text: "바뀐 내용", style: "margin-top:14px" }));
    if (!rows.length) {
      body.appendChild(U.el("p", { class: "gv-small gv-muted", text: "값 비교 기록이 없는 작업입니다." }));
    } else {
      var tw = U.el("div", { class: "gv-table-wrap", style: "max-height:300px" });
      var table = U.el("table");
      var thead = U.el("thead");
      var hr = U.el("tr");
      ["항목", "변경 전", "변경 후"].forEach(function (h) { hr.appendChild(U.el("th", { scope: "col", text: h })); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = U.el("tbody");
      rows.forEach(function (r) {
        var tr = U.el("tr");
        tr.appendChild(U.el("td", { class: "gv-nowrap", text: r.label }));
        tr.appendChild(U.el("td", { class: "gv-muted", text: r.from }));
        tr.appendChild(U.el("td", {}, [U.el("strong", { text: r.to })]));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      tw.appendChild(table);
      body.appendChild(tw);
    }

    /* 원시 데이터는 접어 둔다 — 필요한 사람만 펼친다. */
    var det = U.el("details", { style: "margin-top:14px" });
    det.appendChild(U.el("summary", { class: "gv-small gv-muted", text: "상세 데이터 (개발·점검용)" }));
    var meta = U.el("div", { class: "gv-small gv-muted", style: "margin:8px 0" });
    meta.textContent = "작업코드 " + a.op + " · 대상 " + (a.targetType || "-") + " · ID " + (a.targetId || "-");
    det.appendChild(meta);
    det.appendChild(U.el("div", { class: "gv-pre", text: "before: " + (a.before == null ? "(없음)" : JSON.stringify(a.before, null, 2)) }));
    det.appendChild(U.el("div", { class: "gv-pre", style: "margin-top:6px", text: "after: " + (a.after == null ? "(없음)" : JSON.stringify(a.after, null, 2)) }));
    body.appendChild(det);

    GV.app.modal({
      title: "변경 내용", body: body, wide: true,
      actions: [{ label: "닫기", primary: true, cancel: true }],
      onSubmit: function () { return true; }
    });
  }

  function exportCsv(state, api) {
    var header = ["시각", "작업", "대상", "바뀐 내용", "행위자", "메모",
      "작업코드", "대상유형", "대상ID", "변경전(원시)", "변경후(원시)"];
    var rows = (state.audit || []).map(function (a) {
      return [U.fmtKst(a.at), opLabel(a.op), a.targetName || TARGET_LABEL[a.targetType] || "",
        diffSummary(a), a.actor, a.note,
        a.op, a.targetType, a.targetId,
        a.before == null ? "" : JSON.stringify(a.before),
        a.after == null ? "" : JSON.stringify(a.after)];
    });
    U.download("glovek-audit-" + U.fmtDate(new Date()) + ".csv", U.toCsv([header].concat(rows)));
    api.toast(rows.length + "건의 이력을 내려받았습니다.");
  }

  GV.pages = GV.pages || {};
  GV.pages.audit = { render: render, opLabel: opLabel, diffRows: diffRows, diffSummary: diffSummary, view: view };
})(window);
