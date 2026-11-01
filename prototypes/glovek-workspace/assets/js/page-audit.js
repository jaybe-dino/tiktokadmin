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

  function render(state, api) {
    var wrap = U.el("div");
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "변경 이력" }));
    left.appendChild(U.el("p", { text: "이 브라우저에서 일어난 쓰기만 담습니다. 최근 " + S.SCHEMA * 200 + "건까지 보관합니다." }));
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
    ["시각", "작업", "대상", "내용", "행위자", "변경 전 → 후"].forEach(function (h) {
      hr.appendChild(U.el("th", { scope: "col", text: h }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = U.el("tbody");
    rows.slice(0, view.limit).forEach(function (a) {
      var tr = U.el("tr");
      tr.appendChild(U.el("td", { class: "gv-number", text: U.fmtDateTime(a.at) }));
      tr.appendChild(U.el("td", {}, [U.el("span", { class: "gv-chip", text: opLabel(a.op) })]));
      tr.appendChild(U.el("td", { text: a.targetType || "-" }));
      tr.appendChild(U.el("td", { text: a.targetName || a.note || "-" }));
      tr.appendChild(U.el("td", { text: a.actor || "-" }));
      var td = U.el("td");
      var btn = U.el("button", {
        type: "button", class: "gv-quiet", text: "보기",
        onclick: function () { showDiff(a); }
      });
      td.appendChild(btn);
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
    dl.appendChild(U.el("dt", { text: "시각" }));
    dl.appendChild(U.el("dd", { text: U.fmtDateTime(a.at) }));
    dl.appendChild(U.el("dt", { text: "작업" }));
    dl.appendChild(U.el("dd", { text: opLabel(a.op) + " (" + a.op + ")" }));
    dl.appendChild(U.el("dt", { text: "대상" }));
    dl.appendChild(U.el("dd", { text: (a.targetType || "-") + " " + (a.targetName || "") }));
    dl.appendChild(U.el("dt", { text: "행위자" }));
    dl.appendChild(U.el("dd", { text: a.actor || "-" }));
    if (a.note) {
      dl.appendChild(U.el("dt", { text: "메모" }));
      dl.appendChild(U.el("dd", { text: a.note }));
    }
    body.appendChild(dl);
    body.appendChild(U.el("h3", { text: "변경 전", style: "margin-top:14px" }));
    body.appendChild(U.el("div", { class: "gv-pre", text: a.before == null ? "(없음)" : JSON.stringify(a.before, null, 2) }));
    body.appendChild(U.el("h3", { text: "변경 후", style: "margin-top:10px" }));
    body.appendChild(U.el("div", { class: "gv-pre", text: a.after == null ? "(없음)" : JSON.stringify(a.after, null, 2) }));
    GV.app.modal({
      title: "이력 상세", body: body, wide: true,
      actions: [{ label: "닫기", primary: true, cancel: true }],
      onSubmit: function () { return true; }
    });
  }

  function exportCsv(state, api) {
    var header = ["시각", "작업코드", "작업", "대상유형", "대상ID", "대상명", "행위자", "메모", "변경전", "변경후"];
    var rows = (state.audit || []).map(function (a) {
      return [U.fmtDateTime(a.at), a.op, opLabel(a.op), a.targetType, a.targetId, a.targetName,
        a.actor, a.note,
        a.before == null ? "" : JSON.stringify(a.before),
        a.after == null ? "" : JSON.stringify(a.after)];
    });
    U.download("glovek-audit-" + U.fmtDate(new Date()) + ".csv", U.toCsv([header].concat(rows)));
    api.toast(rows.length + "건의 이력을 내려받았습니다.");
  }

  GV.pages = GV.pages || {};
  GV.pages.audit = { render: render, opLabel: opLabel, view: view };
})(window);
