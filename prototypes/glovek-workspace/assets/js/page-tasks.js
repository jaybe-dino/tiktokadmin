/* Glovek Workspace — 내 할 일
 *   오늘 / 지남 / 예정 / 완료. 업체·기회에 묶고 담당자·기한을 둔다.
 *   완료·되돌리기는 즉시 저장되고 업체의 "다음 액션" 에 반영된다.
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;
  var view = { owner: "", q: "", showDone: false };

  function buckets(list) {
    var out = { overdue: [], today: [], upcoming: [], done: [] };
    list.forEach(function (t) {
      if (t.done) { out.done.push(t); return; }
      var n = U.relDays(t.dueAt);
      if (n == null) out.upcoming.push(t);
      else if (n < 0) out.overdue.push(t);
      else if (n === 0) out.today.push(t);
      else out.upcoming.push(t);
    });
    ["overdue", "today", "upcoming"].forEach(function (k) {
      out[k].sort(function (a, b) { return (a.dueAt || "") < (b.dueAt || "") ? -1 : 1; });
    });
    out.done.sort(function (a, b) { return (a.doneAt || "") < (b.doneAt || "") ? 1 : -1; });
    return out;
  }

  function render(state, api) {
    var wrap = U.el("div");
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "내 할 일" }));
    left.appendChild(U.el("p", { text: "업체·영업 기회에 묶인 할 일입니다. 완료하면 업체 상세의 다음 액션도 함께 바뀝니다." }));
    head.appendChild(left);
    var acts = U.el("div", { class: "gv-actions" });
    acts.appendChild(GV.pages.database.btn("할 일 추가", "plus", true, function () { openTaskForm({}); }));
    head.appendChild(acts);
    wrap.appendChild(head);

    var q = U.clean(view.q).toLowerCase();
    var list = (state.tasks || []).filter(function (t) {
      if (view.owner && t.owner !== view.owner) return false;
      if (!q) return true;
      var e = M.entityById(state, t.entityId);
      return (t.title && t.title.toLowerCase().indexOf(q) >= 0) || (e && e.name.toLowerCase().indexOf(q) >= 0);
    });
    var b = buckets(list);

    var cards = U.el("div", { class: "gv-cards" });
    cards.appendChild(GV.pages.database.stat("기한 지남", b.overdue.length + "건", "먼저 처리"));
    cards.appendChild(GV.pages.database.stat("오늘", b.today.length + "건", ""));
    cards.appendChild(GV.pages.database.stat("예정", b.upcoming.length + "건", ""));
    cards.appendChild(GV.pages.database.stat("완료", b.done.length + "건", ""));
    wrap.appendChild(cards);

    var bar = U.el("div", { class: "gv-filterbar" });
    var search = U.el("div", { class: "gv-search" });
    search.appendChild(U.iconNode("search"));
    var qi = U.el("input", { type: "search", value: view.q, placeholder: "할 일·업체 검색", "aria-label": "할 일 검색" });
    qi.addEventListener("input", U.debounce(function () { view.q = qi.value; GV.app.render(); }, 220));
    search.appendChild(qi);
    bar.appendChild(search);
    bar.appendChild(GV.pages.database.select("담당자 전체",
      Array.from(new Set((state.tasks || []).map(function (t) { return t.owner; }).filter(Boolean))),
      view.owner, function (v) { view.owner = v; GV.app.render(); }, "담당자 필터"));
    var dl = U.el("label", { class: "gv-small", style: "display:flex;gap:6px;align-items:center" });
    var cb = U.el("input", { type: "checkbox", checked: view.showDone });
    cb.addEventListener("change", function () { view.showDone = cb.checked; GV.app.render(); });
    dl.appendChild(cb);
    dl.appendChild(document.createTextNode("완료 보기"));
    bar.appendChild(dl);
    wrap.appendChild(bar);

    [["기한 지남", b.overdue], ["오늘", b.today], ["예정", b.upcoming]].forEach(function (g) {
      wrap.appendChild(group(state, g[0], g[1], api));
    });
    if (view.showDone) wrap.appendChild(group(state, "완료", b.done, api));
    return wrap;
  }

  function group(state, label, items, api) {
    var sec = U.el("div", { style: "margin-top:18px" });
    sec.appendChild(U.el("h2", { text: label + " " + items.length + "건" }));
    if (!items.length) {
      sec.appendChild(U.el("p", { class: "gv-small gv-muted", style: "margin-top:6px", text: "없습니다." }));
      return sec;
    }
    var box = U.el("div", { class: "gv-list", style: "margin-top:8px" });
    items.forEach(function (t) { box.appendChild(taskRow(state, t, api)); });
    sec.appendChild(box);
    return sec;
  }

  function taskRow(state, t, api) {
    var e = M.entityById(state, t.entityId);
    var row = U.el("div", { class: "gv-task" + (t.done ? " done" : "") });
    var g = U.el("div", { class: "gv-task-group" });
    var cb = U.el("input", { type: "checkbox", checked: !!t.done, "aria-label": t.title + " 완료" });
    cb.addEventListener("change", function () { toggle(t.id, cb.checked, api); });
    g.appendChild(cb);
    var body = U.el("div");
    body.appendChild(U.el("strong", { text: t.title }));
    var meta = U.el("p");
    var bits = [];
    if (e) bits.push(e.name);
    bits.push(t.owner || "미배정");
    if (t.dueAt) bits.push(U.fmtDate(t.dueAt) + " (" + U.relLabel(t.dueAt) + ")");
    if (t.dealId) {
      var d = M.dealById(state, t.dealId);
      if (d) bits.push("기회: " + d.service);
    }
    meta.textContent = bits.join(" · ");
    body.appendChild(meta);
    g.appendChild(body);
    row.appendChild(g);
    var acts = U.el("div", { class: "gv-actions" });
    if (!t.done && U.relDays(t.dueAt) < 0) acts.appendChild(U.el("span", { class: "gv-chip bad", text: "지남" }));
    if (e) acts.appendChild(U.el("button", { type: "button", class: "gv-quiet", text: "업체", onclick: function () { GV.app.openDetail(e.id); } }));
    acts.appendChild(U.el("button", { type: "button", class: "gv-quiet", text: "수정", onclick: function () { openTaskForm({ id: t.id }); } }));
    row.appendChild(acts);
    return row;
  }

  function toggle(taskId, done, api) {
    var r = S.tx({ op: done ? "task.complete" : "task.reopen", targetType: "task", targetId: taskId, note: done ? "할 일 완료" : "할 일 재개" }, function (draft) {
      var t = (draft.tasks || []).find(function (x) { return x.id === taskId; });
      if (!t) return { ok: false, error: "할 일을 찾지 못했습니다." };
      var before = { done: t.done };
      t.done = !!done;
      t.doneAt = done ? U.nowIso() : null;
      M.refreshNextAction(draft, t.entityId);
      return { ok: true, audit: { targetName: t.title, before: before, after: { done: t.done } } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "bad" }); return; }
    api.toast(done ? "완료로 저장했습니다." : "다시 진행으로 바꿨습니다.", { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
  }

  function openTaskForm(opts) {
    opts = opts || {};
    var state = S.get();
    var task = opts.id ? (state.tasks || []).find(function (t) { return t.id === opts.id; }) : null;
    var body = U.el("div", { class: "gv-form-grid" });

    var w0 = U.el("label", { class: "gv-form-label gv-span" });
    w0.appendChild(U.el("span", { text: "할 일 *" }));
    w0.appendChild(U.el("input", { name: "title", type: "text", value: task ? task.title : "", maxlength: "120", placeholder: "예: 제안서 초안 작성" }));
    body.appendChild(w0);

    var entId = task ? task.entityId : opts.entityId;
    var w1 = U.el("label", { class: "gv-form-label gv-span" });
    w1.appendChild(U.el("span", { text: "업체" }));
    var es = U.el("select", { name: "entityId" });
    es.appendChild(U.el("option", { value: "", text: "(연결 없음)" }));
    state.entities.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); }).forEach(function (e) {
      es.appendChild(U.el("option", { value: e.id, text: e.name, selected: e.id === entId }));
    });
    w1.appendChild(es);
    body.appendChild(w1);

    var w2 = U.el("label", { class: "gv-form-label gv-span" });
    w2.appendChild(U.el("span", { text: "영업 기회" }));
    var ds = U.el("select", { name: "dealId" });
    ds.appendChild(U.el("option", { value: "", text: "(연결 없음)" }));
    (state.deals || []).forEach(function (d) {
      var e = M.entityById(state, d.entityId);
      ds.appendChild(U.el("option", {
        value: d.id, text: (e ? e.name : "") + " · " + d.service,
        selected: d.id === (task ? task.dealId : opts.dealId)
      }));
    });
    w2.appendChild(ds);
    body.appendChild(w2);

    var w3 = U.el("label", { class: "gv-form-label" });
    w3.appendChild(U.el("span", { text: "담당자" }));
    var os = U.el("select", { name: "owner" });
    state.members.forEach(function (m) {
      os.appendChild(U.el("option", { value: m.name, text: m.name, selected: task && task.owner === m.name }));
    });
    w3.appendChild(os);
    body.appendChild(w3);

    var w4 = U.el("label", { class: "gv-form-label" });
    w4.appendChild(U.el("span", { text: "기한 *" }));
    w4.appendChild(U.el("input", { name: "dueAt", type: "date", value: task && task.dueAt ? U.fmtDate(task.dueAt) : U.fmtDate(new Date()) }));
    body.appendChild(w4);

    GV.app.modal({
      title: task ? "할 일 수정" : "할 일 추가", body: body, wide: true,
      actions: [{ label: task ? "저장" : "추가", primary: true }],
      onSubmit: function (v) {
        var title = U.clean(v.title, 120);
        if (!title) return "할 일 내용을 입력해 주세요.";
        var due = U.parseDate(v.dueAt);
        if (!due) return "기한을 올바른 날짜로 입력해 주세요.";
        var r = S.tx({
          op: task ? "task.update" : "task.create", targetType: "task",
          targetId: task ? task.id : "", note: task ? "할 일 수정" : "할 일 추가"
        }, function (draft) {
          if (task) {
            var t = (draft.tasks || []).find(function (x) { return x.id === task.id; });
            if (!t) return { ok: false, error: "할 일을 찾지 못했습니다." };
            var before = { title: t.title, dueAt: t.dueAt, owner: t.owner };
            var oldEntity = t.entityId;
            t.title = title; t.entityId = v.entityId || null; t.dealId = v.dealId || null;
            t.owner = v.owner; t.dueAt = due.toISOString();
            if (oldEntity) M.refreshNextAction(draft, oldEntity);
            if (t.entityId) M.refreshNextAction(draft, t.entityId);
            return { ok: true, audit: { targetName: title, before: before, after: { title: title, dueAt: t.dueAt, owner: t.owner } } };
          }
          var nt = {
            id: U.uid("task"), title: title, entityId: v.entityId || null, dealId: v.dealId || null,
            owner: v.owner, dueAt: due.toISOString(), done: false, doneAt: null, createdAt: U.nowIso()
          };
          draft.tasks.unshift(nt);
          if (nt.entityId) M.refreshNextAction(draft, nt.entityId);
          return { ok: true, audit: { targetId: nt.id, targetName: title, after: { title: title, dueAt: nt.dueAt } } };
        });
        if (!r.ok) return r.error;
        GV.app.toast(task ? "할 일을 수정했습니다." : "할 일을 추가했습니다.", { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
        return true;
      }
    });
  }

  GV.pages = GV.pages || {};
  GV.pages.tasks = { render: render, openTaskForm: openTaskForm, view: view };
})(window);
