/* Glovek Workspace — 우측 상세 패널
 *   탭: 기본 / 연락처 / 매출.  아래에 커뮤니케이션 타임라인·메모·변경 이력.
 *   생성·수정·최근 커뮤니케이션·다음 액션을 각각 따로 보여 준다(한 칸에 섞지 않는다).
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;

  function render(state, e, ctx) {
    var wrap = U.el("div");

    var head = U.el("div", { class: "gv-detail-head" });
    var left = U.el("div");
    left.appendChild(U.el("h2", { text: e.name }));
    var sub = U.el("p", { class: "gv-small gv-muted" });
    sub.textContent = (M.KINDS[e.kind] || "") + " · " + (e.category || "미분류") + " · " + e.extId;
    left.appendChild(sub);
    head.appendChild(left);
    var hact = U.el("div", { class: "gv-actions" });
    hact.appendChild(U.el("button", { type: "button", class: "gv-quiet", "aria-label": "상세 닫기", "data-detail-close": "1", html: U.icon("x") }));
    head.appendChild(hact);
    wrap.appendChild(head);

    /* 상태 요약 */
    var chips = U.el("div", { class: "gv-actions", style: "margin-bottom:12px" });
    var lvl = M.readinessOf(e);
    chips.appendChild(U.el("span", { class: "gv-chip " + (lvl === "L3" ? "ok" : lvl === "L0" ? "warn" : "info"), text: M.READINESS[lvl] }));
    chips.appendChild(U.el("span", { class: "gv-chip", text: "담당 " + e.owner }));
    chips.appendChild(U.el("span", { class: "gv-chip", text: "등급 " + e.quality }));
    wrap.appendChild(chips);

    var acts = U.el("div", { class: "gv-actions", style: "margin-bottom:14px" });
    acts.appendChild(mini("정보 수정", "settings", function () { GV.pages.database.entityForm(state, e, ctx); }));
    acts.appendChild(mini("영업 기회", "plus", function () { GV.pages.pipeline.openDealForm(e.id); }));
    acts.appendChild(mini("할 일 추가", "calendar", function () { GV.pages.tasks.openTaskForm({ entityId: e.id }); }));
    acts.appendChild(mini("기록 남기기", "message", function () { GV.pages.comms.openCommForm({ entityId: e.id }); }));
    wrap.appendChild(acts);

    /* 탭 */
    var tabs = U.el("div", { class: "gv-detail-tabs", role: "tablist" });
    [["basic", "기본"], ["contact", "연락처"], ["revenue", "매출"]].forEach(function (t) {
      tabs.appendChild(U.el("button", {
        type: "button", role: "tab", "aria-selected": ctx.tab === t[0] ? "true" : "false", text: t[1],
        onclick: function () { ctx.setTab(t[0]); }
      }));
    });
    wrap.appendChild(tabs);

    if (ctx.tab === "contact") wrap.appendChild(contactTab(state, e, ctx));
    else if (ctx.tab === "revenue") wrap.appendChild(revenueTab(state, e, ctx));
    else wrap.appendChild(basicTab(state, e, ctx));

    /* 메모 */
    var memo = U.el("div", { class: "gv-section" });
    memo.appendChild(U.el("h3", { text: "메모" }));
    var ta = U.el("textarea", { "aria-label": "메모", maxlength: "600", placeholder: "통화·미팅 메모를 적어 두세요." });
    ta.value = e.memo || "";
    memo.appendChild(ta);
    var mrow = U.el("div", { class: "gv-note-actions" });
    mrow.appendChild(U.el("button", {
      type: "button", class: "gv-primary", text: "메모 저장",
      onclick: function () {
        var r = S.tx({ op: "entity.memo", targetType: "entity", targetId: e.id, note: "메모 저장" }, function (draft) {
          var x = M.entityById(draft, e.id);
          if (!x) return { ok: false, error: "업체를 찾지 못했습니다." };
          var before = x.memo;
          x.memo = U.clean(ta.value, 600);
          x.updatedAt = U.nowIso();
          return { ok: true, audit: { targetName: x.name, before: before, after: x.memo } };
        });
        if (!r.ok) { ctx.toast(r.error, { kind: "bad" }); return; }
        ctx.toast("메모를 저장했습니다." + (r.warning ? " (" + r.warning + ")" : ""), { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
      }
    }));
    memo.appendChild(mrow);
    wrap.appendChild(memo);

    /* 커뮤니케이션 타임라인 */
    var comms = (state.comms || []).filter(function (c) { return c.entityId === e.id; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var tl = U.el("div", { class: "gv-section" });
    var tlHead = U.el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px" });
    tlHead.appendChild(U.el("h3", { text: "커뮤니케이션 " + comms.length + "건" }));
    tlHead.appendChild(U.el("button", {
      type: "button", class: "gv-quiet", text: "기록 추가",
      onclick: function () { GV.pages.comms.openCommForm({ entityId: e.id }); }
    }));
    tl.appendChild(tlHead);
    if (!comms.length) {
      tl.appendChild(U.el("p", { class: "gv-small gv-muted", text: "아직 기록이 없습니다. 통화·메일을 직접 적어 두면 여기 쌓입니다." }));
    } else {
      var list = U.el("div", { class: "gv-timeline" });
      comms.slice(0, 12).forEach(function (c) { list.appendChild(commItem(c)); });
      tl.appendChild(list);
      if (comms.length > 12) {
        tl.appendChild(U.el("button", {
          type: "button", class: "gv-quiet", text: "전체 " + comms.length + "건 보기",
          onclick: function () { GV.pages.comms.focusEntity(e.id); ctx.go("comms"); }
        }));
      }
    }
    wrap.appendChild(tl);

    /* 관련 기회·할 일 */
    var deals = (state.deals || []).filter(function (d) { return d.entityId === e.id; });
    var tasks = (state.tasks || []).filter(function (t) { return t.entityId === e.id; });
    var rel = U.el("div", { class: "gv-section" });
    rel.appendChild(U.el("h3", { text: "영업 기회 " + deals.length + "건 · 할 일 " + tasks.filter(function (t) { return !t.done; }).length + "건 진행" }));
    if (!deals.length && !tasks.length) {
      rel.appendChild(U.el("p", { class: "gv-small gv-muted", text: "연결된 기회·할 일이 없습니다." }));
    }
    deals.forEach(function (d) {
      var row = U.el("div", { class: "gv-history-item" });
      row.appendChild(U.el("span", { class: "gv-chip " + (d.status === "won" ? "ok" : d.status === "open" ? "info" : "warn"), text: d.status === "open" ? M.stageLabel(d.stage) : M.STATUS[d.status] }));
      var body = U.el("div");
      body.appendChild(U.el("button", { type: "button", class: "gv-company", text: d.service, onclick: function () { GV.pages.pipeline.openDealDetail(d.id); } }));
      body.appendChild(U.el("div", { class: "gv-small gv-muted", text: ourMoney(d) }));
      row.appendChild(body);
      rel.appendChild(row);
    });
    tasks.filter(function (t) { return !t.done; }).forEach(function (t) {
      var row = U.el("div", { class: "gv-history-item" });
      row.appendChild(U.el("time", { text: U.fmtShort(t.dueAt) }));
      var body = U.el("div");
      body.appendChild(U.el("div", { text: t.title }));
      body.appendChild(U.el("div", { class: "gv-small gv-muted", text: t.owner + " · " + U.relLabel(t.dueAt) }));
      row.appendChild(body);
      rel.appendChild(row);
    });
    wrap.appendChild(rel);

    /* 변경 이력 */
    var logs = (state.audit || []).filter(function (a) { return a.targetId === e.id; }).slice(0, 8);
    var hist = U.el("div", { class: "gv-section" });
    hist.appendChild(U.el("h3", { text: "변경 이력" }));
    if (!logs.length) hist.appendChild(U.el("p", { class: "gv-small gv-muted", text: "이 업체에 대한 변경 기록이 없습니다." }));
    logs.forEach(function (a) {
      var row = U.el("div", { class: "gv-history-item" });
      row.appendChild(U.el("time", { text: U.fmtShort(a.at) + " " + U.fmtDateTime(a.at).slice(11) }));
      var body = U.el("div");
      body.appendChild(U.el("div", { text: a.note || a.op }));
      body.appendChild(U.el("div", { class: "gv-small gv-muted", text: a.actor + " · " + a.op }));
      row.appendChild(body);
      hist.appendChild(row);
    });
    wrap.appendChild(hist);
    return wrap;
  }

  function basicTab(state, e, ctx) {
    var sec = U.el("div", { class: "gv-section" });
    var dl = U.el("dl", { class: "gv-kv" });
    kv(dl, "유형", M.KINDS[e.kind] || e.kind);
    kv(dl, "법인명", e.legalName || "미기록");
    kv(dl, "카테고리", e.category || "미분류");
    kv(dl, "유입 출처", e.source || "미기록");
    kv(dl, "유입일", U.fmtDateTime(e.inflowAt) || "미기록");
    kv(dl, "담당자", e.owner);
    kv(dl, "등급", e.quality);
    kv(dl, "데이터 준비도", M.READINESS[M.readinessOf(e)] + (e.readinessOverride ? " (직접 지정)" : " (자동 판정)"));
    kv(dl, "생성", U.fmtDateTime(e.createdAt) || "-");
    kv(dl, "마지막 수정", U.fmtDateTime(e.updatedAt) || "-");
    kv(dl, "최근 커뮤니케이션", e.lastCommAt ? U.fmtDateTime(e.lastCommAt) + " (" + U.relLabel(e.lastCommAt) + ")" : "기록 없음");
    kv(dl, "다음 액션", e.nextActionAt ? U.fmtDate(e.nextActionAt) + " · " + e.nextAction : "없음");
    if (e.kind === "creator" && e.followers != null) kv(dl, "팔로워(만)", String(e.followers));
    sec.appendChild(dl);

    var ov = U.el("div", { style: "margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
    ov.appendChild(U.el("span", { class: "gv-small gv-muted", text: "준비도 직접 지정" }));
    var sel = U.el("select", { "aria-label": "데이터 준비도 직접 지정" });
    sel.appendChild(U.el("option", { value: "", text: "자동 판정 사용" }));
    Object.keys(M.READINESS).forEach(function (k) {
      sel.appendChild(U.el("option", { value: k, text: M.READINESS[k], selected: e.readinessOverride && e.readinessOverride.level === k }));
    });
    sel.addEventListener("change", function () { overrideReadiness(e, sel.value, ctx); });
    ov.appendChild(sel);
    sec.appendChild(ov);
    sec.appendChild(U.el("p", {
      class: "gv-small gv-muted", style: "margin-top:8px",
      text: "데이터 준비도는 자료가 얼마나 확인됐는지를 뜻합니다. 영업 단계와 다릅니다."
    }));
    return sec;
  }

  function overrideReadiness(e, level, ctx) {
    if (level && !M.READINESS[level]) return;
    var r = S.tx({ op: "entity.readiness", targetType: "entity", targetId: e.id, note: level ? "준비도 직접 지정 " + level : "준비도 자동 판정으로 되돌림" }, function (draft) {
      var x = M.entityById(draft, e.id);
      if (!x) return { ok: false, error: "업체를 찾지 못했습니다." };
      var before = x.readinessOverride ? x.readinessOverride.level : null;
      x.readinessOverride = level ? { level: level, by: "로컬 사용자", at: U.nowIso() } : null;
      x.updatedAt = U.nowIso();
      return { ok: true, audit: { targetName: x.name, before: before, after: level || "(자동)" } };
    });
    if (!r.ok) { ctx.toast(r.error, { kind: "bad" }); return; }
    ctx.toast(level ? "준비도를 " + level + " 로 지정했습니다. 이력에 남습니다." : "자동 판정으로 되돌렸습니다.");
  }

  function contactTab(state, e, ctx) {
    var sec = U.el("div", { class: "gv-section" });
    var dl = U.el("dl", { class: "gv-kv" });
    kvNode(dl, "대표 전화", e.phone ? telLink(e.phone) : document.createTextNode("미기록"));
    kvNode(dl, "대표 이메일", e.email ? mailLink(e.email) : document.createTextNode("미기록"));
    kvNode(dl, "홈페이지", e.website ? webLink(e.website) : document.createTextNode("미기록"));
    sec.appendChild(dl);
    sec.appendChild(U.el("p", {
      class: "gv-small gv-muted", style: "margin-top:8px",
      text: "메일함은 연결되어 있지 않습니다. 메일·전화 링크는 기기의 기본 앱을 열 뿐이며, "
        + "주고받은 내용은 커뮤니케이션 화면에서 직접 기록합니다."
    }));

    (e.contacts || []).forEach(function (c) {
      var card = U.el("div", { class: "gv-contact" });
      var top = U.el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:flex-start" });
      var who = U.el("div");
      who.appendChild(U.el("strong", { text: c.name }));
      who.appendChild(U.el("div", { class: "gv-small gv-muted", text: c.role + (c.primary ? " · 주 담당" : "") }));
      top.appendChild(who);
      top.appendChild(U.el("button", {
        type: "button", class: "gv-quiet", text: "삭제",
        onclick: function () { removeContact(e.id, c.id, ctx); }
      }));
      card.appendChild(top);
      var lines = U.el("div", { style: "margin-top:6px;display:grid;gap:3px" });
      if (c.phone) lines.appendChild(telLink(c.phone));
      if (c.email) lines.appendChild(mailLink(c.email));
      card.appendChild(lines);
      sec.appendChild(card);
    });
    if (!(e.contacts || []).length) {
      sec.appendChild(U.el("p", { class: "gv-small gv-muted", style: "margin-top:10px", text: "등록된 연락처가 없습니다. 연락처가 있으면 준비도가 L1 로 올라갑니다." }));
    }
    sec.appendChild(U.el("button", {
      type: "button", style: "margin-top:12px", text: "연락처 추가",
      onclick: function () { contactForm(e, ctx); }
    }));
    return sec;
  }

  function contactForm(e, ctx) {
    var body = U.el("div");
    function f(name, label, placeholder) {
      var w = U.el("label", { class: "gv-form-label" });
      w.appendChild(U.el("span", { text: label }));
      w.appendChild(U.el("input", { name: name, type: "text", placeholder: placeholder || "" }));
      body.appendChild(w);
    }
    f("name", "이름 *", "예: 김지현");
    f("role", "직책", "예: 마케팅 팀장");
    f("phone", "전화", "010-0000-0000");
    f("email", "이메일", "name@example.invalid");
    var pw = U.el("label", { class: "gv-form-label", style: "flex-direction:row;align-items:center;gap:8px" });
    pw.appendChild(U.el("input", { name: "primary", type: "checkbox" }));
    pw.appendChild(U.el("span", { text: "주 담당으로 지정" }));
    body.appendChild(pw);

    GV.app.modal({
      title: "연락처 추가", help: e.name + " 에 연락처를 추가합니다.", body: body,
      actions: [{ label: "추가", primary: true }],
      onSubmit: function (v) {
        var name = U.clean(v.name, 40);
        if (!name) return "이름을 입력해 주세요.";
        var phone = v.phone ? U.safePhone(v.phone) : "";
        if (v.phone && !phone) return "전화번호 형식을 확인해 주세요.";
        var email = v.email ? U.safeEmail(v.email) : "";
        if (v.email && !email) return "이메일 형식을 확인해 주세요.";
        if (!phone && !email) return "전화 또는 이메일 중 하나는 필요합니다.";
        var r = S.tx({ op: "contact.create", targetType: "entity", targetId: e.id, note: "연락처 추가" }, function (draft) {
          var x = M.entityById(draft, e.id);
          if (!x) return { ok: false, error: "업체를 찾지 못했습니다." };
          x.contacts = x.contacts || [];
          if (x.contacts.length >= 12) return { ok: false, error: "연락처는 12개까지 담을 수 있습니다." };
          if (v.primary) x.contacts.forEach(function (c) { c.primary = false; });
          var c = { id: U.uid("ct"), name: name, role: U.clean(v.role, 40), phone: phone, email: email, primary: !!v.primary || x.contacts.length === 0 };
          x.contacts.push(c);
          if (c.primary) { if (phone) x.phone = phone; if (email) x.email = email; }
          x.updatedAt = U.nowIso();
          return { ok: true, audit: { targetName: x.name, after: { name: c.name, role: c.role } } };
        });
        if (!r.ok) return r.error;
        ctx.toast("연락처를 추가했습니다.", { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
        return true;
      }
    });
  }
  function removeContact(entityId, contactId, ctx) {
    GV.app.modal({
      title: "연락처 삭제", help: "이 연락처를 지웁니다. 변경 이력에는 남습니다.",
      body: U.el("div"), actions: [{ label: "삭제", primary: true }],
      onSubmit: function () {
        var r = S.tx({ op: "contact.delete", targetType: "entity", targetId: entityId, note: "연락처 삭제" }, function (draft) {
          var x = M.entityById(draft, entityId);
          if (!x) return { ok: false, error: "업체를 찾지 못했습니다." };
          var c = (x.contacts || []).find(function (y) { return y.id === contactId; });
          if (!c) return { ok: false, error: "연락처를 찾지 못했습니다." };
          x.contacts = x.contacts.filter(function (y) { return y.id !== contactId; });
          x.updatedAt = U.nowIso();
          return { ok: true, audit: { targetName: x.name, before: { name: c.name, role: c.role } } };
        });
        if (!r.ok) return r.error;
        ctx.toast("연락처를 지웠습니다.");
        return true;
      }
    });
  }

  function revenueTab(state, e, ctx) {
    var r = e.revenue || {};
    var sec = U.el("div", { class: "gv-section" });
    var dl = U.el("dl", { class: "gv-kv" });
    var companyAmt = M.companyRevenueAmount(e);
    var ref = M.referenceRevenue(e);
    kv(dl, "회사 연매출(확정)", companyAmt != null ? U.won(companyAmt) : "미확인");
    kv(dl, "회사매출 구간", M.companyRevenueBand(e));
    if (ref) kv(dl, "참고 금액", U.won(ref.amount) + " · " + ref.why + " (회사 연매출로 쓰지 않음)");
    kv(dl, "기준연도", r.year ? String(r.year) : "미확인");
    kv(dl, "통화", r.currency || "KRW");
    kv(dl, "귀속 법인", r.legalEntity || "미기록");
    kv(dl, "범위", M.SCOPES[r.scope || ""] || "미확인");
    kv(dl, "확인 상태", M.REV_STATUS[r.status || "unknown"]);
    kvNode(dl, "근거", r.sourceUrl ? webLink(r.sourceUrl) : document.createTextNode("미기록"));
    sec.appendChild(dl);
    sec.appendChild(U.el("p", {
      class: "gv-small gv-muted", style: "margin-top:10px",
      text: "이 금액은 고객사의 연매출입니다. 우리가 받는 계약 금액(영업 보드)과 절대 섞지 않습니다."
    }));
    if (r.scope === "brand") {
      sec.appendChild(GV.app.banner("warn", "브랜드 단위 숫자입니다. 회사 연매출로 올려 쓰지 않습니다."));
    }
    if (r.status === "verified") {
      var chk = M.verifiedBundle(r);
      if (!chk.ok) sec.appendChild(GV.app.banner("bad", "'근거 확인' 으로 표시돼 있지만 다음이 비어 있습니다 — " + chk.missing.join(", ")));
    }
    sec.appendChild(U.el("button", {
      type: "button", style: "margin-top:12px", text: "매출 정보 수정",
      onclick: function () { GV.pages.database.entityForm(state, e, ctx); }
    }));
    return sec;
  }

  /* ── 부품 ───────────────────────────────────── */
  function kv(dl, k, v) {
    dl.appendChild(U.el("dt", { text: k }));
    dl.appendChild(U.el("dd", { text: v == null ? "-" : String(v) }));
  }
  function kvNode(dl, k, node) {
    dl.appendChild(U.el("dt", { text: k }));
    var dd = U.el("dd");
    dd.appendChild(node);
    dl.appendChild(dd);
  }
  function mailLink(email) {
    var safe = U.safeEmail(email);
    if (!safe) return U.el("span", { text: U.clean(email, 80) });
    return U.el("a", { href: "mailto:" + safe, text: safe, rel: "noopener noreferrer" });
  }
  function telLink(phone) {
    var safe = U.safePhone(phone);
    if (!safe) return U.el("span", { text: U.clean(phone, 40) });
    return U.el("a", { href: "tel:" + safe.replace(/[^0-9+]/g, ""), text: safe, rel: "noopener noreferrer" });
  }
  function webLink(url) {
    var safe = U.safeUrl(url);
    if (!safe) return U.el("span", { text: U.clean(url, 120) + " (주소 확인 필요)" });
    return U.el("a", { href: safe, text: safe, target: "_blank", rel: "noopener noreferrer" });
  }
  function commItem(c) {
    var item = U.el("div", { class: "gv-tl-item" });
    item.appendChild(U.el("time", { text: U.fmtShort(c.at) + " " + U.fmtDateTime(c.at).slice(11) }));
    var body = U.el("div");
    var head = U.el("div");
    head.appendChild(U.el("span", { class: "gv-chip " + (c.direction === "in" ? "info" : ""), text: M.DIRECTIONS[c.direction] + " · " + M.CHANNELS[c.channel] }));
    head.appendChild(document.createTextNode(" " + (c.owner || "")));
    body.appendChild(head);
    body.appendChild(U.el("p", { text: c.body || "" }));
    if (c.outcome) body.appendChild(U.el("div", { class: "gv-small gv-muted", text: "결과: " + c.outcome }));
    item.appendChild(body);
    return item;
  }
  function mini(label, iconName, onClick) {
    var b = U.el("button", { type: "button", onclick: onClick });
    b.appendChild(U.iconNode(iconName, 14));
    b.appendChild(document.createTextNode(label));
    return b;
  }
  function ourMoney(d) {
    if (d.status === "won") {
      return "확정 계약 " + U.won(d.contractAmount) + (d.contractDate ? " · " + d.contractDate : "")
        + (d.contractScope ? " · " + d.contractScope : "");
    }
    if (d.expectedAmount != null) return "예상 계약 " + U.won(d.expectedAmount);
    return "금액 미정";
  }

  GV.pages = GV.pages || {};
  GV.pages.detail = { render: render, mailLink: mailLink, telLink: telLink, webLink: webLink, commItem: commItem, ourMoney: ourMoney };
})(window);
