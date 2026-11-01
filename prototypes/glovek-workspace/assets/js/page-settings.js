/* Glovek Workspace — 설정
 *   구성원(예시 담당자 목록), 화면 기본값, 연결 설정 초안, 백업/복원/초기화.
 *   브라우저 안의 역할 표시는 보안이 아니다 — 그 사실을 화면에 그대로 적는다.
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;

  function render(state, api) {
    var wrap = U.el("div");
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "설정" }));
    left.appendChild(U.el("p", { text: "이 브라우저에만 적용되는 설정입니다. 로그인·서버 권한과 무관합니다." }));
    head.appendChild(left);
    wrap.appendChild(head);

    var split = U.el("div", { class: "gv-split" });

    /* 저장소 */
    var h = S.health();
    var storage = U.el("div", { class: "gv-panel" });
    storage.appendChild(U.el("h3", { text: "저장소" }));
    var dl = U.el("dl", { class: "gv-kv" });
    kv(dl, "저장 위치", "브라우저 localStorage");
    kv(dl, "키", h.key);
    kv(dl, "스키마", "v" + h.schema);
    kv(dl, "사용 크기", Math.round(h.bytes / 1024) + " KB");
    kv(dl, "마지막 저장", state.savedAt ? U.fmtDateTime(state.savedAt) : "-");
    kv(dl, "상태", h.ok ? "정상" : "쓰기 불가");
    storage.appendChild(dl);
    if (!h.ok || h.note) storage.appendChild(GV.app.banner("warn", h.note || "저장소에 문제가 있습니다."));
    var srow = U.el("div", { class: "gv-actions", style: "margin-top:12px" });
    srow.appendChild(GV.pages.database.btn("백업 내보내기", "download", false, function () {
      U.download("glovek-workspace-backup-" + U.fmtDate(new Date()) + ".json", S.exportBackup(), "application/json");
      S.tx({ op: "settings.update", targetType: "prefs", note: "백업 내보내기" }, function (d) {
        d.prefs.lastBackupAt = U.nowIso();
        return { ok: true, audit: { after: { lastBackupAt: d.prefs.lastBackupAt } } };
      });
      api.toast("백업 파일을 내려받았습니다.");
    }));
    var restore = U.el("input", { type: "file", accept: ".json,application/json", "aria-label": "백업 파일 선택", style: "max-width:200px" });
    restore.addEventListener("change", function () {
      if (restore.files && restore.files[0]) confirmRestore(restore.files[0], api);
    });
    srow.appendChild(restore);
    storage.appendChild(srow);
    storage.appendChild(U.el("p", {
      class: "gv-small gv-muted", style: "margin-top:8px",
      text: (state.prefs && state.prefs.lastBackupAt ? "마지막 백업 " + U.fmtDateTime(state.prefs.lastBackupAt) : "아직 백업한 적이 없습니다.")
        + " 복원 파일은 검증을 통과해야 반영됩니다."
    }));
    var reset = U.el("div", { class: "gv-actions", style: "margin-top:12px" });
    reset.appendChild(U.el("button", {
      type: "button", text: "예시 데이터로 초기화", onclick: function () { confirmReset(true, api); }
    }));
    reset.appendChild(U.el("button", {
      type: "button", text: "전부 비우기", onclick: function () { confirmReset(false, api); }
    }));
    storage.appendChild(reset);
    split.appendChild(storage);

    /* 화면 기본값 */
    var pref = U.el("div", { class: "gv-panel" });
    pref.appendChild(U.el("h3", { text: "화면 기본값" }));
    var p1 = U.el("label", { class: "gv-form-label" });
    p1.appendChild(U.el("span", { text: "시작 화면" }));
    var ps = U.el("select", { "aria-label": "시작 화면" });
    GV.app.PAGES.forEach(function (pg) {
      ps.appendChild(U.el("option", { value: pg.id, text: pg.label, selected: (state.prefs || {}).defaultPage === pg.id }));
    });
    ps.addEventListener("change", function () { savePref("defaultPage", ps.value, api); });
    p1.appendChild(ps);
    pref.appendChild(p1);
    var p2 = U.el("label", { class: "gv-form-label" });
    p2.appendChild(U.el("span", { text: "표 밀도" }));
    var ds = U.el("select", { "aria-label": "표 밀도" });
    ["조밀", "기본", "넉넉"].forEach(function (d) {
      ds.appendChild(U.el("option", { value: d, text: d, selected: (state.prefs || {}).density === d }));
    });
    ds.addEventListener("change", function () {
      GV.app.applyDensity(ds.value);
      savePref("density", ds.value, api);
    });
    p2.appendChild(ds);
    pref.appendChild(p2);
    pref.appendChild(U.el("p", { class: "gv-small gv-muted", text: "다음에 열 때도 이 설정이 유지됩니다." }));
    split.appendChild(pref);

    /* 구성원 */
    var team = U.el("div", { class: "gv-panel" });
    team.appendChild(U.el("h3", { text: "구성원 (예시 담당자 목록)" }));
    team.appendChild(GV.app.banner("warn",
      "브라우저에서 고르는 이름·역할은 보안 기능이 아닙니다. 실제 접근 제어는 서버 인증이 필요하며 이 프로토타입에는 없습니다(계획 단계로 표시)."));
    var list = U.el("div", { class: "gv-list" });
    (state.members || []).forEach(function (m) {
      var row = U.el("div", { class: "gv-task" });
      var g = U.el("div", { class: "gv-task-group" });
      g.appendChild(U.el("span", { class: "gv-avatar", text: m.name.slice(0, 1) }));
      var b = U.el("div");
      b.appendChild(U.el("strong", { text: m.name }));
      b.appendChild(U.el("p", { text: m.role + " · 담당 " + countFor(state, m.name) + "건" }));
      g.appendChild(b);
      row.appendChild(g);
      row.appendChild(U.el("button", {
        type: "button", class: "gv-quiet", text: "삭제",
        onclick: function () { removeMember(m.id, api); }
      }));
      list.appendChild(row);
    });
    team.appendChild(list);
    team.appendChild(U.el("button", {
      type: "button", style: "margin-top:12px", text: "구성원 추가", onclick: function () { memberForm(api); }
    }));
    split.appendChild(team);

    /* 연결 설정 초안 */
    var conn = U.el("div", { class: "gv-panel" });
    conn.appendChild(U.el("h3", { text: "연결 설정 (초안 · 저장만)" }));
    conn.appendChild(U.el("p", {
      text: "실제 연결은 없습니다. 여기 적은 값은 이 브라우저에만 남고 어디로도 전송되지 않습니다. 비밀키·토큰은 적지 마세요."
    }));
    var c = (state.prefs && state.prefs.connection) || {};
    var form = U.el("div");
    var f1 = U.el("label", { class: "gv-form-label" });
    f1.appendChild(U.el("span", { text: "운영 어드민 주소(메모용)" }));
    var i1 = U.el("input", { type: "text", value: c.adminApiUrl || "", placeholder: "https://example.invalid", maxlength: "200" });
    f1.appendChild(i1);
    form.appendChild(f1);
    var f2 = U.el("label", { class: "gv-form-label" });
    f2.appendChild(U.el("span", { text: "시트 ID(메모용)" }));
    var i2 = U.el("input", { type: "text", value: c.sheetId || "", placeholder: "메모만 합니다", maxlength: "120" });
    f2.appendChild(i2);
    form.appendChild(f2);
    var f3 = U.el("label", { class: "gv-form-label" });
    f3.appendChild(U.el("span", { text: "메모" }));
    var i3 = U.el("textarea", { rows: "3", maxlength: "400" });
    i3.value = c.note || "";
    f3.appendChild(i3);
    form.appendChild(f3);
    conn.appendChild(form);
    var crow = U.el("div", { class: "gv-actions", style: "margin-top:10px" });
    crow.appendChild(U.el("button", {
      type: "button", class: "gv-primary", text: "초안 저장",
      onclick: function () {
        if (/(key|token|secret|비밀|password)/i.test(i3.value) || /(key|token|secret)=/i.test(i1.value)) {
          api.toast("비밀키·토큰처럼 보이는 값은 저장하지 않습니다. 메모에서 지워 주세요.", { kind: "bad", sticky: true });
          return;
        }
        var url = i1.value ? U.safeUrl(i1.value) : "";
        if (i1.value && !url) { api.toast("주소는 http(s) 형식만 저장합니다.", { kind: "bad" }); return; }
        var r = S.tx({ op: "connection.save", targetType: "prefs", note: "연결 초안 저장" }, function (d) {
          var before = JSON.parse(JSON.stringify(d.prefs.connection || {}));
          d.prefs.connection = {
            adminApiUrl: url || "", sheetId: U.clean(i2.value, 120),
            note: U.clean(i3.value, 400), savedAt: U.nowIso()
          };
          return { ok: true, audit: { before: before, after: d.prefs.connection } };
        });
        if (!r.ok) { api.toast(r.error, { kind: "bad" }); return; }
        api.toast("초안을 저장했습니다. 연결은 되지 않습니다.");
      }
    }));
    crow.appendChild(U.el("button", {
      type: "button", text: "연결 테스트",
      onclick: function () {
        api.toast("연결할 백엔드가 없습니다. 이 프로토타입은 브라우저 안에서만 동작하며 요청을 보내지 않았습니다.", { kind: "warn", ms: 7000 });
      }
    }));
    conn.appendChild(crow);
    if (c.savedAt) conn.appendChild(U.el("p", { class: "gv-small gv-muted", style: "margin-top:8px", text: "마지막 저장 " + U.fmtDateTime(c.savedAt) }));
    split.appendChild(conn);

    /* 권한 — 계획 */
    var roles = U.el("div", { class: "gv-panel" });
    roles.appendChild(U.el("h3", { text: "권한 (계획 · 실제 적용 안 됨)" }));
    var rt = U.el("dl", { class: "gv-kv" });
    kv(rt, "대표", "전체 열람·수정 (계획)");
    kv(rt, "영업 리드", "담당 조직 열람·수정 (계획)");
    kv(rt, "영업 담당", "본인 담당 건만 (계획)");
    kv(rt, "읽기 전용", "열람만 (계획)");
    roles.appendChild(rt);
    roles.appendChild(U.el("p", {
      class: "gv-small gv-muted", style: "margin-top:8px",
      text: "이 표는 앞으로 서버에서 적용할 계획을 적은 것입니다. 지금 이 화면은 로그인이 없고 누구나 모든 데이터를 볼 수 있습니다."
    }));
    split.appendChild(roles);

    wrap.appendChild(split);
    return wrap;
  }

  function kv(dl, k, v) {
    dl.appendChild(U.el("dt", { text: k }));
    dl.appendChild(U.el("dd", { text: v == null ? "-" : String(v) }));
  }
  function countFor(state, name) {
    return (state.entities || []).filter(function (e) { return e.owner === name; }).length;
  }

  function savePref(key, value, api) {
    var r = S.tx({ op: "settings.update", targetType: "prefs", note: key + " 변경" }, function (d) {
      var before = d.prefs[key];
      d.prefs[key] = value;
      return { ok: true, audit: { before: before, after: value } };
    });
    if (!r.ok) { api.toast(r.error, { kind: "bad" }); return; }
    api.toast("설정을 저장했습니다.");
  }

  function memberForm(api) {
    var body = U.el("div");
    var w1 = U.el("label", { class: "gv-form-label" });
    w1.appendChild(U.el("span", { text: "이름 *" }));
    w1.appendChild(U.el("input", { name: "name", type: "text", maxlength: "30", placeholder: "예: 박다연" }));
    body.appendChild(w1);
    var w2 = U.el("label", { class: "gv-form-label" });
    w2.appendChild(U.el("span", { text: "역할" }));
    var s = U.el("select", { name: "role" });
    ["영업 담당", "영업 리드", "읽기 전용"].forEach(function (r) {
      s.appendChild(U.el("option", { value: r, text: r }));
    });
    w2.appendChild(s);
    body.appendChild(w2);
    GV.app.modal({
      title: "구성원 추가", help: "예시 담당자 목록에만 쓰입니다. 로그인 계정이 아닙니다.",
      body: body, actions: [{ label: "추가", primary: true }],
      onSubmit: function (v) {
        var name = U.clean(v.name, 30);
        if (!name) return "이름을 입력해 주세요.";
        var r = S.tx({ op: "member.create", targetType: "member", note: "구성원 추가" }, function (d) {
          if ((d.members || []).some(function (m) { return m.name === name; })) {
            return { ok: false, error: "같은 이름의 구성원이 이미 있습니다." };
          }
          if ((d.members || []).length >= 30) return { ok: false, error: "구성원은 30명까지 담을 수 있습니다." };
          var m = { id: U.uid("mem"), name: name, role: v.role, active: true };
          d.members.push(m);
          return { ok: true, audit: { targetId: m.id, targetName: name, after: { name: name, role: m.role } } };
        });
        if (!r.ok) return r.error;
        GV.app.toast("구성원을 추가했습니다.");
        return true;
      }
    });
  }

  function removeMember(id, api) {
    var state = S.get();
    var m = (state.members || []).find(function (x) { return x.id === id; });
    if (!m) return;
    var n = countFor(state, m.name);
    GV.app.modal({
      title: "구성원 삭제",
      help: n ? m.name + " 님이 담당인 업체가 " + n + "건 있습니다. 삭제해도 그 업체의 담당자 값은 그대로 남습니다." : "",
      body: U.el("div"), actions: [{ label: "삭제", primary: true }],
      onSubmit: function () {
        var r = S.tx({ op: "member.delete", targetType: "member", targetId: id, note: "구성원 삭제" }, function (d) {
          var before = (d.members || []).find(function (x) { return x.id === id; });
          if (!before) return { ok: false, error: "구성원을 찾지 못했습니다." };
          d.members = d.members.filter(function (x) { return x.id !== id; });
          return { ok: true, audit: { targetName: before.name, before: { name: before.name, role: before.role } } };
        });
        if (!r.ok) return r.error;
        api.toast("구성원을 지웠습니다.");
        return true;
      }
    });
  }

  function confirmRestore(file, api) {
    if (file.size > 20 * 1024 * 1024) { api.toast("백업 파일이 너무 큽니다(20MB 초과).", { kind: "bad" }); return; }
    var reader = new FileReader();
    reader.onerror = function () { api.toast("파일을 읽지 못했습니다.", { kind: "bad" }); };
    reader.onload = function () {
      var text = String(reader.result);
      var peek = S.validate(safeParse(text));
      var body = U.el("div");
      if (!peek.ok) {
        body.appendChild(U.el("p", { text: "이 파일은 복원할 수 없습니다 — " + peek.error }));
        body.appendChild(U.el("p", { class: "gv-small gv-muted", text: "현재 데이터는 그대로 남아 있습니다." }));
        GV.app.modal({
          title: "복원할 수 없는 파일", body: body,
          actions: [{ label: "닫기", primary: true, cancel: true }],
          onSubmit: function () { return true; }
        });
        return;
      }
      body.appendChild(U.el("p", {
        text: "현재 데이터를 이 백업으로 바꿉니다. 업체 " + (peek.data.entities || []).length
          + "건 · 기회 " + (peek.data.deals || []).length + "건이 들어옵니다. 변경 이력은 합쳐집니다."
      }));
      GV.app.modal({
        title: "백업 복원", body: body, actions: [{ label: "복원", primary: true }],
        onSubmit: function () {
          var r = S.importBackup(text);
          if (!r.ok) return r.error;
          api.toast("복원했습니다." + (r.warning ? " (" + r.warning + ")" : ""), { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
          return true;
        }
      });
    };
    reader.readAsText(file, "utf-8");
  }
  function safeParse(text) {
    try {
      var p = JSON.parse(text);
      return p && p.kind === "glovek-workspace-backup" ? p.data : p;
    } catch (e) { return null; }
  }

  function confirmReset(reseed, api) {
    var body = U.el("div");
    body.appendChild(U.el("p", {
      text: reseed
        ? "지금 데이터를 모두 지우고 예시 데이터를 새로 만듭니다. 되돌릴 수 없습니다."
        : "지금 데이터를 모두 지웁니다(빈 상태). 되돌릴 수 없습니다."
    }));
    var w = U.el("label", { class: "gv-form-label" });
    w.appendChild(U.el("span", { text: '확인을 위해 "초기화" 라고 입력해 주세요.' }));
    w.appendChild(U.el("input", { name: "confirm", type: "text", autocomplete: "off" }));
    body.appendChild(w);
    body.appendChild(U.el("p", { class: "gv-small gv-muted", text: "먼저 백업을 내려받아 두는 것을 권합니다." }));
    GV.app.modal({
      title: reseed ? "예시 데이터로 초기화" : "전부 비우기", body: body,
      actions: [{ label: "초기화", primary: true }],
      onSubmit: function (v) {
        if (U.clean(v.confirm) !== "초기화") return '"초기화" 를 정확히 입력해 주세요.';
        var r = S.reset(reseed);
        api.toast(reseed ? "예시 데이터로 다시 만들었습니다." : "모두 비웠습니다.",
          { kind: r.warning ? "warn" : "ok", sticky: !!r.warning });
        GV.app.closeDetail();
        return true;
      }
    });
  }

  GV.pages = GV.pages || {};
  GV.pages.settings = { render: render };
})(window);
