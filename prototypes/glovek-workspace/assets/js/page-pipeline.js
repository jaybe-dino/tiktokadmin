/* Glovek Workspace — 영업 보드
 *   영업 기회(deal)는 업체 DB 와 별개 레코드다. 한 업체에 여러 서비스 기회를 둘 수 있지만
 *   같은 서비스로 "진행 중" 기회가 둘이 되는 것은 막는다.
 *   금액은 전부 "우리 회사 금액" 이다. 고객사 연매출은 참고로만 보여 준다.
 *   이동: 포인터 드래그(시안 로직 재사용) + 키보드(Space 잡기, ←→ 이동) + 단계 드롭다운.
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;

  var view = { owner: "", q: "", showClosed: true, grabbed: null };
  var lastMove = null;   /* 되돌리기 1회분 */

  function openDeals(state) {
    return (state.deals || []).filter(function (d) { return d.status === "open"; });
  }

  function render(state, api) {
    var wrap = U.el("div");
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "영업 보드" }));
    left.appendChild(U.el("p", { text: "카드를 끌어 단계를 옮기거나, 손잡이에서 Space 로 잡고 ← → 로 옮길 수 있습니다. 금액은 우리 회사 계약 금액입니다." }));
    head.appendChild(left);
    var acts = U.el("div", { class: "gv-actions" });
    acts.appendChild(GV.pages.database.btn("새 영업 기회", "plus", true, function () { openDealForm(null); }));
    if (lastMove) {
      acts.appendChild(GV.pages.database.btn("마지막 이동 되돌리기", "undo", false, function () { undo(api); }));
    }
    head.appendChild(acts);
    wrap.appendChild(head);

    /* 필터 */
    var bar = U.el("div", { class: "gv-filterbar" });
    var search = U.el("div", { class: "gv-search" });
    search.appendChild(U.iconNode("search"));
    var qi = U.el("input", { type: "search", value: view.q, placeholder: "업체명·서비스 검색", "aria-label": "기회 검색" });
    qi.addEventListener("input", U.debounce(function () { view.q = qi.value; GV.app.render(); }, 220));
    search.appendChild(qi);
    bar.appendChild(search);
    bar.appendChild(GV.pages.database.select("담당자 전체",
      Array.from(new Set((state.deals || []).map(function (d) { return d.owner; }).filter(Boolean))),
      view.owner, function (v) { view.owner = v; GV.app.render(); }, "담당자 필터"));
    var cl = U.el("label", { class: "gv-small", style: "display:flex;gap:6px;align-items:center" });
    var cb = U.el("input", { type: "checkbox", checked: view.showClosed });
    cb.addEventListener("change", function () { view.showClosed = cb.checked; GV.app.render(); });
    cl.appendChild(cb);
    cl.appendChild(document.createTextNode("종료(수주·보류·실패) 보기"));
    bar.appendChild(cl);
    wrap.appendChild(bar);

    var deals = matchAll(state, openDeals(state));
    var total = deals.reduce(function (n, d) { return n + (d.expectedAmount || 0); }, 0);
    var top = U.el("div", { class: "gv-board-top" });
    top.appendChild(U.el("span", { text: "진행 중 " + deals.length + "건 · 예상 계약 합계 " + U.won(total) + " (우리 금액)" }));
    top.appendChild(U.el("span", { text: "고객사 연매출은 카드 안에 따로 표시됩니다." }));
    wrap.appendChild(top);

    /* 보드 */
    var board = U.el("div", { class: "gv-board" });
    M.STAGES.forEach(function (st) {
      var inLane = deals.filter(function (d) { return d.stage === st.id; });
      var lane = U.el("div", { class: "gv-lane", "data-drop": st.id, role: "list", "aria-label": st.label + " 단계" });
      var lh = U.el("div", { class: "gv-lane-head" });
      lh.appendChild(U.el("span", { text: st.label }));
      lh.appendChild(U.el("span", { class: "gv-muted", text: String(inLane.length) }));
      lane.appendChild(lh);
      lane.appendChild(U.el("div", {
        class: "gv-lane-sum",
        text: inLane.length ? U.won(inLane.reduce(function (n, d) { return n + (d.expectedAmount || 0); }, 0)) : "금액 없음"
      }));
      var body = U.el("div", { class: "gv-lane-body" });
      if (!inLane.length) body.appendChild(U.el("div", { class: "gv-small gv-muted", style: "padding:8px 4px", text: "비어 있음" }));
      inLane.forEach(function (d) { body.appendChild(card(state, d, api)); });
      lane.appendChild(body);
      board.appendChild(lane);
    });
    wrap.appendChild(board);
    wireDrag(wrap, api);

    /* 종료된 기회 */
    if (view.showClosed) {
      var closed = matchAll(state, (state.deals || []).filter(function (d) { return d.status !== "open"; }));
      var sec = U.el("div", { style: "margin-top:22px" });
      sec.appendChild(U.el("h2", { text: "종료된 기회 " + closed.length + "건" }));
      if (!closed.length) sec.appendChild(U.el("p", { class: "gv-small gv-muted", text: "아직 없습니다." }));
      var grid = U.el("div", { class: "gv-closed" });
      closed.forEach(function (d) {
        var e = M.entityById(state, d.entityId);
        var c = U.el("article", { class: "gv-deal" });
        var t = U.el("div", { class: "gv-deal-title" });
        t.appendChild(U.el("button", { type: "button", class: "gv-company", text: e ? e.name : "(삭제됨)", onclick: function () { openDealDetail(d.id); } }));
        t.appendChild(U.el("span", { class: "gv-chip " + (d.status === "won" ? "ok" : d.status === "lost" ? "bad" : "warn"), text: M.STATUS[d.status] }));
        c.appendChild(t);
        c.appendChild(U.el("div", { class: "gv-deal-product", text: d.service }));
        c.appendChild(U.el("div", { class: "gv-deal-money", text: GV.pages.detail.ourMoney(d) }));
        if (d.reason) c.appendChild(U.el("div", { class: "gv-deal-revenue", text: "사유: " + d.reason }));
        var row = U.el("div", { class: "gv-deal-bottom" });
        row.appendChild(U.el("span", { class: "gv-small gv-muted", text: d.owner }));
        row.appendChild(U.el("button", { type: "button", class: "gv-quiet", text: "진행으로 되돌리기", onclick: function () { reopen(d.id, api); } }));
        c.appendChild(row);
        grid.appendChild(c);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    }
    return wrap;
  }

  function matchAll(state, list) {
    var q = U.clean(view.q).toLowerCase();
    return list.filter(function (d) {
      if (view.owner && d.owner !== view.owner) return false;
      if (!q) return true;
      var e = M.entityById(state, d.entityId);
      return (d.service && d.service.toLowerCase().indexOf(q) >= 0) || (e && e.name.toLowerCase().indexOf(q) >= 0);
    });
  }

  function card(state, d, api) {
    var e = M.entityById(state, d.entityId);
    var art = U.el("article", {
      class: "gv-deal" + (view.grabbed === d.id ? " is-grabbed" : ""),
      "data-drag": d.id, role: "listitem",
      "aria-label": (e ? e.name : "") + " " + d.service + " 영업 기회"
    });
    var t = U.el("div", { class: "gv-deal-title" });
    t.appendChild(U.el("button", { type: "button", class: "gv-company", text: e ? e.name : "(삭제된 업체)", onclick: function () { openDealDetail(d.id); } }));
    var handle = U.el("button", {
      type: "button", class: "gv-handle", "data-grab": d.id,
      "aria-label": (e ? e.name : "") + " 카드 이동 — Space 로 잡고 좌우 방향키로 옮기기",
      "aria-pressed": view.grabbed === d.id ? "true" : "false",
      html: U.icon("grip")
    });
    t.appendChild(handle);
    art.appendChild(t);
    art.appendChild(U.el("div", { class: "gv-deal-product", text: d.service }));
    art.appendChild(U.el("div", { class: "gv-deal-money", text: d.expectedAmount != null ? "예상 " + U.won(d.expectedAmount) : "금액 미정" }));
    art.appendChild(U.el("div", { class: "gv-deal-revenue", text: "고객사 연매출 " + (e && e.revenue && e.revenue.amount != null ? U.won(e.revenue.amount) + " (" + (M.SCOPES[e.revenue.scope] || "범위 미확인") + ")" : "미확인") }));
    if (e) art.appendChild(U.el("div", { class: "gv-deal-revenue", text: "유입 " + (e.source || "미기록") }));
    var over = d.nextActionAt && U.relDays(d.nextActionAt) < 0;
    var next = U.el("div", { class: "gv-deal-next" + (over ? " overdue" : "") });
    next.appendChild(U.iconNode("clock", 14));
    next.appendChild(U.el("span", {
      text: d.nextActionAt ? U.fmtShort(d.nextActionAt) + " " + (d.nextAction || "다음 액션") + " · " + U.relLabel(d.nextActionAt) : "다음 액션 없음"
    }));
    art.appendChild(next);
    var bottom = U.el("div", { class: "gv-deal-bottom" });
    bottom.appendChild(U.el("span", { class: "gv-avatar", title: "담당자 " + d.owner, text: (d.owner || "?").slice(0, 1) }));
    var sel = U.el("select", { class: "gv-stage-small", "data-stage": d.id, "aria-label": d.service + " 단계 변경" });
    M.STAGES.forEach(function (s) {
      sel.appendChild(U.el("option", { value: s.id, text: s.label, selected: d.stage === s.id }));
    });
    sel.appendChild(U.el("option", { value: "won", text: "수주 완료" }));
    sel.appendChild(U.el("option", { value: "hold", text: "보류" }));
    sel.appendChild(U.el("option", { value: "lost", text: "실패" }));
    sel.addEventListener("change", function () { requestMove(d.id, sel.value, api); });
    bottom.appendChild(sel);
    art.appendChild(bottom);
    return art;
  }

  /* ── 이동(포인터·키보드) ────────────────────── */
  function wireDrag(scope, api) {
    scope.querySelectorAll("[data-grab]").forEach(function (b) {
      b.onpointerdown = function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        var id = b.dataset.grab, x = e.clientX, y = e.clientY, moved = false;
        b.setPointerCapture(e.pointerId);
        var clear = function () { scope.querySelectorAll(".is-over").forEach(function (z) { z.classList.remove("is-over"); }); };
        b.onpointermove = function (p) {
          if (Math.hypot(p.clientX - x, p.clientY - y) > 8) moved = true;
          if (!moved) return;
          var cardEl = b.closest("[data-drag]");
          if (cardEl) cardEl.classList.add("is-grabbed");
          clear();
          var lane = document.elementFromPoint(p.clientX, p.clientY);
          lane = lane && lane.closest("[data-drop]");
          if (lane) lane.classList.add("is-over");
        };
        b.onpointerup = function (p) {
          var el = document.elementFromPoint(p.clientX, p.clientY);
          var lane = el && el.closest("[data-drop]");
          b.onpointermove = null; b.onpointerup = null;
          clear();
          if (b.hasPointerCapture(p.pointerId)) b.releasePointerCapture(p.pointerId);
          var c = b.closest("[data-drag]");
          if (c) c.classList.remove("is-grabbed");
          if (moved && lane) requestMove(id, lane.dataset.drop, api);
        };
        b.onpointercancel = function () {
          clear(); b.onpointermove = null; b.onpointerup = null;
          var c = b.closest("[data-drag]");
          if (c) c.classList.remove("is-grabbed");
        };
      };
      b.addEventListener("keydown", function (e) {
        var id = b.dataset.grab;
        var d = M.dealById(S.get(), id);
        if (!d) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          view.grabbed = view.grabbed === id ? null : id;
          GV.app.render();
          var again = document.querySelector('[data-grab="' + id + '"]');
          if (again) again.focus();
          GV.app.toast(view.grabbed ? "카드를 잡았습니다. ← → 로 단계를 옮기고 Space 로 놓으세요." : "카드를 놓았습니다.");
        } else if (view.grabbed === id && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          var i = M.stageIndex(d.stage);
          var ni = Math.max(0, Math.min(M.STAGES.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
          if (ni === i) return;
          requestMove(id, M.STAGES[ni].id, api, function () {
            var again2 = document.querySelector('[data-grab="' + id + '"]');
            if (again2) again2.focus();
          });
        }
      });
    });
    scope.querySelectorAll("[data-drop]").forEach(function (lane) {
      lane.addEventListener("pointerenter", function () { /* 호버 표시는 드래그 중에만 */ });
    });
  }

  /**
   * 단계 이동 요청. 추가 입력이 필요한 단계는 먼저 물어보고,
   * 취소하면 카드가 그대로 남는다(값이 바뀌지 않는다).
   */
  function requestMove(dealId, target, api, after) {
    var state = S.get();
    var d = M.dealById(state, dealId);
    if (!d) { api.toast("기회를 찾지 못했습니다.", { kind: "warn" }); return; }
    var isStatus = target === "won" || target === "hold" || target === "lost";
    if (!isStatus && !M.STAGES.some(function (s) { return s.id === target; })) return;
    if (!isStatus && d.stage === target) return;

    var req = M.moveRequirements(target);
    if (!req) { applyMove(dealId, target, {}, api, after); return; }

    var body = U.el("div", { class: "gv-form-grid" });
    function field(name, label, type, value, opts) {
      var w = U.el("label", { class: "gv-form-label" + (opts && opts.span ? " gv-span" : "") });
      w.appendChild(U.el("span", { text: label }));
      var node;
      if (type === "select") {
        node = U.el("select", { name: name });
        (opts.options || []).forEach(function (o) {
          node.appendChild(U.el("option", { value: o[0], text: o[1], selected: o[0] === value }));
        });
      } else if (type === "textarea") {
        node = U.el("textarea", { name: name, rows: "3", maxlength: "300" });
        node.value = value || "";
      } else {
        node = U.el("input", { name: name, type: type, value: value == null ? "" : value });
      }
      w.appendChild(node);
      body.appendChild(w);
    }
    if (req.fields.indexOf("expectedAmount") >= 0) field("expectedAmount", "예상 계약 금액(원) *", "text", d.expectedAmount);
    if (req.fields.indexOf("contractAmount") >= 0) field("contractAmount", "확정 계약 금액(원) *", "text", d.contractAmount || d.expectedAmount);
    if (req.fields.indexOf("contractDate") >= 0) field("contractDate", target === "won" ? "계약일 *" : "계약 예정일 *", "date", d.contractDate || U.fmtDate(new Date()));
    if (req.fields.indexOf("revenueScope") >= 0) {
      field("revenueScope", "매출 인식 범위 *", "select", d.revenueScope || "", {
        options: [["", "선택하세요"], ["company_separate", "회사 별도"], ["company_consolidated", "회사 연결"]], span: true
      });
    }
    if (req.fields.indexOf("reason") >= 0) field("reason", "사유 *", "textarea", d.reason, { span: true });

    GV.app.modal({
      title: req.title, help: req.help, body: body,
      actions: [{ label: "확인", primary: true }],
      onSubmit: function (v) {
        var check = M.validateMove(target, v);
        if (!check.ok) return check.errors.join(" ");
        applyMove(dealId, target, check.patch, api, after);
        return true;
      }
    });
  }

  function applyMove(dealId, target, patch, api, after) {
    var isStatus = target === "won" || target === "hold" || target === "lost";
    var snapshot = null;
    var r = S.tx({ op: "deal.move", targetType: "deal", targetId: dealId, note: "단계 이동 → " + (isStatus ? M.STATUS[target] : M.stageLabel(target)) }, function (draft) {
      var d = M.dealById(draft, dealId);
      if (!d) return { ok: false, error: "기회를 찾지 못했습니다." };
      snapshot = JSON.parse(JSON.stringify(d));
      var before = { stage: d.stage, status: d.status };
      Object.assign(d, patch);
      if (isStatus) {
        d.status = target;
        d.closedAt = U.nowIso();
        if (target === "won") d.stage = "contract_review";
        d.nextAction = ""; d.nextActionAt = null;
      } else {
        d.stage = target;
        d.status = "open";
        d.closedAt = null;
      }
      d.updatedAt = U.nowIso();
      M.refreshNextAction(draft, d.entityId);
      return { ok: true, entityId: d.entityId, audit: { targetName: M.entityName(draft, d.entityId) + " · " + d.service, before: before, after: { stage: d.stage, status: d.status } } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "bad" }); return; }
    lastMove = snapshot;
    api.toast((isStatus ? M.STATUS[target] + " 로 기록했습니다." : M.stageLabel(target) + " 로 옮겼습니다.")
      + (r.warning ? " (" + r.warning + ")" : ""), {
      kind: r.warning ? "warn" : "ok", sticky: !!r.warning,
      action: "되돌리기", onAction: function () { undo(api); }
    });
    if (after) setTimeout(after, 0);
  }

  function undo(api) {
    if (!lastMove) { api.toast("되돌릴 이동이 없습니다.", { kind: "warn" }); return; }
    var snap = lastMove;
    var r = S.tx({ op: "deal.undo", targetType: "deal", targetId: snap.id, note: "마지막 이동 되돌리기" }, function (draft) {
      var i = (draft.deals || []).findIndex(function (d) { return d.id === snap.id; });
      if (i < 0) return { ok: false, error: "되돌릴 기회가 이미 없습니다." };
      var before = { stage: draft.deals[i].stage, status: draft.deals[i].status };
      draft.deals[i] = JSON.parse(JSON.stringify(snap));
      M.refreshNextAction(draft, snap.entityId);
      return { ok: true, audit: { targetName: M.entityName(draft, snap.entityId) + " · " + snap.service, before: before, after: { stage: snap.stage, status: snap.status } } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "warn" }); return; }
    lastMove = null;
    api.toast("되돌렸습니다.");
  }

  function reopen(dealId, api) {
    var r = S.tx({ op: "deal.reopen", targetType: "deal", targetId: dealId, note: "진행으로 되돌림" }, function (draft) {
      var d = M.dealById(draft, dealId);
      if (!d) return { ok: false, error: "기회를 찾지 못했습니다." };
      var dup = M.duplicateDeal(draft, d.entityId, d.service, d.id);
      if (dup) return { ok: false, error: "같은 업체에 같은 서비스로 진행 중인 기회가 이미 있습니다." };
      var before = { status: d.status };
      d.status = "open"; d.closedAt = null; d.reason = "";
      d.updatedAt = U.nowIso();
      return { ok: true, audit: { targetName: M.entityName(draft, d.entityId) + " · " + d.service, before: before, after: { status: "open" } } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "warn" }); return; }
    api.toast("진행 중으로 되돌렸습니다.");
  }

  /* ── 기회 만들기·수정 ──────────────────────── */
  function openDealForm(entityId, dealId) {
    var state = S.get();
    var deal = dealId ? M.dealById(state, dealId) : null;
    var body = U.el("div", { class: "gv-form-grid" });
    var entSel = U.el("select", { name: "entityId" });
    state.entities.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); })
      .forEach(function (e) {
        entSel.appendChild(U.el("option", {
          value: e.id, text: e.name + " (" + (M.KINDS[e.kind] || "") + ")",
          selected: e.id === (deal ? deal.entityId : entityId)
        }));
      });
    var w1 = U.el("label", { class: "gv-form-label gv-span" });
    w1.appendChild(U.el("span", { text: "업체 *" }));
    w1.appendChild(entSel);
    body.appendChild(w1);

    function field(name, label, type, value, opts) {
      var w = U.el("label", { class: "gv-form-label" + (opts && opts.span ? " gv-span" : "") });
      w.appendChild(U.el("span", { text: label }));
      var node;
      if (type === "select") {
        node = U.el("select", { name: name });
        (opts.options || []).forEach(function (o) {
          node.appendChild(U.el("option", { value: o[0], text: o[1], selected: String(o[0]) === String(value || "") }));
        });
      } else {
        node = U.el("input", { name: name, type: type, value: value == null ? "" : value });
        if (opts && opts.placeholder) node.setAttribute("placeholder", opts.placeholder);
      }
      w.appendChild(node);
      if (opts && opts.hint) w.appendChild(U.el("span", { class: "gv-small gv-muted", text: opts.hint }));
      body.appendChild(w);
    }
    field("service", "서비스 *", "text", deal ? deal.service : "", { placeholder: "예: 틱톡샵 일본 운영", span: true });
    field("stage", "단계", "select", deal ? deal.stage : "contact_planned", {
      options: M.STAGES.map(function (s) { return [s.id, s.label]; })
    });
    field("owner", "담당자", "select", deal ? deal.owner : "", {
      options: state.members.map(function (m) { return [m.name, m.name]; })
    });
    field("expectedAmount", "예상 계약 금액(원)", "text", deal ? deal.expectedAmount : "", {
      hint: "우리 회사가 받을 금액입니다. 고객사 연매출이 아닙니다."
    });
    field("nextAction", "다음 액션", "text", deal ? deal.nextAction : "", { placeholder: "예: 제안서 공유" });
    field("nextActionAt", "다음 액션 일자", "date", deal && deal.nextActionAt ? U.fmtDate(deal.nextActionAt) : U.fmtDate(U.addDays(new Date(), 2)));

    GV.app.modal({
      title: deal ? "영업 기회 수정" : "새 영업 기회", wide: true, body: body,
      help: deal ? "" : "업체 DB 와 별개 레코드입니다. 같은 업체에 여러 서비스 기회를 만들 수 있습니다.",
      actions: [{ label: deal ? "저장" : "만들기", primary: true }],
      onSubmit: function (v) {
        var service = U.clean(v.service, 80);
        if (!service) return "서비스명을 입력해 주세요.";
        var amount = v.expectedAmount === "" ? null : U.intOrNull(v.expectedAmount);
        if (v.expectedAmount !== "" && (amount == null || amount < 0 || amount > 1e12)) return "예상 계약 금액을 숫자로 입력해 주세요.";
        var naAt = v.nextActionAt ? U.parseDate(v.nextActionAt) : null;
        if (v.nextActionAt && !naAt) return "다음 액션 일자를 올바른 날짜로 입력해 주세요.";
        var r = S.tx({
          op: deal ? "deal.update" : "deal.create", targetType: "deal",
          targetId: deal ? deal.id : "", note: deal ? "기회 수정" : "기회 생성"
        }, function (draft) {
          var dup = M.duplicateDeal(draft, v.entityId, service, deal ? deal.id : null);
          if (dup) return { ok: false, error: "같은 업체에 같은 서비스로 진행 중인 기회가 이미 있습니다. 기존 기회를 여세요." };
          if (deal) {
            var d = M.dealById(draft, deal.id);
            if (!d) return { ok: false, error: "기회를 찾지 못했습니다." };
            var before = JSON.parse(JSON.stringify({ service: d.service, stage: d.stage, expectedAmount: d.expectedAmount }));
            d.entityId = v.entityId; d.service = service; d.stage = v.stage;
            d.owner = v.owner; d.expectedAmount = amount;
            d.nextAction = U.clean(v.nextAction, 80);
            d.nextActionAt = naAt ? naAt.toISOString() : null;
            d.updatedAt = U.nowIso();
            M.refreshNextAction(draft, d.entityId);
            return { ok: true, id: d.id, audit: { targetName: M.entityName(draft, d.entityId) + " · " + service, before: before, after: { service: service, stage: d.stage, expectedAmount: amount } } };
          }
          var nd = {
            id: U.uid("deal"), entityId: v.entityId, service: service, stage: v.stage, status: "open",
            expectedAmount: amount, contractAmount: null, contractDate: null, revenueScope: "", reason: "",
            owner: v.owner || "미배정", nextAction: U.clean(v.nextAction, 80),
            nextActionAt: naAt ? naAt.toISOString() : null,
            createdAt: U.nowIso(), updatedAt: U.nowIso(), closedAt: null
          };
          draft.deals.unshift(nd);
          M.refreshNextAction(draft, nd.entityId);
          return { ok: true, id: nd.id, audit: { targetId: nd.id, targetName: M.entityName(draft, nd.entityId) + " · " + service, after: { service: service, stage: nd.stage } } };
        });
        if (!r.ok) return r.error;
        GV.app.toast(deal ? "기회를 수정했습니다." : "기회를 만들었습니다.", { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
        return true;
      }
    });
  }

  function openDealDetail(dealId) {
    var state = S.get();
    var d = M.dealById(state, dealId);
    if (!d) { GV.app.toast("기회를 찾지 못했습니다.", { kind: "warn" }); return; }
    var e = M.entityById(state, d.entityId);
    var body = U.el("div");
    var dl = U.el("dl", { class: "gv-kv" });
    function kv(k, v) { dl.appendChild(U.el("dt", { text: k })); dl.appendChild(U.el("dd", { text: v })); }
    kv("업체", e ? e.name : "(삭제됨)");
    kv("서비스", d.service);
    kv("상태", d.status === "open" ? "진행 · " + M.stageLabel(d.stage) : M.STATUS[d.status]);
    kv("담당자", d.owner);
    kv("예상 계약(우리 금액)", d.expectedAmount != null ? U.won(d.expectedAmount) : "미정");
    kv("확정 계약(우리 금액)", d.contractAmount != null ? U.won(d.contractAmount) : "미정");
    kv("계약(예정)일", d.contractDate || "미정");
    kv("매출 인식 범위", d.revenueScope ? M.SCOPES[d.revenueScope] : "미정");
    kv("다음 액션", d.nextActionAt ? U.fmtDate(d.nextActionAt) + " · " + (d.nextAction || "") : "없음");
    kv("생성", U.fmtDateTime(d.createdAt));
    kv("마지막 수정", U.fmtDateTime(d.updatedAt));
    if (d.reason) kv("사유", d.reason);
    kv("고객사 연매출", e && e.revenue && e.revenue.amount != null ? U.won(e.revenue.amount) + " · " + (M.SCOPES[e.revenue.scope] || "범위 미확인") : "미확인");
    body.appendChild(dl);
    body.appendChild(U.el("p", { class: "gv-small gv-muted", style: "margin-top:10px", text: "계약 금액은 우리 회사 금액입니다. 고객사 연매출과 다릅니다." }));
    var row = U.el("div", { class: "gv-actions", style: "margin-top:14px" });
    row.appendChild(U.el("button", { type: "button", text: "업체 상세 열기", onclick: function () { GV.app.openDetail(d.entityId); } }));
    row.appendChild(U.el("button", { type: "button", text: "기회 수정", onclick: function () { openDealForm(null, d.id); } }));
    row.appendChild(U.el("button", { type: "button", text: "할 일 추가", onclick: function () { GV.pages.tasks.openTaskForm({ entityId: d.entityId, dealId: d.id }); } }));
    body.appendChild(row);

    GV.app.modal({
      title: (e ? e.name : "") + " · " + d.service, body: body, wide: true,
      actions: [{ label: "닫기", primary: true, cancel: true }],
      onSubmit: function () { return true; }
    });
  }

  GV.pages = GV.pages || {};
  GV.pages.pipeline = {
    render: render, openDealForm: openDealForm, openDealDetail: openDealDetail,
    requestMove: requestMove, undo: undo, view: view
  };
})(window);
