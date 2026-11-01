/* Glovek Workspace — 유입·전체 DB (시작 화면)
 *   엑셀처럼 보고 바로 고치는 표. 더블클릭으로 셀 편집, Enter 저장 / Escape 취소.
 *   열 표시 토글·필터·정렬·페이지·다중선택·일괄 변경이 모두 실제로 동작한다.
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;

  var view = {
    tab: "all", q: "", owner: "", source: "", category: "", quality: "", band: "", readiness: "",
    sortKey: "inflowAt", sortDir: "desc", page: 1, perPage: 25,
    selected: new Set(), cols: null, colMenu: false, editing: null
  };
  var ALL_COLS = [
    { key: "name", label: "업체·크리에이터", always: true },
    { key: "kind", label: "유형" },
    { key: "category", label: "카테고리" },
    { key: "source", label: "유입 출처" },
    { key: "inflowAt", label: "유입일시(KST)" },
    { key: "owner", label: "담당자" },
    { key: "quality", label: "등급" },
    { key: "readiness", label: "데이터 준비도" },
    { key: "revenue", label: "회사 연매출" },
    { key: "band", label: "회사매출 구간" },
    { key: "phone", label: "전화번호" },
    { key: "email", label: "이메일" },
    { key: "website", label: "브랜드 링크" },
    { key: "lastCommAt", label: "최근 커뮤니케이션" },
    { key: "nextAction", label: "다음 액션" },
    { key: "memo", label: "메모" }
  ];
  function defaultCols() {
    return new Set(["name", "kind", "category", "source", "inflowAt", "owner", "readiness", "revenue", "band", "phone", "email", "website", "nextAction", "memo"]);
  }

  function uniq(list) {
    return Array.from(new Set(list.filter(Boolean))).sort(function (a, b) { return String(a).localeCompare(String(b), "ko"); });
  }

  function filtered(state) {
    var q = U.clean(view.q).toLowerCase();
    return state.entities.filter(function (e) {
      if (view.tab !== "all" && e.kind !== view.tab) return false;
      if (q && !GV.app.matchEntity(e, q)) return false;
      if (view.owner && e.owner !== view.owner) return false;
      if (view.source && e.source !== view.source) return false;
      if (view.category && e.category !== view.category) return false;
      if (view.quality && e.quality !== view.quality) return false;
      if (view.readiness && M.readinessOf(e) !== view.readiness) return false;
      if (view.band && M.companyRevenueBand(e) !== view.band) return false;
      return true;
    });
  }
  function sorted(rows) {
    var key = view.sortKey;
    var getter = {
      name: function (e) { return e.name; },
      kind: function (e) { return M.KINDS[e.kind]; },
      category: function (e) { return e.category; },
      source: function (e) { return e.source; },
      inflowAt: function (e) { return e.inflowAt || null; },
      owner: function (e) { return e.owner; },
      quality: function (e) { return e.quality; },
      readiness: function (e) { return M.readinessOf(e); },
      revenue: function (e) { return M.companyRevenueAmount(e); },
      band: function (e) { return M.companyRevenueAmount(e); },
      phone: function (e) { return e.phone || null; },
      email: function (e) { return e.email || null; },
      website: function (e) { return e.website || null; },
      lastCommAt: function (e) { return e.lastCommAt || null; },
      nextAction: function (e) { return e.nextActionAt || null; },
      memo: function (e) { return e.memo || null; }
    }[key] || function (e) { return e.name; };
    return U.sortBy(rows, getter, view.sortDir);
  }

  function render(state, api) {
    if (!view.cols) view.cols = defaultCols();
    var wrap = U.el("div");

    /* 머리 */
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "유입·전체 DB" }));
    left.appendChild(U.el("p", {
      text: "회사·브랜드와 크리에이터를 한 표에서 봅니다. 셀을 더블클릭하면 바로 고칠 수 있습니다."
    }));
    head.appendChild(left);
    var acts = U.el("div", { class: "gv-actions" });
    acts.appendChild(btn("새 업체 추가", "plus", true, function () { entityForm(state, null, api); }));
    acts.appendChild(btn("표 내보내기", "download", false, function () { exportCsv(state, api); }));
    head.appendChild(acts);
    wrap.appendChild(head);

    /* 요약 — 실제 로컬 데이터에서 센 값만. 표가 주인공이므로 얇은 띠로 둔다. */
    var all = state.entities;
    var strip = U.el("div", { class: "gv-summary" });
    strip.appendChild(U.el("span", { class: "gv-chip", text: "예시 데이터" }));
    sum(strip, "전체", all.length + "건");
    sum(strip, "회사·브랜드", all.filter(function (e) { return e.kind === "company"; }).length + "건");
    sum(strip, "크리에이터", all.filter(function (e) { return e.kind === "creator"; }).length + "건");
    sum(strip, "미배정", all.filter(function (e) { return e.owner === "미배정"; }).length + "건");
    sum(strip, "회사매출 기록", all.filter(function (e) { return M.companyRevenueAmount(e) != null; }).length + "건");
    sum(strip, "L3", all.filter(function (e) { return M.readinessOf(e) === "L3"; }).length + "건");
    wrap.appendChild(strip);

    /* 탭 */
    var tabs = U.el("div", { class: "gv-tabs", role: "tablist" });
    [["all", "전체"], ["company", "회사·브랜드"], ["creator", "크리에이터"]].forEach(function (t) {
      tabs.appendChild(U.el("button", {
        type: "button", role: "tab", "aria-selected": view.tab === t[0] ? "true" : "false",
        text: t[1] + " " + (t[0] === "all" ? all.length : all.filter(function (e) { return e.kind === t[0]; }).length),
        onclick: function () { view.tab = t[0]; view.page = 1; GV.app.render(); }
      }));
    });
    wrap.appendChild(tabs);

    /* 필터 */
    var bar = U.el("div", { class: "gv-filterbar" });
    var search = U.el("div", { class: "gv-search" });
    search.appendChild(U.iconNode("search"));
    var qInput = U.el("input", {
      type: "search", value: view.q, placeholder: "업체명·담당자·이메일·전화 검색",
      "aria-label": "DB 검색"
    });
    qInput.addEventListener("input", U.debounce(function () {
      view.q = qInput.value; view.page = 1; GV.app.render();
      var again = document.querySelector('.gv-filterbar input[type="search"]');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 220));
    search.appendChild(qInput);
    bar.appendChild(search);
    bar.appendChild(select("담당자 전체", uniq(all.map(function (e) { return e.owner; })), view.owner, function (v) { view.owner = v; view.page = 1; GV.app.render(); }, "담당자 필터"));
    bar.appendChild(select("출처 전체", uniq(all.map(function (e) { return e.source; })), view.source, function (v) { view.source = v; view.page = 1; GV.app.render(); }, "출처 필터"));
    bar.appendChild(select("카테고리 전체", uniq(all.map(function (e) { return e.category; })), view.category, function (v) { view.category = v; view.page = 1; GV.app.render(); }, "카테고리 필터"));
    bar.appendChild(select("등급 전체", ["A", "B", "C", "미분류"], view.quality, function (v) { view.quality = v; view.page = 1; GV.app.render(); }, "등급 필터"));
    bar.appendChild(select("회사매출구간 전체", M.BAND_LABELS, view.band, function (v) { view.band = v; view.page = 1; GV.app.render(); }, "회사 연매출 구간 필터"));
    bar.appendChild(select("준비도 전체", Object.keys(M.READINESS), view.readiness, function (v) { view.readiness = v; view.page = 1; GV.app.render(); }, "데이터 준비도 필터", M.READINESS));
    bar.appendChild(btn("필터 초기화", "x", false, function () {
      view.q = ""; view.owner = ""; view.source = ""; view.category = "";
      view.quality = ""; view.band = ""; view.readiness = ""; view.page = 1;
      GV.app.render();
    }));
    wrap.appendChild(bar);

    var rows = sorted(filtered(state));

    /* 일괄 작업 */
    if (view.selected.size) {
      var bb = U.el("div", { class: "gv-batchbar" });
      bb.appendChild(U.el("strong", { text: view.selected.size + "건 선택" }));
      bb.appendChild(select("담당자 일괄 지정", uniq(all.map(function (e) { return e.owner; })), "", function (v) {
        if (v) batchOwner(v, api);
      }, "담당자 일괄 지정"));
      bb.appendChild(select("등급 일괄 지정", ["A", "B", "C", "미분류"], "", function (v) {
        if (v) batchQuality(v, api);
      }, "등급 일괄 지정"));
      bb.appendChild(btn("선택으로 영업 기회 만들기", "plus", false, function () {
        var ids = Array.from(view.selected);
        if (ids.length !== 1) { api.toast("영업 기회는 한 건씩 만듭니다. 한 업체만 선택해 주세요.", { kind: "warn" }); return; }
        GV.pages.pipeline.openDealForm(ids[0]);
      }));
      bb.appendChild(btn("선택 해제", "x", false, function () { view.selected.clear(); GV.app.render(); }));
      wrap.appendChild(bb);
    }

    /* 표 */
    var sheet = U.el("div", { class: "gv-sheet" });
    var hd = U.el("div", { class: "gv-sheet-hd" });
    hd.appendChild(U.el("span", {
      class: "gv-muted",
      text: rows.length + "건 / 전체 " + all.length + "건" + (view.q ? ' · 검색 "' + U.clean(view.q, 30) + '"' : "")
    }));
    var right = U.el("div", { class: "gv-actions" });
    right.appendChild(colMenu());
    right.appendChild(select("25건씩", ["10", "25", "50", "100"], String(view.perPage), function (v) {
      view.perPage = Number(v) || 25; view.page = 1; GV.app.render();
    }, "페이지당 건수"));
    hd.appendChild(right);
    sheet.appendChild(hd);

    if (!rows.length) {
      var empty = U.el("div", { class: "gv-empty" });
      empty.appendChild(U.el("p", { text: all.length ? "조건에 맞는 건이 없습니다." : "데이터가 없습니다." }));
      empty.appendChild(U.el("button", {
        type: "button", text: all.length ? "필터 초기화" : "새 업체 추가",
        onclick: all.length ? function () {
          view.q = ""; view.owner = ""; view.source = ""; view.category = "";
          view.quality = ""; view.band = ""; view.readiness = ""; GV.app.render();
        } : function () { entityForm(state, null, api); }
      }));
      sheet.appendChild(empty);
      wrap.appendChild(sheet);
      return wrap;
    }

    var pages = Math.max(1, Math.ceil(rows.length / view.perPage));
    if (view.page > pages) view.page = pages;
    var slice = rows.slice((view.page - 1) * view.perPage, view.page * view.perPage);

    var tw = U.el("div", { class: "gv-table-wrap" });
    var table = U.el("table");
    var thead = U.el("thead");
    var hrow = U.el("tr");
    var allChecked = slice.every(function (e) { return view.selected.has(e.id); });
    var checkAll = U.el("input", {
      type: "checkbox", "aria-label": "이 페이지 전체 선택", checked: allChecked && slice.length > 0
    });
    checkAll.addEventListener("change", function () {
      slice.forEach(function (e) { checkAll.checked ? view.selected.add(e.id) : view.selected.delete(e.id); });
      GV.app.render();
    });
    hrow.appendChild(U.el("th", {}, [checkAll]));
    ALL_COLS.forEach(function (c) {
      if (!view.cols.has(c.key) && !c.always) return;
      var th = U.el("th", {
        class: "gv-sortable", scope: "col", tabindex: "0",
        text: c.label + (view.sortKey === c.key ? (view.sortDir === "asc" ? " ↑" : " ↓") : "")
      });
      if (view.sortKey === c.key) th.setAttribute("aria-sort", view.sortDir === "asc" ? "ascending" : "descending");
      function doSort() {
        if (view.sortKey === c.key) view.sortDir = view.sortDir === "asc" ? "desc" : "asc";
        else { view.sortKey = c.key; view.sortDir = c.key === "inflowAt" || c.key === "revenue" ? "desc" : "asc"; }
        GV.app.render();
      }
      th.addEventListener("click", doSort);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doSort(); } });
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = U.el("tbody");
    slice.forEach(function (e) { tbody.appendChild(row(e, state, api)); });
    table.appendChild(tbody);
    tw.appendChild(table);
    sheet.appendChild(tw);
    wrap.appendChild(sheet);

    /* 페이지 */
    var pg = U.el("div", { class: "gv-pagination" });
    pg.appendChild(U.el("span", { text: view.page + " / " + pages + " 페이지" }));
    var pbtn = U.el("div", { class: "gv-actions" });
    pbtn.appendChild(U.el("button", {
      type: "button", text: "이전", disabled: view.page <= 1,
      onclick: function () { view.page = Math.max(1, view.page - 1); GV.app.render(); }
    }));
    pbtn.appendChild(U.el("button", {
      type: "button", text: "다음", disabled: view.page >= pages,
      onclick: function () { view.page = Math.min(pages, view.page + 1); GV.app.render(); }
    }));
    pg.appendChild(pbtn);
    wrap.appendChild(pg);
    return wrap;
  }

  /* ── 한 행 ──────────────────────────────────── */
  function row(e, state, api) {
    var tr = U.el("tr");
    var cb = U.el("input", { type: "checkbox", "aria-label": e.name + " 선택", checked: view.selected.has(e.id) });
    cb.addEventListener("change", function () {
      cb.checked ? view.selected.add(e.id) : view.selected.delete(e.id);
      GV.app.render();
    });
    tr.appendChild(U.el("td", {}, [cb]));

    ALL_COLS.forEach(function (c) {
      if (!view.cols.has(c.key) && !c.always) return;
      var td = U.el("td");
      if (c.key === "name") {
        var b = U.el("button", { type: "button", class: "gv-company", "data-open-entity": e.id, text: e.name });
        td.appendChild(b);
        var sub = U.el("div", { class: "gv-category" });
        sub.textContent = (e.legalName && e.legalName !== e.name ? e.legalName + " · " : "") + e.extId;
        td.appendChild(sub);
      } else if (c.key === "kind") {
        td.appendChild(U.el("span", { class: "gv-chip", text: M.KINDS[e.kind] || e.kind }));
      } else if (c.key === "owner") {
        td.appendChild(editableSelect(e, "owner", e.owner,
          Array.from(new Set(["미배정"].concat(state.members.map(function (m) { return m.name; })))), api));
      } else if (c.key === "quality") {
        td.appendChild(editableSelect(e, "quality", e.quality, ["A", "B", "C", "미분류"], api));
      } else if (c.key === "category") {
        td.className = "gv-nowrap";
        td.appendChild(editableText(e, "category", e.category, api));
      } else if (c.key === "memo") {
        td.className = "gv-memo";
        td.appendChild(editableText(e, "memo", e.memo, api, 300));
      } else if (c.key === "source") {
        td.className = "gv-nowrap";
        td.textContent = e.source || "-";
      } else if (c.key === "inflowAt") {
        td.className = "gv-number gv-nowrap";
        td.textContent = U.fmtKst(e.inflowAt);
      } else if (c.key === "readiness") {
        var lvl = M.readinessOf(e);
        var chip = U.el("span", { class: "gv-chip " + (lvl === "L3" ? "ok" : lvl === "L0" ? "warn" : "info"), text: lvl });
        td.appendChild(chip);
        if (e.readinessOverride) td.appendChild(U.el("div", { class: "gv-readiness", text: "직접 지정" }));
      } else if (c.key === "revenue") {
        td.className = "gv-number gv-nowrap";
        var amt = M.companyRevenueAmount(e);
        if (amt != null) {
          td.textContent = U.won(amt);
          td.appendChild(U.el("div", { class: "gv-category", text: (M.REV_STATUS[e.revenue.status] || "미확인") + " · " + e.revenue.year + " · " + (M.SCOPES[e.revenue.scope] || "") }));
        } else {
          td.textContent = "미확인";
          var ref = M.referenceRevenue(e);
          if (ref) td.appendChild(U.el("div", { class: "gv-category", text: "참고 " + U.won(ref.amount) + " · " + ref.why }));
        }
      } else if (c.key === "band") {
        td.className = "gv-nowrap";
        td.textContent = M.companyRevenueBand(e);
      } else if (c.key === "phone" || c.key === "email") {
        td.className = "gv-nowrap";
        td.textContent = e[c.key] || "미기록";
      } else if (c.key === "website") {
        td.className = "gv-nowrap";
        var brandUrl = U.safeUrl(e.website || "");
        if (brandUrl) td.appendChild(U.el("a", { href: brandUrl, target: "_blank", rel: "noopener noreferrer", text: brandUrl }));
        else td.textContent = "미기록";
      } else if (c.key === "lastCommAt") {
        td.className = "gv-nowrap";
        td.textContent = e.lastCommAt ? U.fmtKstDate(e.lastCommAt) + " (" + U.relLabel(e.lastCommAt) + ")" : "기록 없음";
      } else if (c.key === "nextAction") {
        if (e.nextActionAt) {
          var over = U.relDays(e.nextActionAt) < 0;
          td.appendChild(U.el("span", { class: over ? "gv-chip bad" : "gv-chip", text: U.fmtShort(e.nextActionAt) + " " + U.relLabel(e.nextActionAt) }));
          td.appendChild(U.el("div", { class: "gv-category", text: e.nextAction || "" }));
        } else td.textContent = "-";
      }
      tr.appendChild(td);
    });
    return tr;
  }

  /** 더블클릭(또는 Enter)으로 셀을 열고, Enter 저장 / Escape 취소. */
  function editableText(e, field, value, api, max) {
    var span = U.el("span", { text: value || "-", tabindex: "0", role: "button",
      "aria-label": field + " 수정 — " + (value || "값 없음") });
    var td = U.el("span");
    td.appendChild(span);
    function open() {
      var input = U.el("input", { class: "gv-inline", type: "text", value: value || "", maxlength: String(max || 60), "aria-label": (field === "memo" ? "메모" : field === "category" ? "카테고리" : field) + " 편집" });
      td.replaceChild(input, td.firstChild);
      input.focus(); input.select();
      var done = false;
      function commit() {
        if (done) return; done = true;
        var next = U.clean(input.value, max || 60);
        if (next === (value || "")) { GV.app.render(); return; }
        saveField(e.id, field, next, api);
      }
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        if (ev.key === "Escape") { ev.preventDefault(); done = true; GV.app.render(); }
      });
      input.addEventListener("blur", commit);
    }
    span.addEventListener("dblclick", open);
    span.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); open(); } });
    return td;
  }
  function editableSelect(e, field, value, options, api) {
    var sel = U.el("select", { class: "gv-owner-select", "aria-label": e.name + " " + field });
    options.forEach(function (o) {
      sel.appendChild(U.el("option", { value: o, text: o, selected: o === value }));
    });
    sel.addEventListener("change", function () { saveField(e.id, field, sel.value, api); });
    return sel;
  }

  function saveField(id, field, value, api) {
    var before = null;
    var r = S.tx({ op: "entity.update", targetType: "entity", targetId: id, note: field + " 변경" }, function (draft) {
      var e = M.entityById(draft, id);
      if (!e) return { ok: false, error: "업체를 찾지 못했습니다." };
      before = e[field];
      if (field === "category" && value === "") return { ok: false, error: "카테고리는 비울 수 없습니다." };
      e[field] = value;
      e.updatedAt = U.nowIso();
      return { ok: true, audit: { targetName: e.name, before: before, after: value } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "bad" }); return; }
    api.toast("저장했습니다." + (r.warning ? " (" + r.warning + ")" : ""), { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
  }

  function batchOwner(owner, api) {
    var ids = Array.from(view.selected);
    var r = S.tx({ op: "entity.batchOwner", targetType: "entity", note: ids.length + "건 담당자 일괄 지정" }, function (draft) {
      var changed = [];
      ids.forEach(function (id) {
        var e = M.entityById(draft, id);
        if (!e || e.owner === owner) return;
        changed.push({ id: id, name: e.name, from: e.owner });
        e.owner = owner; e.updatedAt = U.nowIso();
      });
      if (!changed.length) return { ok: false, error: "변경할 건이 없습니다(이미 같은 담당자)." };
      return { ok: true, audit: { targetName: changed.length + "건", before: changed, after: owner } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "warn" }); return; }
    view.selected.clear();
    api.toast(ids.length + "건의 담당자를 " + owner + " 로 바꿨습니다.");
  }
  function batchQuality(q, api) {
    var ids = Array.from(view.selected);
    var r = S.tx({ op: "entity.batchQuality", targetType: "entity", note: ids.length + "건 등급 일괄 지정" }, function (draft) {
      ids.forEach(function (id) {
        var e = M.entityById(draft, id);
        if (e) { e.quality = q; e.updatedAt = U.nowIso(); }
      });
      return { ok: true, audit: { targetName: ids.length + "건", after: q } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "warn" }); return; }
    view.selected.clear();
    api.toast(ids.length + "건의 등급을 " + q + " 로 바꿨습니다.");
  }

  /* ── 업체 추가·수정 폼 ─────────────────────── */
  function entityForm(state, entity, api) {
    var body = U.el("div", { class: "gv-form-grid" });
    function f(name, label, value, type, opts) {
      var wrap = U.el("label", { class: "gv-form-label" + (opts && opts.span ? " gv-span" : "") });
      wrap.appendChild(U.el("span", { text: label }));
      var node;
      if (type === "select") {
        node = U.el("select", { name: name });
        (opts.options || []).forEach(function (o) {
          var val = typeof o === "string" ? o : o[0];
          var lab = typeof o === "string" ? o : o[1];
          node.appendChild(U.el("option", { value: val, text: lab, selected: String(val) === String(value || "") }));
        });
      } else if (type === "textarea") {
        node = U.el("textarea", { name: name, rows: "3", maxlength: "600" });
        node.value = value || "";
      } else {
        node = U.el("input", { name: name, type: type || "text", value: value == null ? "" : value });
        if (opts && opts.placeholder) node.setAttribute("placeholder", opts.placeholder);
      }
      wrap.appendChild(node);
      if (opts && opts.hint) wrap.appendChild(U.el("span", { class: "gv-small gv-muted", text: opts.hint }));
      body.appendChild(wrap);
      return node;
    }
    var e = entity || {};
    f("name", "업체·크리에이터명 *", e.name, "text");
    f("legalName", "법인명", e.legalName, "text");
    f("kind", "유형", e.kind || "company", "select", { options: [["company", "회사·브랜드"], ["creator", "크리에이터"]] });
    f("category", "카테고리 *", e.category, "text");
    f("source", "유입 출처", e.source || "Glovek 상담", "select", { options: GV.seed.SOURCES });
    var inflowOriginal = e.inflowAt || null;
    var inflowShown = inflowOriginal ? U.kstInputValue(inflowOriginal) : U.kstInputValue(new Date().toISOString());
    f("inflowAt", "유입일시 (KST)", inflowShown, "datetime-local",
      { hint: "분까지 저장합니다. 최신 유입 정렬이 이 값으로 됩니다." });
    f("owner", "담당자", e.owner || "미배정", "select", { options: ["미배정"].concat(state.members.map(function (m) { return m.name; })) });
    f("quality", "등급", e.quality || "미분류", "select", { options: ["A", "B", "C", "미분류"] });
    f("phone", "대표 전화", e.phone, "text", { placeholder: "010-0000-0000" });
    f("email", "대표 이메일", e.email, "text", { placeholder: "name@example.invalid" });
    f("website", "홈페이지", e.website, "text", { span: true, placeholder: "https://example.invalid", hint: "http(s) 주소만 링크로 저장합니다." });
    f("revenueAmount", "회사 연매출(원)", e.revenue && e.revenue.amount != null ? e.revenue.amount : "", "text",
      { hint: "비우면 '미확인'. 0 을 넣으면 '0원(확인값)' 입니다 — 사업 초기라는 뜻이 아닙니다." });
    f("revenueYear", "매출 기준연도", e.revenue && e.revenue.year ? e.revenue.year : "", "text");
    f("revenueScope", "매출 범위", e.revenue ? e.revenue.scope : "", "select", {
      options: [["", "미확인"], ["brand", "브랜드 단위(회사 연매출 아님)"], ["company_separate", "회사 별도 연매출"], ["company_consolidated", "회사 연결 연매출"]]
    });
    f("revenueStatus", "매출 확인 상태", e.revenue ? e.revenue.status : "unknown", "select", {
      options: [["unknown", "미확인"], ["reported", "고객 신고"], ["estimated", "추정(미확정)"], ["verified", "근거 확인"]]
    });
    f("revenueLegalEntity", "매출 귀속 법인", e.revenue ? e.revenue.legalEntity : "", "text", { span: true });
    f("revenueSourceUrl", "매출 근거 URL", e.revenue ? e.revenue.sourceUrl : "", "text", { span: true, hint: "근거 확인(L3)에는 URL 이 필요합니다." });
    f("memo", "메모", e.memo, "textarea", { span: true });

    GV.app.modal({
      title: entity ? "업체 정보 수정" : "새 업체 추가",
      help: entity ? "" : "가상 예시 데이터입니다. 실제 고객 정보를 넣지 마세요.",
      wide: true, body: body,
      actions: [{ label: entity ? "저장" : "추가", primary: true }],
      onSubmit: function (v) {
        var name = U.clean(v.name, 80);
        if (!name) return "업체명을 입력해 주세요.";
        var category = U.clean(v.category, 40);
        if (!category) return "카테고리를 입력해 주세요.";
        var amount = v.revenueAmount === "" ? null : U.intOrNull(v.revenueAmount);
        if (v.revenueAmount !== "" && amount == null) return "회사 연매출은 숫자로 입력해 주세요(비우면 미확인).";
        if (amount != null && (amount < 0 || amount > 1e15)) return "회사 연매출 값이 범위를 벗어났습니다.";
        var year = v.revenueYear === "" ? null : U.intOrNull(v.revenueYear);
        if (v.revenueYear !== "" && (year == null || year < 1990 || year > new Date().getFullYear())) {
          return "매출 기준연도를 1990~올해 사이로 입력해 주세요.";
        }
        /* 입력값이 처음 보여 준 것과 같으면 원래 시각(초·밀리초까지)을 그대로 지킨다. */
        var inflowIso;
        if (v.inflowAt === inflowShown && inflowOriginal) inflowIso = inflowOriginal;
        else {
          inflowIso = U.kstInputToIso(v.inflowAt);
          if (!inflowIso) return "유입일시를 올바른 날짜·시각으로 입력해 주세요(KST).";
        }
        var website = v.website ? U.safeUrl(v.website) : "";
        if (v.website && !website) return "홈페이지는 http(s) 주소만 저장합니다.";
        var email = v.email ? U.safeEmail(v.email) : "";
        if (v.email && !email) return "이메일 형식을 확인해 주세요.";
        var phone = v.phone ? U.safePhone(v.phone) : "";
        if (v.phone && !phone) return "전화번호는 숫자와 - ( ) + 만 사용할 수 있습니다.";
        var sourceUrl = v.revenueSourceUrl ? U.safeUrl(v.revenueSourceUrl) : "";
        if (v.revenueSourceUrl && !sourceUrl) return "매출 근거 URL 은 http(s) 주소만 저장합니다.";
        var revBundle = {
          amount: amount, year: year, legalEntity: U.clean(v.revenueLegalEntity, 80),
          scope: v.revenueScope || "", sourceUrl: sourceUrl || ""
        };
        if (v.revenueStatus === "verified") {
          var chk = M.verifiedBundle(revBundle);
          if (!chk.ok) {
            return "'근거 확인' 으로 저장하려면 다음이 모두 필요합니다 — " + chk.missing.join(", ")
              + ". 아직 없으면 '고객 신고' 나 '추정' 으로 두세요.";
          }
        }
        if (amount != null && v.revenueScope === "" ) {
          return "금액을 적었다면 매출 범위를 골라 주세요(회사 별도/연결 또는 브랜드 단위).";
        }

        var payload = {
          name: name, legalName: U.clean(v.legalName, 80), kind: v.kind === "creator" ? "creator" : "company",
          category: category, source: U.clean(v.source, 40), inflowAt: inflowIso,
          owner: U.clean(v.owner, 30) || "미배정", quality: v.quality, phone: phone, email: email,
          website: website || "", memo: U.clean(v.memo, 600),
          revenue: {
            amount: amount, year: year, currency: "KRW",
            legalEntity: revBundle.legalEntity, scope: revBundle.scope,
            status: v.revenueStatus || "unknown", sourceUrl: revBundle.sourceUrl
          }
        };
        var r = entity ? updateEntity(entity.id, payload) : createEntity(payload);
        if (!r.ok) return r.error;
        api.toast(entity ? "수정했습니다." : "추가했습니다." , { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
        if (!entity && r.data && r.data.id) GV.app.openDetail(r.data.id);
        return true;
      }
    });
  }

  function createEntity(payload) {
    return S.tx({ op: "entity.create", targetType: "entity", note: "업체 추가" }, function (draft) {
      /* 이름이 같아도 자동으로 합치지 않는다 — 별개 id 로 만들고 알려 준다. */
      var id = U.uid("ent");
      var e = Object.assign({
        id: id, extId: "LOCAL-" + id.slice(-6).toUpperCase(),
        readiness: "L0", readinessOverride: null, followers: null,
        contacts: [], createdAt: U.nowIso(), updatedAt: U.nowIso(),
        lastCommAt: null, nextActionAt: null, nextAction: ""
      }, payload);
      draft.entities.unshift(e);
      return { ok: true, id: id, audit: { targetId: id, targetName: e.name, after: { name: e.name, category: e.category } } };
    });
  }
  function updateEntity(id, payload) {
    return S.tx({ op: "entity.update", targetType: "entity", targetId: id, note: "업체 정보 수정" }, function (draft) {
      var e = M.entityById(draft, id);
      if (!e) return { ok: false, error: "업체를 찾지 못했습니다." };
      var before = JSON.parse(JSON.stringify({ name: e.name, category: e.category, owner: e.owner, revenue: e.revenue }));
      Object.assign(e, payload);
      e.updatedAt = U.nowIso();
      return { ok: true, id: id, audit: { targetName: e.name, before: before, after: { name: e.name, category: e.category, owner: e.owner, revenue: e.revenue } } };
    });
  }

  function exportCsv(state, api) {
    var rows = sorted(filtered(state));
    var header = ["외부ID", "유형", "업체명", "법인명", "카테고리", "유입출처", "유입일시(KST)", "담당자", "등급",
      "데이터준비도", "회사연매출(원)", "참고금액(원)", "참고사유", "매출기준연도", "매출범위", "매출상태",
      "매출귀속법인", "매출근거URL", "회사매출구간",
      "대표전화", "대표이메일", "홈페이지", "최근커뮤니케이션", "다음액션일", "다음액션", "메모"];
    var body = rows.map(function (e) {
      var amt = M.companyRevenueAmount(e);
      var ref = M.referenceRevenue(e);
      return [e.extId, M.KINDS[e.kind], e.name, e.legalName, e.category, e.source, U.fmtKst(e.inflowAt),
        e.owner, e.quality, M.readinessOf(e),
        amt != null ? amt : "미확인",
        ref ? ref.amount : "", ref ? ref.why : "",
        e.revenue && e.revenue.year ? e.revenue.year : "미확인",
        M.SCOPES[e.revenue ? e.revenue.scope : ""] || "미확인",
        M.REV_STATUS[e.revenue ? e.revenue.status : "unknown"],
        e.revenue ? e.revenue.legalEntity : "",
        e.revenue ? e.revenue.sourceUrl : "", M.companyRevenueBand(e),
        e.phone, e.email, e.website,
        e.lastCommAt ? U.fmtKstDate(e.lastCommAt) : "기록 없음",
        e.nextActionAt ? U.fmtKstDate(e.nextActionAt) : "", e.nextAction, e.memo];
    });
    U.download("glovek-db-" + U.fmtDate(new Date()) + ".csv", U.toCsv([header].concat(body)));
    api.toast(rows.length + "건을 CSV 로 내려받았습니다.");
  }

  /* ── 작은 부품 ──────────────────────────────── */
  function btn(label, iconName, primary, onClick) {
    var b = U.el("button", { type: "button", class: primary ? "gv-primary" : "", onclick: onClick });
    if (iconName) b.appendChild(U.iconNode(iconName));
    b.appendChild(document.createTextNode(label));
    return b;
  }
  function select(placeholder, options, value, onChange, label, labelMap) {
    var s = U.el("select", { "aria-label": label || placeholder });
    s.appendChild(U.el("option", { value: "", text: placeholder }));
    options.forEach(function (o) {
      s.appendChild(U.el("option", { value: o, text: labelMap ? (labelMap[o] || o) : o, selected: o === value }));
    });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function sum(parent, label, value) {
    var w = U.el("span", { class: "gv-sum-item" });
    w.appendChild(U.el("span", { class: "gv-sum-label", text: label }));
    w.appendChild(U.el("b", { class: "gv-number", text: value }));
    parent.appendChild(w);
  }
  function stat(label, value, hint) {
    var d = U.el("div", { class: "gv-stat" });
    d.appendChild(U.el("span", { text: label }));
    d.appendChild(U.el("b", { text: value }));
    if (hint) d.appendChild(U.el("span", { class: "gv-small", text: hint }));
    return d;
  }
  function colMenu() {
    var wrap = U.el("div", { class: "gv-colmenu" });
    var b = U.el("button", { type: "button", text: "열 선택", "aria-expanded": view.colMenu ? "true" : "false" });
    b.addEventListener("click", function () { view.colMenu = !view.colMenu; GV.app.render(); });
    wrap.appendChild(b);
    if (view.colMenu) {
      var pop = U.el("div", { class: "gv-colmenu-pop" });
      ALL_COLS.forEach(function (c) {
        var l = U.el("label");
        var cb = U.el("input", { type: "checkbox", checked: view.cols.has(c.key) || c.always, disabled: !!c.always });
        cb.addEventListener("change", function () {
          cb.checked ? view.cols.add(c.key) : view.cols.delete(c.key);
          GV.app.render();
        });
        l.appendChild(cb);
        l.appendChild(document.createTextNode(c.label));
        pop.appendChild(l);
      });
      pop.appendChild(U.el("button", { type: "button", text: "기본값", onclick: function () { view.cols = defaultCols(); GV.app.render(); } }));
      wrap.appendChild(pop);
    }
    return wrap;
  }

  GV.pages = GV.pages || {};
  GV.pages.database = {
    render: render, entityForm: entityForm, createEntity: createEntity, updateEntity: updateEntity,
    view: view, btn: btn, select: select, stat: stat, sum: sum, saveField: saveField
  };
})(window);
