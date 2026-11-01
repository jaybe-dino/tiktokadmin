/* Glovek Workspace — 커뮤니케이션
 *   수기 기록 전용이다. 메일을 보내지 않고, 메일함이 연결됐다고 말하지 않는다.
 *   기록하면 업체 상세 타임라인과 "최근 커뮤니케이션" 이 같이 바뀐다.
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;
  var view = { q: "", channel: "", direction: "", owner: "", entityId: "" };

  function focusEntity(id) { view.entityId = id; }

  function render(state, api) {
    var wrap = U.el("div");
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "커뮤니케이션" }));
    left.appendChild(U.el("p", { text: "통화·미팅·메일 내용을 직접 적어 두는 곳입니다. 이 화면은 메시지를 보내지 않습니다." }));
    head.appendChild(left);
    var acts = U.el("div", { class: "gv-actions" });
    acts.appendChild(GV.pages.database.btn("기록 남기기", "plus", true, function () { openCommForm({}); }));
    acts.appendChild(GV.pages.database.btn("기록 내보내기", "download", false, function () { exportCsv(state, api); }));
    head.appendChild(acts);
    wrap.appendChild(head);

    wrap.appendChild(GV.app.banner("info",
      "메일 연동은 연결되어 있지 않습니다(not connected). 받은 메일이 자동으로 들어오지 않으며, 여기 보이는 내용은 사람이 직접 적은 기록입니다."));

    var bar = U.el("div", { class: "gv-filterbar" });
    var search = U.el("div", { class: "gv-search" });
    search.appendChild(U.iconNode("search"));
    var qi = U.el("input", { type: "search", value: view.q, placeholder: "내용·업체·결과 검색", "aria-label": "기록 검색" });
    qi.addEventListener("input", U.debounce(function () { view.q = qi.value; GV.app.render(); }, 220));
    search.appendChild(qi);
    bar.appendChild(search);
    bar.appendChild(GV.pages.database.select("채널 전체", Object.keys(M.CHANNELS), view.channel,
      function (v) { view.channel = v; GV.app.render(); }, "채널 필터", M.CHANNELS));
    bar.appendChild(GV.pages.database.select("방향 전체", Object.keys(M.DIRECTIONS), view.direction,
      function (v) { view.direction = v; GV.app.render(); }, "방향 필터", M.DIRECTIONS));
    bar.appendChild(GV.pages.database.select("담당자 전체",
      Array.from(new Set((state.comms || []).map(function (c) { return c.owner; }).filter(Boolean))),
      view.owner, function (v) { view.owner = v; GV.app.render(); }, "담당자 필터"));
    if (view.entityId) {
      var e = M.entityById(state, view.entityId);
      bar.appendChild(U.el("button", {
        type: "button", text: (e ? e.name : "업체") + " 만 보기 해제",
        onclick: function () { view.entityId = ""; GV.app.render(); }
      }));
    }
    bar.appendChild(U.el("button", {
      type: "button", text: "필터 초기화",
      onclick: function () { view.q = ""; view.channel = ""; view.direction = ""; view.owner = ""; view.entityId = ""; GV.app.render(); }
    }));
    wrap.appendChild(bar);

    var q = U.clean(view.q).toLowerCase();
    var rows = (state.comms || []).filter(function (c) {
      if (view.entityId && c.entityId !== view.entityId) return false;
      if (view.channel && c.channel !== view.channel) return false;
      if (view.direction && c.direction !== view.direction) return false;
      if (view.owner && c.owner !== view.owner) return false;
      if (!q) return true;
      var e = M.entityById(state, c.entityId);
      return [c.body, c.outcome, e && e.name].some(function (f) { return f && String(f).toLowerCase().indexOf(q) >= 0; });
    }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });

    var cards = U.el("div", { class: "gv-cards" });
    cards.appendChild(GV.pages.database.stat("전체 기록", (state.comms || []).length + "건", ""));
    cards.appendChild(GV.pages.database.stat("수신 기록", (state.comms || []).filter(function (c) { return c.direction === "in"; }).length + "건", "자동 회신 판정은 하지 않음"));
    cards.appendChild(GV.pages.database.stat("이번 조건", rows.length + "건", ""));
    cards.appendChild(GV.pages.database.stat("기록 있는 업체", new Set((state.comms || []).map(function (c) { return c.entityId; })).size + "곳", ""));
    wrap.appendChild(cards);

    if (!rows.length) {
      wrap.appendChild(U.el("div", { class: "gv-empty", html: "" , text: "조건에 맞는 기록이 없습니다." }));
      return wrap;
    }
    var box = U.el("div", { class: "gv-panel" });
    var tl = U.el("div", { class: "gv-timeline" });
    rows.slice(0, 200).forEach(function (c) {
      var e = M.entityById(state, c.entityId);
      var item = U.el("div", { class: "gv-tl-item" });
      item.appendChild(U.el("time", { text: U.fmtDate(c.at) + " " + U.fmtDateTime(c.at).slice(11) }));
      var body = U.el("div");
      var top = U.el("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap" });
      top.appendChild(U.el("button", {
        type: "button", class: "gv-company", text: e ? e.name : "(삭제된 업체)",
        onclick: function () { if (e) GV.app.openDetail(e.id); }
      }));
      top.appendChild(U.el("span", { class: "gv-chip " + (c.direction === "in" ? "info" : ""), text: M.DIRECTIONS[c.direction] }));
      top.appendChild(U.el("span", { class: "gv-chip", text: M.CHANNELS[c.channel] || c.channel }));
      top.appendChild(U.el("span", { class: "gv-small gv-muted", text: c.owner || "" }));
      body.appendChild(top);
      body.appendChild(U.el("p", { text: c.body || "" }));
      if (c.outcome) body.appendChild(U.el("div", { class: "gv-small gv-muted", text: "결과: " + c.outcome }));
      item.appendChild(body);
      tl.appendChild(item);
    });
    box.appendChild(tl);
    if (rows.length > 200) box.appendChild(U.el("p", { class: "gv-small gv-muted", text: "최근 200건만 표시했습니다. 검색으로 좁혀 주세요." }));
    wrap.appendChild(box);
    return wrap;
  }

  function openCommForm(opts) {
    opts = opts || {};
    var state = S.get();
    var body = U.el("div", { class: "gv-form-grid" });

    var w1 = U.el("label", { class: "gv-form-label gv-span" });
    w1.appendChild(U.el("span", { text: "업체 *" }));
    var es = U.el("select", { name: "entityId" });
    state.entities.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); }).forEach(function (e) {
      es.appendChild(U.el("option", { value: e.id, text: e.name, selected: e.id === opts.entityId }));
    });
    w1.appendChild(es);
    body.appendChild(w1);

    function sel(name, label, options, value) {
      var w = U.el("label", { class: "gv-form-label" });
      w.appendChild(U.el("span", { text: label }));
      var s = U.el("select", { name: name });
      options.forEach(function (o) { s.appendChild(U.el("option", { value: o[0], text: o[1], selected: o[0] === value })); });
      w.appendChild(s);
      body.appendChild(w);
      return s;
    }
    sel("direction", "방향 *", [["out", "발신(우리→고객)"], ["in", "수신(고객→우리)"]], "out");
    sel("channel", "채널 *", Object.keys(M.CHANNELS).map(function (k) { return [k, M.CHANNELS[k]]; }), "call");
    sel("owner", "기록자 *", state.members.map(function (m) { return [m.name, m.name]; }), state.members[0] ? state.members[0].name : "");

    var contactWrap = U.el("label", { class: "gv-form-label" });
    contactWrap.appendChild(U.el("span", { text: "연락처" }));
    var cs = U.el("select", { name: "contactId" });
    function fillContacts() {
      U.clearNode(cs);
      cs.appendChild(U.el("option", { value: "", text: "(지정 없음)" }));
      var e = M.entityById(S.get(), es.value);
      (e && e.contacts || []).forEach(function (c) {
        cs.appendChild(U.el("option", { value: c.id, text: c.name + " · " + c.role }));
      });
    }
    fillContacts();
    es.addEventListener("change", fillContacts);
    contactWrap.appendChild(cs);
    body.appendChild(contactWrap);

    var w5 = U.el("label", { class: "gv-form-label" });
    w5.appendChild(U.el("span", { text: "일시 *" }));
    var now = new Date();
    var local = now.getFullYear() + "-" + U.pad(now.getMonth() + 1) + "-" + U.pad(now.getDate())
      + "T" + U.pad(now.getHours()) + ":" + U.pad(now.getMinutes());
    w5.appendChild(U.el("input", { name: "at", type: "datetime-local", value: local }));
    body.appendChild(w5);

    var w6 = U.el("label", { class: "gv-form-label" });
    w6.appendChild(U.el("span", { text: "결과" }));
    w6.appendChild(U.el("input", { name: "outcome", type: "text", maxlength: "60", placeholder: "예: 미팅 확정" }));
    body.appendChild(w6);

    var w7 = U.el("label", { class: "gv-form-label gv-span" });
    w7.appendChild(U.el("span", { text: "내용 *" }));
    var ta = U.el("textarea", { name: "body", rows: "4", maxlength: "1200", placeholder: "무슨 이야기를 했는지 적어 주세요." });
    w7.appendChild(ta);
    body.appendChild(w7);

    var w8 = U.el("label", { class: "gv-form-label gv-span", style: "flex-direction:row;align-items:center;gap:8px" });
    w8.appendChild(U.el("input", { name: "makeTask", type: "checkbox" }));
    w8.appendChild(U.el("span", { text: "이어서 할 일도 만들기" }));
    body.appendChild(w8);
    var w9 = U.el("label", { class: "gv-form-label gv-span" });
    w9.appendChild(U.el("span", { text: "할 일 내용(위를 체크한 경우)" }));
    w9.appendChild(U.el("input", { name: "taskTitle", type: "text", maxlength: "120", placeholder: "예: 제안서 발송" }));
    body.appendChild(w9);
    var w10 = U.el("label", { class: "gv-form-label" });
    w10.appendChild(U.el("span", { text: "할 일 기한" }));
    w10.appendChild(U.el("input", { name: "taskDue", type: "date", value: U.fmtDate(U.addDays(new Date(), 2)) }));
    body.appendChild(w10);

    GV.app.modal({
      title: "커뮤니케이션 기록", wide: true, body: body,
      help: "직접 적는 기록입니다. 이 화면은 메일·문자를 보내지 않습니다.",
      actions: [{ label: "기록", primary: true }],
      onSubmit: function (v) {
        var text = U.clean(v.body, 1200);
        if (text.length < 2) return "내용을 적어 주세요(2자 이상).";
        var at = U.parseDate(v.at);
        if (!at) return "일시를 올바르게 입력해 주세요.";
        if (at.getTime() > Date.now() + 86400000) return "미래 일시로는 기록할 수 없습니다. 예정은 할 일로 만들어 주세요.";
        if (v.makeTask && !U.clean(v.taskTitle, 120)) return "할 일 내용을 적어 주세요(체크를 해제하면 기록만 남습니다).";
        var taskDue = v.taskDue ? U.parseDate(v.taskDue) : null;
        if (v.makeTask && !taskDue) return "할 일 기한을 올바른 날짜로 입력해 주세요.";

        var r = S.tx({ op: "comm.create", targetType: "comm", note: "커뮤니케이션 기록" }, function (draft) {
          var e = M.entityById(draft, v.entityId);
          if (!e) return { ok: false, error: "업체를 찾지 못했습니다." };
          var c = {
            id: U.uid("comm"), entityId: v.entityId, dealId: null,
            direction: v.direction === "in" ? "in" : "out",
            channel: M.CHANNELS[v.channel] ? v.channel : "call",
            contactId: v.contactId || null, owner: v.owner,
            at: at.toISOString(), body: text, outcome: U.clean(v.outcome, 60),
            createdAt: U.nowIso()
          };
          draft.comms.unshift(c);
          M.refreshLastComm(draft, v.entityId);
          var extra = "";
          if (v.makeTask) {
            var t = {
              id: U.uid("task"), title: U.clean(v.taskTitle, 120), entityId: v.entityId, dealId: null,
              owner: v.owner, dueAt: taskDue.toISOString(), done: false, doneAt: null, createdAt: U.nowIso()
            };
            draft.tasks.unshift(t);
            extra = " + 할 일";
          }
          M.refreshNextAction(draft, v.entityId);
          return { ok: true, audit: { targetId: c.id, targetName: e.name + extra, after: { direction: c.direction, channel: c.channel } } };
        });
        if (!r.ok) return r.error;
        GV.app.toast("기록했습니다." + (v.makeTask ? " 할 일도 만들었습니다." : ""), { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
        return true;
      }
    });
  }

  function exportCsv(state, api) {
    var header = ["일시", "업체", "방향", "채널", "기록자", "내용", "결과"];
    var body = (state.comms || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; })
      .map(function (c) {
        var e = M.entityById(state, c.entityId);
        return [U.fmtDateTime(c.at), e ? e.name : "", M.DIRECTIONS[c.direction],
          M.CHANNELS[c.channel] || c.channel, c.owner, c.body, c.outcome];
      });
    U.download("glovek-comms-" + U.fmtDate(new Date()) + ".csv", U.toCsv([header].concat(body)));
    api.toast(body.length + "건을 CSV 로 내려받았습니다.");
  }

  GV.pages = GV.pages || {};
  GV.pages.comms = { render: render, openCommForm: openCommForm, focusEntity: focusEntity, view: view };
})(window);
