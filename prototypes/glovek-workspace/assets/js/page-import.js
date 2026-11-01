/* Glovek Workspace — 가져오기·연결
 *   CSV / XLSX 를 읽어 필드를 맞추고, 미리보기와 검증을 거친 뒤 "반영" 을 눌러야 쓴다.
 *   · 외부 ID 로 업서트한다. 이름만 같다고 합치지 않는다(중복 후보로만 알려 준다).
 *   · 재적재해도 사람이 적은 메모·준비도 지정·확인된 매출 묶음은 지킨다.
 *   · 오류 행은 쓰지 않고 따로 CSV 로 내려받을 수 있다. 건너뜀·오류 건수를 그대로 보고한다.
 *   · 운영 API·Google Sheet 연결은 없다. 테스트 버튼은 "백엔드 없음" 을 사실대로 말한다.
 */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util, S = GV.store, M = GV.model;

  var draft = null;   /* {fileName, headers, rows, mapping, analysis} */

  function render(state, api) {
    var wrap = U.el("div");
    var head = U.el("div", { class: "gv-page-head" });
    var left = U.el("div");
    left.appendChild(U.el("h1", { text: "가져오기·연결" }));
    left.appendChild(U.el("p", { text: "CSV·XLSX 파일을 올리면 열을 맞춰 미리 보고, 확인한 뒤에만 반영합니다." }));
    head.appendChild(left);
    var acts = U.el("div", { class: "gv-actions" });
    acts.appendChild(GV.pages.database.btn("예시 CSV 내려받기", "download", false, function () { sampleCsv(api); }));
    head.appendChild(acts);
    wrap.appendChild(head);

    /* 연결 상태 — 사실만 */
    var conn = U.el("div", { class: "gv-split", style: "margin-bottom:16px" });
    conn.appendChild(sourceCard(
      "운영 어드민 API", "미연결",
      "이 화면은 브라우저 안에서만 동작합니다. 운영 어드민에 요청을 보내지 않습니다.",
      state, api));
    conn.appendChild(sourceCard(
      "Google Sheet 동기화", "미연결",
      "시트 자동 기록은 이 프로토타입과 무관합니다. 기존 운영 동기화에도 영향을 주지 않습니다.",
      state, api));
    conn.appendChild(sourceCard(
      "메일함(Gmail 등)", "미연결",
      "받은 메일이 자동으로 들어오지 않습니다. 커뮤니케이션 화면에서 직접 적는 방식입니다.",
      state, api));
    wrap.appendChild(conn);

    /* 업로드 */
    var zone = U.el("div", { class: "gv-dropzone" });
    zone.appendChild(U.el("h3", { text: "파일 올리기" }));
    zone.appendChild(U.el("p", {
      class: "gv-small gv-muted",
      text: "CSV(.csv) 또는 엑셀(.xlsx). 첫 줄은 헤더여야 합니다. 여기로 끌어다 놓아도 됩니다."
    }));
    zone.appendChild(U.el("p", {
      class: "gv-small gv-muted",
      text: "엑셀은 첫 번째 시트만 읽습니다(시트 고르기는 없습니다). 날짜에 시각이 들어 있으면 분까지 가져옵니다."
    }));
    var input = U.el("input", { type: "file", accept: ".csv,.xlsx,text/csv", "aria-label": "가져올 파일 선택", style: "margin-top:10px" });
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) readFile(input.files[0], api);
    });
    zone.appendChild(input);
    zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("is-over"); });
    zone.addEventListener("dragleave", function () { zone.classList.remove("is-over"); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault(); zone.classList.remove("is-over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f, api);
    });
    wrap.appendChild(zone);

    if (draft) wrap.appendChild(mapper(state, api));

    /* 가져오기 이력 */
    var runs = (state.imports || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var hist = U.el("div", { style: "margin-top:22px" });
    hist.appendChild(U.el("h2", { text: "가져오기 이력 " + runs.length + "건" }));
    if (!runs.length) hist.appendChild(U.el("p", { class: "gv-small gv-muted", text: "아직 없습니다." }));
    else {
      var box = U.el("div", { class: "gv-logbox" });
      runs.slice(0, 20).forEach(function (r) {
        var line = U.el("div", { class: "gv-logline" });
        var l = U.el("div");
        l.appendChild(U.el("strong", { text: r.file }));
        l.appendChild(U.el("div", {
          class: "gv-small gv-muted",
          text: U.fmtDateTime(r.at) + " · " + r.actor + (r.note ? " · " + r.note : "")
        }));
        line.appendChild(l);
        var right = U.el("div", { class: "gv-small", style: "text-align:right;white-space:nowrap" });
        right.textContent = "전체 " + r.rows + " · 신규 " + r.created + " · 갱신 " + r.updated
          + " · 건너뜀 " + r.skipped + " · 오류 " + r.errors;
        line.appendChild(right);
        box.appendChild(line);
      });
      hist.appendChild(box);
      hist.appendChild(U.el("p", {
        class: "gv-small gv-muted", style: "margin-top:8px",
        text: "각 업체의 출처는 외부 ID 와 이 이력으로 되짚을 수 있습니다(업체 상세의 변경 이력 참고)."
      }));
    }
    wrap.appendChild(hist);
    return wrap;
  }

  function sourceCard(title, status, note, state, api) {
    var p = U.el("div", { class: "gv-panel" });
    var top = U.el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:flex-start" });
    top.appendChild(U.el("h3", { text: title }));
    top.appendChild(U.el("span", { class: "gv-chip warn", text: status }));
    p.appendChild(top);
    p.appendChild(U.el("p", { text: note }));
    p.appendChild(U.el("button", {
      type: "button", style: "margin-top:10px", text: "연결 테스트",
      onclick: function () {
        api.toast(title + ": 연결할 백엔드가 없습니다. 이 프로토타입은 브라우저 안에서만 동작합니다(요청을 보내지 않았습니다).", { kind: "warn", ms: 7000 });
      }
    }));
    return p;
  }

  /* ── 파일 읽기 ──────────────────────────────── */
  function readFile(file, api) {
    var name = U.clean(file.name, 120);
    if (file.size > 8 * 1024 * 1024) {
      api.toast("파일이 너무 큽니다(8MB 초과). 나눠서 올려 주세요.", { kind: "bad" });
      return;
    }
    if (/\.xlsx$/i.test(name)) {
      api.toast("엑셀 파일을 읽고 있습니다…");
      GV.xlsx.parse(file).then(function (res) {
        if (!res.rows.length) throw new Error("첫 번째 시트에 행이 없습니다.");
        start(name + " · " + res.sheetName, res.rows, api);
        if (res.sheets > 1) {
          api.toast("시트가 " + res.sheets + "개입니다. 첫 번째 시트(" + res.sheetName + ")만 읽었습니다.",
            { kind: "warn", ms: 7000 });
        }
      }).catch(function (e) {
        api.toast("엑셀을 읽지 못했습니다 — " + (e.message || "원인 미상"), { kind: "bad", sticky: true });
      });
      return;
    }
    if (!/\.csv$/i.test(name) && file.type !== "text/csv") {
      api.toast("CSV 또는 XLSX 만 읽을 수 있습니다.", { kind: "bad" });
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { api.toast("파일을 읽지 못했습니다.", { kind: "bad" }); };
    reader.onload = function () {
      try {
        var rows = U.parseCsv(String(reader.result));
        if (!rows.length) throw new Error("빈 파일입니다.");
        start(name, rows, api);
      } catch (e) {
        api.toast("CSV 를 읽지 못했습니다 — " + (e.message || "형식 오류"), { kind: "bad", sticky: true });
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function start(fileName, rows, api) {
    var headers = (rows[0] || []).map(function (h) { return U.clean(h, 60); });
    if (headers.filter(Boolean).length < 2) {
      api.toast("첫 줄에서 헤더를 찾지 못했습니다. 열 이름이 있는 파일을 올려 주세요.", { kind: "bad" });
      return;
    }
    var mapping = headers.map(function (h) { return M.guessField(h); });
    /* 같은 필드가 두 열에 잡히면 뒤쪽을 비운다 */
    var seen = {};
    mapping = mapping.map(function (f) {
      if (!f) return "";
      if (seen[f]) return "";
      seen[f] = true;
      return f;
    });
    draft = { fileName: fileName, headers: headers, rows: rows.slice(1), mapping: mapping };
    GV.app.render();
    api.toast(draft.rows.length + "행을 읽었습니다. 열 연결을 확인하고 '검증·미리보기' 를 누르세요.");
  }

  /* ── 매핑 화면 ──────────────────────────────── */
  function mapper(state, api) {
    var sec = U.el("div", { class: "gv-panel", style: "margin-top:16px" });
    var top = U.el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap" });
    var l = U.el("div");
    l.appendChild(U.el("h3", { text: "열 연결 — " + draft.fileName }));
    l.appendChild(U.el("p", { text: draft.rows.length + "행. 업체명은 반드시 연결해야 합니다. '외부 ID' 를 연결하면 그 값으로 기존 행을 갱신합니다." }));
    top.appendChild(l);
    top.appendChild(U.el("button", { type: "button", text: "취소", onclick: function () { draft = null; GV.app.render(); } }));
    sec.appendChild(top);

    var tw = U.el("div", { class: "gv-table-wrap", style: "margin-top:12px;max-height:300px" });
    var table = U.el("table", { class: "gv-map-table" });
    var thead = U.el("thead");
    var hr = U.el("tr");
    ["파일 열", "예시 값", "우리 필드"].forEach(function (h) { hr.appendChild(U.el("th", { scope: "col", text: h })); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = U.el("tbody");
    draft.headers.forEach(function (h, i) {
      var tr = U.el("tr");
      tr.appendChild(U.el("td", { text: h || "(이름 없음)" }));
      var sample = (draft.rows.find(function (r) { return U.clean(r[i]); }) || [])[i];
      tr.appendChild(U.el("td", { class: "gv-small gv-muted", text: U.clean(sample, 40) || "-" }));
      var td = U.el("td");
      var sel = U.el("select", { "aria-label": (h || "열 " + (i + 1)) + " 연결" });
      sel.appendChild(U.el("option", { value: "", text: "(가져오지 않음)" }));
      M.IMPORT_FIELDS.forEach(function (f) {
        sel.appendChild(U.el("option", { value: f.key, text: f.label, selected: draft.mapping[i] === f.key }));
      });
      sel.addEventListener("change", function () {
        /* 같은 필드를 두 열에 쓰지 못하게 한다 */
        if (sel.value) {
          draft.mapping.forEach(function (m, j) { if (j !== i && m === sel.value) draft.mapping[j] = ""; });
        }
        draft.mapping[i] = sel.value;
        draft.analysis = null;
        GV.app.render();
      });
      td.appendChild(sel);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tw.appendChild(table);
    sec.appendChild(tw);

    var row = U.el("div", { class: "gv-actions", style: "margin-top:12px" });
    row.appendChild(GV.pages.database.btn("검증·미리보기", "check", true, function () {
      var res = analyze(state, draft);
      if (res.error) { api.toast(res.error, { kind: "bad" }); return; }
      draft.analysis = res;
      GV.app.render();
    }));
    sec.appendChild(row);

    if (draft.analysis) sec.appendChild(preview(state, draft.analysis, api));
    return sec;
  }

  /* ── 검증 ───────────────────────────────────── */
  function analyze(state, d) {
    var nameCol = d.mapping.indexOf("name");
    if (nameCol < 0) return { error: "업체·크리에이터명 열을 연결해 주세요." };
    var extCol = d.mapping.indexOf("extId");
    var byExt = new Map();
    state.entities.forEach(function (e) { if (e.extId) byExt.set(String(e.extId).toLowerCase(), e); });
    var byName = new Map();
    state.entities.forEach(function (e) {
      var k = e.name.replace(/\s/g, "").toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(e);
    });

    var creates = [], updates = [], errors = [], dupes = [];
    var seenExt = new Set();

    d.rows.forEach(function (raw, idx) {
      var rowNo = idx + 2;   /* 헤더가 1행 */
      var rec = {}, problems = [];
      d.mapping.forEach(function (field, col) {
        if (!field) return;
        rec[field] = U.clean(raw[col], 400);
      });
      var name = U.clean(rec.name, 80);
      if (!name) { errors.push({ rowNo: rowNo, raw: raw, reason: "업체명이 비어 있습니다." }); return; }

      var ext = rec.extId ? String(rec.extId).trim() : "";
      if (ext && seenExt.has(ext.toLowerCase())) {
        errors.push({ rowNo: rowNo, raw: raw, reason: "파일 안에서 외부 ID 가 중복됩니다: " + ext });
        return;
      }
      if (ext) seenExt.add(ext.toLowerCase());

      var parsed = { name: name };
      if (rec.legalName) parsed.legalName = U.clean(rec.legalName, 80);
      if (rec.kind) parsed.kind = /크리에이터|creator/i.test(rec.kind) ? "creator" : "company";
      if (rec.category) parsed.category = U.clean(rec.category, 40);
      if (rec.source) parsed.source = U.clean(rec.source, 40);
      if (rec.owner) parsed.owner = U.clean(rec.owner, 30);
      if (rec.quality) {
        var q = U.clean(rec.quality, 10).toUpperCase();
        if (["A", "B", "C"].indexOf(q) >= 0) parsed.quality = q;
        else if (q) problems.push("등급 '" + q + "' 은 A/B/C 가 아니어서 건너뜀");
      }
      if (rec.inflowAt) {
        var dt = U.parseDate(rec.inflowAt);
        if (!dt) problems.push("유입일 '" + U.clean(rec.inflowAt, 20) + "' 을 날짜로 읽지 못해 건너뜀");
        else parsed.inflowAt = dt.toISOString();
      }
      if (rec.phone) {
        var ph = U.safePhone(rec.phone);
        if (!ph) problems.push("전화번호 형식이 아니어서 건너뜀");
        else parsed.phone = ph;
      }
      if (rec.email) {
        var em = U.safeEmail(rec.email);
        if (!em) problems.push("이메일 형식이 아니어서 건너뜀");
        else parsed.email = em;
      }
      if (rec.website) {
        var ws = U.safeUrl(rec.website);
        if (!ws) problems.push("홈페이지가 http(s) 주소가 아니어서 건너뜀");
        else parsed.website = ws;
      }
      if (rec.memo) parsed.memo = U.clean(rec.memo, 600);
      if (rec.contactName) parsed.contactName = U.clean(rec.contactName, 40);

      /* 매출 묶음 — 금액이 없으면 아예 손대지 않는다(미확인을 0 으로 만들지 않는다) */
      if (rec.revenueAmount !== undefined && rec.revenueAmount !== "") {
        var amt = U.intOrNull(rec.revenueAmount);
        if (amt == null || amt < 0 || amt > 1e15) {
          errors.push({ rowNo: rowNo, raw: raw, reason: "회사 연매출 '" + U.clean(rec.revenueAmount, 20) + "' 을 숫자로 읽지 못했습니다." });
          return;
        }
        parsed.revenueAmount = amt;
        if (rec.revenueYear) {
          var yr = U.intOrNull(rec.revenueYear);
          if (yr == null || yr < 1990 || yr > new Date().getFullYear()) {
            errors.push({ rowNo: rowNo, raw: raw, reason: "매출 기준연도 '" + U.clean(rec.revenueYear, 10) + "' 이 범위를 벗어났습니다." });
            return;
          }
          parsed.revenueYear = yr;
        }
        if (rec.revenueScope) {
          var sc = U.clean(rec.revenueScope, 40);
          parsed.revenueScope = /연결|consolidated/i.test(sc) ? "company_consolidated"
            : /별도|separate/i.test(sc) ? "company_separate"
            : /브랜드|brand/i.test(sc) ? "brand" : "";
          if (!parsed.revenueScope) problems.push("매출 범위 '" + sc + "' 를 알 수 없어 미확인으로 둠");
        }
        if (rec.revenueSourceUrl) {
          var su = U.safeUrl(rec.revenueSourceUrl);
          if (!su) problems.push("매출 근거 URL 이 http(s) 가 아니어서 건너뜀");
          else parsed.revenueSourceUrl = su;
        }
      }

      var target = ext ? byExt.get(ext.toLowerCase()) : null;
      var item = { rowNo: rowNo, ext: ext, parsed: parsed, problems: problems };
      if (target) {
        item.targetId = target.id;
        item.targetName = target.name;
        updates.push(item);
      } else {
        creates.push(item);
        var nameHits = byName.get(name.replace(/\s/g, "").toLowerCase()) || [];
        if (nameHits.length) {
          dupes.push({ rowNo: rowNo, name: name, candidates: nameHits.map(function (e) { return { id: e.id, name: e.name, extId: e.extId, owner: e.owner }; }) });
        }
      }
    });

    return { creates: creates, updates: updates, errors: errors, dupes: dupes, total: d.rows.length };
  }

  /* ── 미리보기 ───────────────────────────────── */
  function preview(state, a, api) {
    var box = U.el("div", { style: "margin-top:16px" });
    var cards = U.el("div", { class: "gv-cards" });
    cards.appendChild(GV.pages.database.stat("전체 행", a.total + "행", ""));
    cards.appendChild(GV.pages.database.stat("새로 만들 건", a.creates.length + "건", ""));
    cards.appendChild(GV.pages.database.stat("갱신할 건", a.updates.length + "건", "외부 ID 일치"));
    cards.appendChild(GV.pages.database.stat("오류로 제외", a.errors.length + "건", "쓰지 않습니다"));
    box.appendChild(cards);

    if (a.dupes.length) {
      box.appendChild(GV.app.banner("warn",
        "이름이 같은 기존 업체가 " + a.dupes.length + "건 있습니다. 이름만으로 자동 합치지 않고 새 레코드로 만듭니다. 아래 후보를 확인하세요."));
      var dl = U.el("div", { class: "gv-logbox" });
      a.dupes.slice(0, 12).forEach(function (d) {
        var line = U.el("div", { class: "gv-logline" });
        line.appendChild(U.el("div", { text: d.rowNo + "행 · " + d.name }));
        var right = U.el("div", { class: "gv-small gv-muted" });
        right.textContent = "기존: " + d.candidates.map(function (c) { return c.name + "(" + c.extId + ", " + c.owner + ")"; }).join(", ");
        line.appendChild(right);
        dl.appendChild(line);
      });
      box.appendChild(dl);
    }

    if (a.errors.length) {
      var eb = U.el("div", { style: "margin-top:12px" });
      eb.appendChild(GV.app.banner("bad", a.errors.length + "행은 값이 올바르지 않아 반영하지 않습니다. 아래 버튼으로 내려받아 고친 뒤 다시 올려 주세요."));
      var list = U.el("div", { class: "gv-logbox" });
      a.errors.slice(0, 10).forEach(function (e) {
        var line = U.el("div", { class: "gv-logline" });
        line.appendChild(U.el("div", { text: e.rowNo + "행" }));
        line.appendChild(U.el("div", { class: "gv-small", text: e.reason }));
        list.appendChild(line);
      });
      eb.appendChild(list);
      eb.appendChild(U.el("button", {
        type: "button", style: "margin-top:10px", text: "오류 행 CSV 내려받기",
        onclick: function () {
          var header = ["행번호", "사유"].concat(draft.headers);
          var rows = a.errors.map(function (e) { return [e.rowNo, e.reason].concat(e.raw || []); });
          U.download("glovek-import-errors.csv", U.toCsv([header].concat(rows)));
          api.toast(a.errors.length + "건의 오류 행을 내려받았습니다.");
        }
      }));
      box.appendChild(eb);
    }

    /* 표 미리보기 */
    var samples = a.updates.slice(0, 5).map(function (x) { return ["갱신", x]; })
      .concat(a.creates.slice(0, 5).map(function (x) { return ["신규", x]; }));
    if (samples.length) {
      var tw = U.el("div", { class: "gv-table-wrap", style: "margin-top:12px;max-height:320px" });
      var table = U.el("table");
      var thead = U.el("thead");
      var hr = U.el("tr");
      ["구분", "행", "업체명", "외부ID", "카테고리", "유입일시(KST)", "담당자", "회사 연매출", "주의"].forEach(function (h) {
        hr.appendChild(U.el("th", { scope: "col", text: h }));
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = U.el("tbody");
      samples.forEach(function (s) {
        var kind = s[0], x = s[1];
        var tr = U.el("tr");
        tr.appendChild(U.el("td", {}, [U.el("span", { class: "gv-chip " + (kind === "신규" ? "info" : ""), text: kind })]));
        tr.appendChild(U.el("td", { class: "gv-number", text: String(x.rowNo) }));
        tr.appendChild(U.el("td", { text: x.parsed.name }));
        tr.appendChild(U.el("td", { text: x.ext || "-" }));
        tr.appendChild(U.el("td", { text: x.parsed.category || "-" }));
        tr.appendChild(U.el("td", { class: "gv-nowrap gv-number", text: x.parsed.inflowAt ? U.fmtKst(x.parsed.inflowAt) : "변경 없음" }));
        tr.appendChild(U.el("td", { text: x.parsed.owner || "-" }));
        tr.appendChild(U.el("td", { text: x.parsed.revenueAmount != null ? U.won(x.parsed.revenueAmount) : "변경 없음" }));
        tr.appendChild(U.el("td", { class: "gv-small gv-muted", text: x.problems.length ? x.problems.join(" / ") : "-" }));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      tw.appendChild(table);
      box.appendChild(tw);
      box.appendChild(U.el("p", { class: "gv-small gv-muted", style: "margin-top:6px", text: "앞부분만 보여 줍니다. 반영하면 전체가 적용됩니다." }));
    }

    box.appendChild(GV.app.banner("info",
      "반영해도 사람이 적은 메모·준비도 직접 지정·확인된(L3) 매출 묶음은 덮어쓰지 않습니다. 비어 있는 열은 기존 값을 그대로 둡니다."));

    var row = U.el("div", { class: "gv-actions", style: "margin-top:12px" });
    row.appendChild(GV.pages.database.btn(
      "반영하기 (신규 " + a.creates.length + " · 갱신 " + a.updates.length + ")", "upload", true,
      function () { confirmCommit(a, api); }));
    row.appendChild(U.el("button", { type: "button", text: "취소", onclick: function () { draft = null; GV.app.render(); } }));
    box.appendChild(row);
    return box;
  }

  function confirmCommit(a, api) {
    if (!a.creates.length && !a.updates.length) {
      api.toast("반영할 행이 없습니다.", { kind: "warn" });
      return;
    }
    var body = U.el("div");
    body.appendChild(U.el("p", {
      text: "신규 " + a.creates.length + "건, 갱신 " + a.updates.length + "건을 로컬 저장소에 반영합니다. "
        + "오류 " + a.errors.length + "건은 반영하지 않습니다."
    }));
    GV.app.modal({
      title: "가져오기 반영", body: body,
      actions: [{ label: "반영", primary: true }],
      onSubmit: function () { commit(a, api); return true; }
    });
  }

  /* ── 반영 ───────────────────────────────────── */
  function commit(a, api) {
    var fileName = draft.fileName;
    var r = S.tx({ op: "import.commit", targetType: "import", note: "가져오기 반영 — " + fileName }, function (st) {
      var created = 0, updated = 0, skipped = 0, preserved = 0;
      a.updates.forEach(function (x) {
        var e = M.entityById(st, x.targetId);
        if (!e) { skipped += 1; return; }
        var changed = applyTo(e, x.parsed, true);
        if (changed.changedCount) updated += 1; else skipped += 1;
        preserved += changed.preserved;
      });
      a.creates.forEach(function (x) {
        var id = U.uid("ent");
        var e = {
          id: id, extId: x.ext || ("IMP-" + id.slice(-6).toUpperCase()),
          kind: "company", name: x.parsed.name, legalName: "", category: "미분류",
          source: "엑셀 업로드", inflowAt: U.nowIso(), owner: "미배정", quality: "미분류",
          readiness: "L0", readinessOverride: null,
          phone: "", email: "", website: "", followers: null,
          revenue: { amount: null, year: null, currency: "KRW", legalEntity: "", scope: "", status: "unknown", sourceUrl: "" },
          memo: "", contacts: [],
          createdAt: U.nowIso(), updatedAt: U.nowIso(), lastCommAt: null, nextActionAt: null, nextAction: "",
          importedFrom: { file: fileName, rowNo: x.rowNo, at: U.nowIso() }
        };
        applyTo(e, x.parsed, false);
        st.entities.unshift(e);
        created += 1;
      });
      st.imports = st.imports || [];
      st.imports.unshift({
        id: U.uid("imp"), at: U.nowIso(), actor: "로컬 사용자", file: fileName,
        rows: a.total, created: created, updated: updated, skipped: skipped, errors: a.errors.length,
        note: preserved ? "사람이 적은 값 " + preserved + "건 보존" : ""
      });
      return {
        ok: true, counts: { created: created, updated: updated, skipped: skipped, preserved: preserved },
        audit: {
          targetName: fileName,
          after: { rows: a.total, created: created, updated: updated, skipped: skipped, errors: a.errors.length, preserved: preserved }
        }
      };
    });
    if (!r.ok) {
      /* 저장이 실패하면 아무것도 반영되지 않는다. 검토 화면을 그대로 두어 다시 시도할 수 있게 한다. */
      api.toast(r.error + (r.storage ? " 검토 내용은 그대로 두었습니다 — 백업을 내려받고 공간을 비운 뒤 다시 '반영하기' 를 누르세요." : ""),
        { kind: "bad", sticky: true });
      return;
    }
    var c = r.data.counts;
    draft = null;
    api.toast("반영했습니다 — 신규 " + c.created + " · 갱신 " + c.updated + " · 변경 없음 " + c.skipped
      + " · 오류 제외 " + a.errors.length + (c.preserved ? " · 사람이 적은 값 " + c.preserved + "건 보존" : "")
      + (r.warning ? " (" + r.warning + ")" : ""),
      { kind: r.warning ? "warn" : "ok", sticky: true });
  }

  /**
   * 파싱된 값을 레코드에 올린다.
   *   protect=true 이면 사람이 적은 것(메모·준비도 지정·L3 매출)을 덮어쓰지 않는다.
   */
  function applyTo(e, p, protect) {
    var changedCount = 0, preserved = 0;
    function set(field, value) {
      if (value === undefined || value === "" || value == null) return;
      if (e[field] === value) return;
      e[field] = value;
      changedCount += 1;
    }
    set("name", p.name);
    set("legalName", p.legalName);
    set("kind", p.kind);
    set("category", p.category);
    set("source", p.source);
    set("owner", p.owner);
    set("quality", p.quality);
    set("inflowAt", p.inflowAt);
    set("phone", p.phone);
    set("email", p.email);
    set("website", p.website);

    if (p.memo !== undefined && p.memo !== "") {
      if (protect && U.clean(e.memo)) preserved += 1;        /* 사람이 적은 메모를 지킨다 */
      else { e.memo = p.memo; changedCount += 1; }
    }
    if (p.contactName) {
      e.contacts = e.contacts || [];
      var exists = e.contacts.some(function (c) { return c.name === p.contactName; });
      if (!exists && e.contacts.length < 12) {
        e.contacts.push({
          id: U.uid("ct"), name: p.contactName, role: "", phone: p.phone || "", email: p.email || "",
          primary: e.contacts.length === 0
        });
        changedCount += 1;
      }
    }
    if (p.revenueAmount !== undefined) {
      var verified = e.revenue && e.revenue.status === "verified" && e.revenue.amount != null;
      if (protect && verified) preserved += 1;                /* 확인된 매출 묶음을 지킨다 */
      else {
        e.revenue = e.revenue || {};
        e.revenue.amount = p.revenueAmount;
        e.revenue.currency = "KRW";
        if (p.revenueYear !== undefined) e.revenue.year = p.revenueYear;
        if (p.revenueScope !== undefined) e.revenue.scope = p.revenueScope;
        if (p.revenueSourceUrl !== undefined) e.revenue.sourceUrl = p.revenueSourceUrl;
        /* 가져온 값은 "고객 신고" 까지다. 파일만 보고 근거 확인(verified)으로 올리지 않는다.
           verified 는 금액·연도·귀속 법인·회사 범위·근거 URL 이 모두 갖춰진 뒤 사람이 지정한다. */
        if (e.revenue.status !== "verified") e.revenue.status = "reported";
        changedCount += 1;
      }
    }
    if (protect && e.readinessOverride) preserved += 1;        /* 직접 지정한 준비도를 지킨다 */
    if (changedCount) e.updatedAt = U.nowIso();
    return { changedCount: changedCount, preserved: preserved };
  }

  /* ── 예시 CSV ───────────────────────────────── */
  function sampleCsv(api) {
    var st = S.get();
    var existing = st.entities.filter(function (e) { return e.extId && /^GV-/.test(e.extId); }).slice(0, 2);
    var header = ["외부ID", "업체명", "법인명", "유형", "카테고리", "유입출처", "유입일시",
      "담당자", "등급", "전화", "이메일", "홈페이지", "담당자명",
      "회사연매출", "매출기준연도", "매출범위", "매출근거URL", "메모"];
    var rows = [
      /* 신규 2건 */
      ["SAMPLE-001", "테스트리빙", "테스트리빙㈜", "회사", "리빙", "엑셀 업로드", U.fmtKst(U.addDays(new Date(), -3).toISOString()).slice(0, 16),
        "김지호", "B", "010-2222-3333", "sample001@example.invalid", "https://sample001.example.invalid",
        "김샘플", "1200000000", String(new Date().getFullYear() - 1), "회사 별도", "https://dart.example.invalid/sample001", "엑셀에서 올린 신규 업체"],
      ["SAMPLE-002", "테스트크리에이터", "", "크리에이터", "뷰티", "엑셀 업로드", "2026-10-30 14:35",
        "주소미", "C", "010-4444-5555", "sample002@example.invalid", "", "박샘플", "", "", "", "", "매출 미확인 상태로 들어오는 행"],
      /* 오류 3건 */
      ["SAMPLE-003", "", "이름없음㈜", "회사", "식품", "엑셀 업로드", U.fmtDate(new Date()), "최재영", "A", "", "", "", "", "", "", "", "", "업체명이 비어 오류가 납니다"],
      ["SAMPLE-004", "금액오류상사", "금액오류㈜", "회사", "패션", "엑셀 업로드", U.fmtDate(new Date()), "최재영", "A", "", "", "", "", "백이십억", "2025", "회사 별도", "", "매출이 숫자가 아니어서 오류가 납니다"],
      ["SAMPLE-005", "연도오류상사", "연도오류㈜", "회사", "패션", "엑셀 업로드", "2026-13-40", "최재영", "Z", "", "", "", "", "500000000", "1899", "회사 별도", "", "연도·날짜·등급이 잘못된 행"]
    ];
    /* 기존 업체 갱신 2건 — 메모·확인된 매출 보존을 확인할 수 있게 일부러 값을 넣는다 */
    existing.forEach(function (e, i) {
      rows.push([e.extId, e.name, e.legalName, e.kind === "creator" ? "크리에이터" : "회사",
        e.category, "엑셀 업로드", U.fmtDate(new Date()), i === 0 ? "박다연" : "주소미", "A",
        "010-7777-" + (8000 + i), "update" + i + "@example.invalid", "https://updated" + i + ".example.invalid",
        "", "999000000000", String(new Date().getFullYear() - 1), "회사 연결", "https://dart.example.invalid/updated" + i,
        "재적재로 들어온 메모 — 기존 메모가 있으면 덮어쓰지 않아야 합니다"]);
    });
    U.download("glovek-example-import.csv", U.toCsv([header].concat(rows)));
    api.toast("예시 CSV 를 내려받았습니다. 신규 2건 · 오류 3건 · 기존 갱신 " + existing.length + "건이 들어 있습니다.");
  }

  GV.pages = GV.pages || {};
  GV.pages["import"] = { render: render, analyze: analyze, applyTo: applyTo, sampleCsv: sampleCsv };
})(window);
