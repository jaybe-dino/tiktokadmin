/* Glovek Workspace — 셸(라우터·검색·모달·알림)
 *   · 리스너는 위임(delegation)으로 한 번만 단다 — 다시 그려도 끊기지 않는다.
 *   · 모달은 포커스를 가두고 Escape 로 닫는다. 닫으면 원래 버튼으로 돌아간다.
 *   · 네트워크 호출이 없다. 자동 새로고침 타이머도 없다.
 */
(function (global) {
  "use strict";
  var GV = global.GV = global.GV || {};
  var U = GV.util, S = GV.store;

  var PAGES = [
    { id: "database", label: "유입·전체 DB", icon: "table", group: "고객과 영업" },
    { id: "pipeline", label: "영업 보드", icon: "columns", group: "고객과 영업" },
    { id: "tasks", label: "내 할 일", icon: "calendar", group: "고객과 영업" },
    { id: "comms", label: "커뮤니케이션", icon: "message", group: "고객과 영업" },
    { id: "import", label: "가져오기·연결", icon: "database", group: "데이터 관리" },
    { id: "audit", label: "변경 이력", icon: "history", group: "데이터 관리" },
    { id: "settings", label: "설정", icon: "settings", group: "데이터 관리" }
  ];

  var ui = {
    page: "database",
    detailId: null,
    detailTab: "basic",
    search: ""
  };
  var dom = {};
  var focusReturn = null;
  var escHandler = null;

  function boot() {
    dom.root = document.getElementById("gv-sales");
    dom.nav = document.getElementById("gv-nav");
    dom.screen = document.getElementById("gv-screen");
    dom.detail = document.getElementById("gv-detail");
    dom.dialog = document.getElementById("gv-dialog");
    dom.status = document.getElementById("gv-status");
    dom.search = document.getElementById("gv-global-search");
    dom.sugg = document.getElementById("gv-sugg");

    S.load();
    var prefs = S.get().prefs || {};
    if (prefs.defaultPage && PAGES.some(function (p) { return p.id === prefs.defaultPage; })) {
      ui.page = prefs.defaultPage;
    }
    applyDensity(prefs.density);
    buildNav();
    wireShell();
    var h = (location.hash || "").replace("#", "");
    if (PAGES.some(function (p) { return p.id === h; })) ui.page = h;
    render();

    var health = S.health();
    if (!health.ok || health.note) toast(health.note || "저장소 경고", { kind: "warn", sticky: true });
  }

  function applyDensity(d) {
    dom.root.style.setProperty("--gv-row", d === "조밀" ? "36px" : d === "넉넉" ? "56px" : "46px");
  }

  function buildNav() {
    U.clearNode(dom.nav);
    var lastGroup = "";
    PAGES.forEach(function (p) {
      if (p.group !== lastGroup) {
        dom.nav.appendChild(U.el("span", {
          class: "gv-nav-label" + (lastGroup ? " gv-nav-gap" : ""), text: p.group
        }));
        lastGroup = p.group;
      }
      var b = U.el("button", { "data-page": p.id, type: "button" });
      b.appendChild(U.iconNode(p.icon));
      b.appendChild(document.createTextNode(p.label));
      dom.nav.appendChild(b);
    });
    dom.nav.appendChild(U.el("div", {
      class: "gv-nav-foot",
      text: "회사·브랜드 / 크리에이터 — 하나의 원장, 서로 다른 업무"
    }));
  }

  function wireShell() {
    dom.nav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-page]");
      if (!b) return;
      go(b.dataset.page);
    });
    /* 화면 전체 클릭 위임 — 다시 그려도 리스너가 사라지지 않는다. */
    dom.screen.addEventListener("click", function (e) {
      var d = e.target.closest("[data-open-entity]");
      if (d) { openDetail(d.getAttribute("data-open-entity")); return; }
    });
    dom.detail.addEventListener("click", function (e) {
      var c = e.target.closest("[data-detail-close]");
      if (c) closeDetail();
    });
    dom.search.addEventListener("input", U.debounce(function () {
      ui.search = dom.search.value;
      renderSuggest();
    }, 140));
    dom.search.addEventListener("focus", renderSuggest);
    dom.search.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { dom.search.value = ""; ui.search = ""; hideSuggest(); }
      if (e.key === "Enter") {
        e.preventDefault();
        var first = dom.sugg.querySelector("button[data-sugg]");
        if (first) first.click();
      }
    });
    dom.sugg.addEventListener("click", function (e) {
      var b = e.target.closest("[data-sugg]");
      if (!b) return;
      hideSuggest();
      dom.search.value = "";
      ui.search = "";
      var v = b.getAttribute("data-sugg");
      if (v.indexOf("entity:") === 0) { go("database"); openDetail(v.slice(7)); }
      else if (v.indexOf("deal:") === 0) { go("pipeline"); }
      else if (v.indexOf("page:") === 0) { go(v.slice(5)); }
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".gv-top-search")) hideSuggest();
    });
    window.addEventListener("hashchange", function () {
      var h = (location.hash || "").replace("#", "");
      if (PAGES.some(function (p) { return p.id === h; }) && h !== ui.page) { ui.page = h; render(); }
    });
    S.subscribe(function () { render(); if (ui.detailId) renderDetail(); });
  }

  function go(page) {
    if (!PAGES.some(function (p) { return p.id === page; })) return;
    /* 상세 패널은 지금 보던 목록에 딸린 것이다. 화면을 옮기면 닫는다 —
       열린 채로 두면 다른 화면의 버튼을 가린다. */
    if (page !== ui.page && ui.detailId) closeDetail();
    ui.page = page;
    if (location.hash !== "#" + page) history.replaceState(null, "", "#" + page);
    render();
    /* 화면을 바꿀 때만 맨 위로 올린다 — scrollIntoView 는 상단 헤더를 밀어내 버린다.
       같은 화면을 다시 그릴 때(render)는 스크롤을 건드리지 않는다. */
    if (typeof global.scrollTo === "function") global.scrollTo({ top: 0, behavior: "auto" });
  }

  function render() {
    Array.prototype.forEach.call(dom.nav.querySelectorAll("[data-page]"), function (b) {
      if (b.dataset.page === ui.page) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    U.clearNode(dom.screen);
    var page = GV.pages && GV.pages[ui.page];
    if (!page) {
      dom.screen.appendChild(U.el("div", { class: "gv-empty", text: "준비되지 않은 화면입니다." }));
      return;
    }
    try {
      dom.screen.appendChild(page.render(S.get(), { go: go, openDetail: openDetail, toast: toast, modal: modal }));
    } catch (e) {
      console.error(e);
      dom.screen.appendChild(banner("bad", "화면을 그리는 중 오류가 발생했습니다: " + (e.message || "원인 미상")));
    }
  }

  /* ── 상세 패널 ──────────────────────────────── */
  function openDetail(id, tab) {
    var e = GV.model.entityById(S.get(), id);
    if (!e) { toast("해당 업체를 찾지 못했습니다.", { kind: "warn" }); return; }
    ui.detailId = id;
    if (tab) ui.detailTab = tab;
    dom.root.classList.add("detail-open");
    dom.detail.hidden = false;
    renderDetail();
    var h = dom.detail.querySelector("h2");
    if (h) h.setAttribute("tabindex", "-1"), h.focus();
  }
  function closeDetail() {
    ui.detailId = null;
    dom.detail.hidden = true;
    dom.root.classList.remove("detail-open");
    U.clearNode(dom.detail);
  }
  function renderDetail() {
    if (!ui.detailId) return;
    var e = GV.model.entityById(S.get(), ui.detailId);
    if (!e) { closeDetail(); return; }
    U.clearNode(dom.detail);
    dom.detail.appendChild(GV.pages.detail.render(S.get(), e, {
      tab: ui.detailTab,
      setTab: function (t) { ui.detailTab = t; renderDetail(); },
      close: closeDetail, toast: toast, modal: modal, go: go
    }));
  }

  /* ── 알림(토스트) ──────────────────────────── */
  var toastTimer = null;
  function toast(message, opts) {
    opts = opts || {};
    clearTimeout(toastTimer);
    U.clearNode(dom.status);
    dom.status.hidden = false;
    dom.status.appendChild(U.iconNode(opts.kind === "warn" ? "warn" : opts.kind === "bad" ? "warn" : "check"));
    dom.status.appendChild(U.el("span", { text: String(message) }));
    if (opts.action && typeof opts.onAction === "function") {
      dom.status.appendChild(U.el("button", {
        type: "button", text: opts.action,
        onclick: function () { opts.onAction(); hideToast(); }
      }));
    }
    dom.status.appendChild(U.el("button", { type: "button", text: "닫기", onclick: hideToast }));
    if (!opts.sticky) toastTimer = setTimeout(hideToast, opts.ms || 5200);
  }
  function hideToast() { dom.status.hidden = true; U.clearNode(dom.status); }

  /* ── 모달 ───────────────────────────────────── */
  /**
   * modal({title, help, body(form), actions:[{label, primary, value}], onSubmit(values, api)})
   *   onSubmit 이 문자열을 돌려주면 오류로 띄우고 닫지 않는다.
   */
  function modal(spec) {
    focusReturn = document.activeElement;
    U.clearNode(dom.dialog);
    dom.dialog.className = spec.wide ? "gv-wide" : "";

    /* 제목과 버튼은 고정하고 본문만 스크롤한다 — 좁은 화면에서 닫기 버튼이 사라지지 않게. */
    var head = U.el("div", { class: "gv-dialog-hd" });
    var titleWrap = U.el("div", { style: "flex:1;min-width:0" });
    titleWrap.appendChild(U.el("h2", { id: "gv-dialog-title", text: spec.title || "" }));
    if (spec.help) titleWrap.appendChild(U.el("p", { text: spec.help }));
    head.appendChild(titleWrap);
    var xBtn = U.el("button", {
      type: "button", class: "gv-dialog-x", "aria-label": "닫기",
      html: U.icon("x"), onclick: function () { close(); }
    });
    head.appendChild(xBtn);
    dom.dialog.appendChild(head);

    var errBox = U.el("div", { class: "gv-form-error", role: "alert" });
    var form = U.el("form", { novalidate: true });
    var bodyWrap = U.el("div", { class: "gv-dialog-bd" });
    if (spec.body) bodyWrap.appendChild(spec.body);
    form.appendChild(bodyWrap);

    var foot = U.el("div", { class: "gv-dialog-ft" });
    foot.appendChild(errBox);
    var row = U.el("div", { class: "gv-form-row" });
    (spec.actions || [{ label: "확인", primary: true }]).forEach(function (a) {
      row.appendChild(U.el("button", {
        type: a.cancel ? "button" : "submit",
        class: a.primary ? "gv-primary" : "",
        text: a.label,
        "data-value": a.value || "",
        onclick: a.cancel ? function () { close(); } : null
      }));
    });
    row.appendChild(U.el("button", { type: "button", text: "취소", onclick: close }));
    foot.appendChild(row);
    form.appendChild(foot);
    dom.dialog.appendChild(form);

    var submitted = false;
    var api = {
      error: function (msg) {
        errBox.textContent = msg || "";
        if (msg) foot.scrollIntoView({ block: "nearest", behavior: "auto" });
      },
      close: close,
      form: form
    };
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      errBox.textContent = "";
      var values = {};
      Array.prototype.forEach.call(form.elements, function (f) {
        if (!f.name) return;
        if (f.type === "checkbox") values[f.name] = f.checked;
        else values[f.name] = f.value;
      });
      var submitter = ev.submitter;
      if (submitter && submitter.getAttribute("data-value")) values.__action = submitter.getAttribute("data-value");
      var res = spec.onSubmit ? spec.onSubmit(values, api) : null;
      if (typeof res === "string" && res) { api.error(res); return; }
      if (res === false) return;
      submitted = true;
      close();
    });
    escHandler = function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
      if (ev.key !== "Tab") return;
      var f = dom.dialog.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
      var list = Array.prototype.filter.call(f, function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    };
    dom.dialog.addEventListener("keydown", escHandler);
    /* 모달이 열린 동안 뒤 화면이 따라 스크롤되지 않게 한다. */
    document.documentElement.classList.add("gv-modal-open");
    document.body.classList.add("gv-modal-open");
    if (typeof dom.dialog.showModal === "function") dom.dialog.showModal();
    else dom.dialog.setAttribute("open", "");
    var firstField = bodyWrap.querySelector("input,select,textarea") || xBtn;
    if (firstField) firstField.focus();

    function close() {
      if (!submitted && typeof spec.onCancel === "function") {
        try { spec.onCancel(); } catch (e) { console.error(e); }
      }
      dom.dialog.removeEventListener("keydown", escHandler);
      document.documentElement.classList.remove("gv-modal-open");
      document.body.classList.remove("gv-modal-open");
      if (typeof dom.dialog.close === "function" && dom.dialog.open) dom.dialog.close();
      else dom.dialog.removeAttribute("open");
      U.clearNode(dom.dialog);
      if (focusReturn && focusReturn.focus) focusReturn.focus();
      focusReturn = null;
    }
    return api;
  }

  /* ── 전역 검색 ──────────────────────────────── */
  function renderSuggest() {
    var q = U.clean(dom.search.value).toLowerCase();
    U.clearNode(dom.sugg);
    if (q.length < 1) { hideSuggest(); return; }
    var st = S.get();
    var hits = st.entities.filter(function (e) {
      return matchEntity(e, q);
    }).slice(0, 8);
    var pages = PAGES.filter(function (p) { return p.label.toLowerCase().indexOf(q) >= 0; }).slice(0, 3);
    if (!hits.length && !pages.length) {
      dom.sugg.appendChild(U.el("div", { class: "gv-sugg-group", text: "결과가 없습니다" }));
      dom.sugg.hidden = false;
      return;
    }
    if (hits.length) {
      dom.sugg.appendChild(U.el("div", { class: "gv-sugg-group", text: "업체·크리에이터 " + hits.length + "건" }));
      hits.forEach(function (e) {
        var b = U.el("button", { type: "button", "data-sugg": "entity:" + e.id });
        b.appendChild(U.el("strong", { text: e.name }));
        b.appendChild(U.el("span", { class: "gv-muted gv-small", text: (GV.model.KINDS[e.kind] || "") + " · " + (e.category || "미분류") + " · " + e.owner }));
        dom.sugg.appendChild(b);
      });
    }
    if (pages.length) {
      dom.sugg.appendChild(U.el("div", { class: "gv-sugg-group", text: "화면 이동" }));
      pages.forEach(function (p) {
        dom.sugg.appendChild(U.el("button", { type: "button", "data-sugg": "page:" + p.id, text: p.label }));
      });
    }
    dom.sugg.hidden = false;
  }
  function hideSuggest() { dom.sugg.hidden = true; U.clearNode(dom.sugg); }

  function matchEntity(e, q) {
    if (!q) return true;
    var fields = [e.name, e.legalName, e.extId, e.phone, e.email, e.category, e.owner];
    (e.contacts || []).forEach(function (c) { fields.push(c.name, c.email, c.phone); });
    return fields.some(function (f) { return f && String(f).toLowerCase().indexOf(q) >= 0; });
  }

  function banner(kind, text, iconName) {
    var b = U.el("div", { class: "gv-banner " + (kind || "") });
    b.appendChild(U.iconNode(iconName || (kind === "bad" ? "warn" : kind === "warn" ? "warn" : "info")));
    b.appendChild(U.el("div", { text: text }));
    return b;
  }

  GV.app = {
    boot: boot, go: go, render: render, toast: toast, modal: modal,
    openDetail: openDetail, closeDetail: closeDetail, banner: banner,
    matchEntity: matchEntity, applyDensity: applyDensity, PAGES: PAGES,
    ui: ui
  };
  GV.pages = GV.pages || {};
  document.addEventListener("DOMContentLoaded", boot);
})(window);
