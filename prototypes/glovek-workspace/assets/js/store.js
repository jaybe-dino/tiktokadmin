/* Glovek Workspace — 로컬 저장소
 *   · 버전이 붙은 단일 레코드를 localStorage 에 둔다. 새로고침·이동에도 남는다.
 *   · 쓰기는 트랜잭션이다 — 검증 → 직렬화 → 저장이 끝난 뒤에야 메모리 상태를 바꾼다.
 *     저장이 실패하면(용량 초과 등) 메모리와 저장분 **모두** 이전 상태로 남고 ok:false 다.
 *     "저장은 안 됐는데 화면은 바뀌어 성공처럼 보이는" 상태를 만들지 않는다.
 *   · 저장소를 아예 쓸 수 없는 환경(시크릿 창 등)은 처음에 한 번 가려내고,
 *     그때만 메모리 전용으로 동작한다 — 그 사실을 화면에 계속 띄운다.
 *   · 모든 쓰기는 감사 기록(before/after·시각·행위자)을 남긴다.
 *   · 백업 내보내기/복원은 검증을 통과해야 반영된다. 초기화는 명시 확인 뒤에만.
 */
(function (global) {
  "use strict";
  var GV = global.GV = global.GV || {};
  var U = GV.util;

  var KEY = "glovek.workspace";
  var SCHEMA = 3;
  var AUDIT_MAX = 600;

  var state = null;
  var listeners = [];
  var storageOk = true;
  var storageNote = "";
  /** localStorage 를 아예 쓸 수 없는 환경인가(시크릿 창·차단). 한 번만 판정한다. */
  var memoryOnly = false;

  /** 작은 키로 실제 쓰기를 해 본다. 쓸 수 없으면 메모리 전용으로 간다. */
  function probeStorage() {
    try {
      var k = KEY + ".probe";
      global.localStorage.setItem(k, "1");
      global.localStorage.removeItem(k);
      memoryOnly = false;
      return true;
    } catch (e) {
      /* 용량 초과는 "쓸 수 있는 환경이지만 지금 꽉 찬" 상태다 — 메모리 전용이 아니다. */
      var full = isQuota(e);
      memoryOnly = !full;
      return false;
    }
  }
  function isQuota(e) {
    return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || e.code === 22 || e.code === 1014);
  }

  function emptyState() {
    return {
      schema: SCHEMA,
      createdAt: U.nowIso(),
      savedAt: null,
      entities: [], deals: [], tasks: [], comms: [],
      audit: [], imports: [], members: [],
      prefs: {
        defaultPage: "database", density: "기본",
        connection: { adminApiUrl: "", sheetId: "", note: "", savedAt: null },
        lastBackupAt: null
      }
    };
  }

  /* ── 읽기 ───────────────────────────────────── */
  function load() {
    probeStorage();
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); }
    catch (e) {
      storageOk = false;
      storageNote = "브라우저 저장소를 읽을 수 없습니다(시크릿 창·차단 설정일 수 있습니다). 이 세션에서만 유지됩니다.";
    }
    if (!raw) {
      state = emptyState();
      if (GV.seed) { GV.seed.fill(state); seedAudit("예시 데이터 생성"); persistInitial("예시 데이터 생성"); }
      return state;
    }
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    var checked = parsed && validate(parsed);
    if (!checked || !checked.ok) {
      /* 깨진 저장분을 덮어쓰지 않는다 — 따로 옮겨 두고 새로 시작한다. */
      try { global.localStorage.setItem(KEY + ".broken." + Date.now(), raw.slice(0, 400000)); } catch (e) { /* 공간이 없으면 보관 생략 */ }
      storageNote = "저장된 데이터를 읽지 못해 예시 데이터로 새로 시작했습니다. 원본은 " + KEY + ".broken.* 에 남겨 두었습니다.";
      state = emptyState();
      if (GV.seed) { GV.seed.fill(state); seedAudit("손상 복구 — 예시 데이터 재생성"); persistInitial("손상 복구"); }
      return state;
    }
    state = migrate(checked.data);
    return state;
  }

  /** 스키마가 낮으면 올린다. 모르는 버전은 거부(validate 에서 걸린다). */
  function migrate(data) {
    if (data.schema === SCHEMA) return data;
    var d = data;
    if (d.schema < 3) {
      d.imports = d.imports || [];
      d.comms = d.comms || [];
      d.members = d.members || [];
      d.prefs = d.prefs || emptyState().prefs;
      d.prefs.connection = d.prefs.connection || emptyState().prefs.connection;
      d.schema = SCHEMA;
    }
    return d;
  }

  /* ── 검증 ───────────────────────────────────
   *   복원·로드 공통. 모양이 조금이라도 어긋나면 쓰지 않는다 —
   *   깨진 레코드가 들어오면 화면이 그려지다 멈추고, 멀쩡한 로컬 데이터를 덮어쓴다.
   */
  var QUALITY = ["A", "B", "C", "미분류"];
  var KINDS = ["company", "creator"];
  var READINESS = ["L0", "L1", "L2", "L3"];
  var REV_STATUS = ["unknown", "reported", "estimated", "verified"];
  var REV_SCOPE = ["", "brand", "company_separate", "company_consolidated"];
  var DEAL_STATUS = ["open", "won", "hold", "lost"];
  var STAGE_IDS = ["contact_planned", "contacting", "meeting", "proposal", "contract_review"];
  var DIRECTIONS = ["in", "out"];
  var CHANNELS = ["email", "call", "meeting", "chat"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isStr(v) { return typeof v === "string"; }
  function isId(v) { return isStr(v) && v.trim().length > 0 && v.length <= 120; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isBool(v) { return typeof v === "boolean"; }
  function okDate(v) {
    if (v == null || v === "") return true;
    if (!isStr(v)) return false;
    var t = Date.parse(v);
    return !isNaN(t);
  }
  function inSet(v, set) { return set.indexOf(v) >= 0; }

  function validate(data) {
    var E = [];
    function bad(msg) { E.push(msg); return false; }
    if (!isObj(data)) return { ok: false, error: "최상위가 객체가 아닙니다." };
    if (!isNum(data.schema) || data.schema < 1) return { ok: false, error: "schema 값이 없거나 숫자가 아닙니다." };
    if (data.schema > SCHEMA) {
      return { ok: false, error: "더 새 버전(schema " + data.schema + ")의 백업입니다. 이 화면(최대 " + SCHEMA + ")에서는 열 수 없습니다." };
    }
    var LISTS = ["entities", "deals", "tasks", "comms", "audit", "imports", "members"];
    for (var i = 0; i < LISTS.length; i++) {
      var k = LISTS[i];
      if (data[k] == null) { data[k] = []; continue; }
      if (!Array.isArray(data[k])) return { ok: false, error: k + " 가 배열이 아닙니다." };
      for (var j = 0; j < data[k].length; j++) {
        if (!isObj(data[k][j])) return { ok: false, error: k + "[" + j + "] 가 객체가 아닙니다(빈 값·문자열 불가)." };
      }
    }
    if (!Array.isArray(data.entities)) return { ok: false, error: "entities 가 없습니다." };
    if (!isObj(data.prefs) && data.prefs != null) return { ok: false, error: "prefs 가 객체가 아닙니다." };

    /* 업체 */
    var entIds = new Set();
    for (var a = 0; a < data.entities.length; a++) {
      var e = data.entities[a];
      var at = "entities[" + a + "]";
      if (!isId(e.id)) return { ok: false, error: at + " 의 id 가 올바르지 않습니다." };
      if (entIds.has(e.id)) return { ok: false, error: "업체 id 가 중복됩니다: " + e.id };
      entIds.add(e.id);
      if (!isStr(e.name) || !e.name.trim()) return { ok: false, error: at + " 의 name 이 문자열이 아니거나 비어 있습니다." };
      if (e.legalName != null && !isStr(e.legalName)) return { ok: false, error: at + " 의 legalName 이 문자열이 아닙니다." };
      if (e.kind != null && !inSet(e.kind, KINDS)) return { ok: false, error: at + " 의 kind 가 company/creator 가 아닙니다." };
      if (e.category != null && !isStr(e.category)) return { ok: false, error: at + " 의 category 가 문자열이 아닙니다." };
      if (e.source != null && !isStr(e.source)) return { ok: false, error: at + " 의 source 가 문자열이 아닙니다." };
      if (e.owner != null && !isStr(e.owner)) return { ok: false, error: at + " 의 owner 가 문자열이 아닙니다." };
      if (e.quality != null && !inSet(e.quality, QUALITY)) return { ok: false, error: at + " 의 quality 값(" + String(e.quality) + ")을 알 수 없습니다." };
      if (e.readiness != null && !inSet(e.readiness, READINESS)) return { ok: false, error: at + " 의 readiness 값을 알 수 없습니다." };
      if (e.readinessOverride != null) {
        if (!isObj(e.readinessOverride) || !inSet(e.readinessOverride.level, READINESS)) {
          return { ok: false, error: at + " 의 readinessOverride 모양이 올바르지 않습니다." };
        }
      }
      ["inflowAt", "createdAt", "updatedAt", "lastCommAt", "nextActionAt"].forEach(function (f) {
        if (!okDate(e[f])) bad(at + " 의 " + f + " 가 날짜가 아닙니다.");
      });
      if (E.length) return { ok: false, error: E[0] };
      if (e.followers != null && !isNum(e.followers)) return { ok: false, error: at + " 의 followers 가 숫자가 아닙니다." };
      if (e.memo != null && !isStr(e.memo)) return { ok: false, error: at + " 의 memo 가 문자열이 아닙니다." };
      if (e.revenue != null) {
        if (!isObj(e.revenue)) return { ok: false, error: at + " 의 revenue 가 객체가 아닙니다." };
        var r = e.revenue;
        if (r.amount != null && (!isNum(r.amount) || r.amount < 0 || r.amount > 1e15)) {
          return { ok: false, error: at + " 의 revenue.amount 가 올바른 금액이 아닙니다." };
        }
        if (r.year != null && (!isNum(r.year) || r.year < 1900 || r.year > 2200)) {
          return { ok: false, error: at + " 의 revenue.year 가 올바른 연도가 아닙니다." };
        }
        if (r.scope != null && !inSet(r.scope, REV_SCOPE)) return { ok: false, error: at + " 의 revenue.scope 값을 알 수 없습니다." };
        if (r.status != null && !inSet(r.status, REV_STATUS)) return { ok: false, error: at + " 의 revenue.status 값을 알 수 없습니다." };
        if (r.sourceUrl != null && !isStr(r.sourceUrl)) return { ok: false, error: at + " 의 revenue.sourceUrl 이 문자열이 아닙니다." };
        if (r.legalEntity != null && !isStr(r.legalEntity)) return { ok: false, error: at + " 의 revenue.legalEntity 가 문자열이 아닙니다." };
      }
      if (e.contacts != null) {
        if (!Array.isArray(e.contacts)) return { ok: false, error: at + " 의 contacts 가 배열이 아닙니다." };
        var cIds = new Set();
        for (var b = 0; b < e.contacts.length; b++) {
          var c = e.contacts[b];
          if (!isObj(c)) return { ok: false, error: at + ".contacts[" + b + "] 가 객체가 아닙니다." };
          if (!isId(c.id)) return { ok: false, error: at + ".contacts[" + b + "] 의 id 가 올바르지 않습니다." };
          if (cIds.has(c.id)) return { ok: false, error: at + " 의 연락처 id 가 중복됩니다." };
          cIds.add(c.id);
          if (!isStr(c.name)) return { ok: false, error: at + ".contacts[" + b + "] 의 name 이 문자열이 아닙니다." };
          if (c.primary != null && !isBool(c.primary)) return { ok: false, error: at + ".contacts[" + b + "] 의 primary 가 참/거짓이 아닙니다." };
        }
      }
    }

    /* 영업 기회 — 업체를 가리켜야 하고 id 가 겹치면 안 된다 */
    var dealIds = new Set();
    for (var d = 0; d < data.deals.length; d++) {
      var dl = data.deals[d];
      var dat = "deals[" + d + "]";
      if (!isId(dl.id)) return { ok: false, error: dat + " 의 id 가 올바르지 않습니다." };
      if (dealIds.has(dl.id)) return { ok: false, error: "영업 기회 id 가 중복됩니다: " + dl.id };
      dealIds.add(dl.id);
      if (!isId(dl.entityId) || !entIds.has(dl.entityId)) {
        return { ok: false, error: dat + " 가 존재하지 않는 업체를 가리킵니다." };
      }
      if (!isStr(dl.service)) return { ok: false, error: dat + " 의 service 가 문자열이 아닙니다." };
      if (!inSet(dl.stage, STAGE_IDS)) return { ok: false, error: dat + " 의 stage 값(" + String(dl.stage) + ")을 알 수 없습니다." };
      if (!inSet(dl.status, DEAL_STATUS)) return { ok: false, error: dat + " 의 status 값(" + String(dl.status) + ")을 알 수 없습니다." };
      ["expectedAmount", "contractAmount"].forEach(function (f) {
        if (dl[f] != null && (!isNum(dl[f]) || dl[f] < 0 || dl[f] > 1e15)) bad(dat + " 의 " + f + " 가 올바른 금액이 아닙니다.");
      });
      ["nextActionAt", "createdAt", "updatedAt", "closedAt"].forEach(function (f) {
        if (!okDate(dl[f])) bad(dat + " 의 " + f + " 가 날짜가 아닙니다.");
      });
      if (dl.contractDate != null && dl.contractDate !== "" && !okDate(dl.contractDate)) {
        bad(dat + " 의 contractDate 가 날짜가 아닙니다.");
      }
      if (E.length) return { ok: false, error: E[0] };
      if (dl.contractScope != null && !isStr(dl.contractScope)) return { ok: false, error: dat + " 의 contractScope 가 문자열이 아닙니다." };
      if (dl.reason != null && !isStr(dl.reason)) return { ok: false, error: dat + " 의 reason 이 문자열이 아닙니다." };
    }

    /* 할 일 */
    var taskIds = new Set();
    for (var t = 0; t < data.tasks.length; t++) {
      var tk = data.tasks[t];
      var tat = "tasks[" + t + "]";
      if (!isId(tk.id)) return { ok: false, error: tat + " 의 id 가 올바르지 않습니다." };
      if (taskIds.has(tk.id)) return { ok: false, error: "할 일 id 가 중복됩니다: " + tk.id };
      taskIds.add(tk.id);
      if (!isStr(tk.title)) return { ok: false, error: tat + " 의 title 이 문자열이 아닙니다." };
      if (tk.entityId != null && !entIds.has(tk.entityId)) return { ok: false, error: tat + " 가 존재하지 않는 업체를 가리킵니다." };
      if (tk.dealId != null && !dealIds.has(tk.dealId)) return { ok: false, error: tat + " 가 존재하지 않는 기회를 가리킵니다." };
      if (tk.done != null && !isBool(tk.done)) return { ok: false, error: tat + " 의 done 이 참/거짓이 아닙니다." };
      if (!okDate(tk.dueAt) || !okDate(tk.doneAt) || !okDate(tk.createdAt)) {
        return { ok: false, error: tat + " 의 날짜 값이 올바르지 않습니다." };
      }
    }

    /* 커뮤니케이션 */
    var commIds = new Set();
    for (var m = 0; m < data.comms.length; m++) {
      var cm = data.comms[m];
      var mat = "comms[" + m + "]";
      if (!isId(cm.id)) return { ok: false, error: mat + " 의 id 가 올바르지 않습니다." };
      if (commIds.has(cm.id)) return { ok: false, error: "커뮤니케이션 id 가 중복됩니다: " + cm.id };
      commIds.add(cm.id);
      if (!isId(cm.entityId) || !entIds.has(cm.entityId)) {
        return { ok: false, error: mat + " 가 존재하지 않는 업체를 가리킵니다." };
      }
      if (!inSet(cm.direction, DIRECTIONS)) return { ok: false, error: mat + " 의 direction 값을 알 수 없습니다." };
      if (!inSet(cm.channel, CHANNELS)) return { ok: false, error: mat + " 의 channel 값을 알 수 없습니다." };
      if (!isStr(cm.body)) return { ok: false, error: mat + " 의 body 가 문자열이 아닙니다." };
      if (!okDate(cm.at) || !okDate(cm.createdAt)) return { ok: false, error: mat + " 의 날짜 값이 올바르지 않습니다." };
      if (cm.dealId != null && !dealIds.has(cm.dealId)) return { ok: false, error: mat + " 가 존재하지 않는 기회를 가리킵니다." };
    }

    /* 변경 이력·가져오기 이력·구성원 */
    for (var g = 0; g < data.audit.length; g++) {
      var lg = data.audit[g];
      if (!isId(lg.id)) return { ok: false, error: "audit[" + g + "] 의 id 가 올바르지 않습니다." };
      if (!isStr(lg.op)) return { ok: false, error: "audit[" + g + "] 의 op 가 문자열이 아닙니다." };
      if (!okDate(lg.at)) return { ok: false, error: "audit[" + g + "] 의 at 가 날짜가 아닙니다." };
    }
    for (var h = 0; h < data.imports.length; h++) {
      var ip = data.imports[h];
      if (!isId(ip.id)) return { ok: false, error: "imports[" + h + "] 의 id 가 올바르지 않습니다." };
      if (!okDate(ip.at)) return { ok: false, error: "imports[" + h + "] 의 at 가 날짜가 아닙니다." };
      ["rows", "created", "updated", "skipped", "errors"].forEach(function (f) {
        if (ip[f] != null && (!isNum(ip[f]) || ip[f] < 0)) bad("imports[" + h + "] 의 " + f + " 가 올바른 건수가 아닙니다.");
      });
      if (E.length) return { ok: false, error: E[0] };
    }
    var memIds = new Set();
    for (var n = 0; n < data.members.length; n++) {
      var mb = data.members[n];
      if (!isId(mb.id)) return { ok: false, error: "members[" + n + "] 의 id 가 올바르지 않습니다." };
      if (memIds.has(mb.id)) return { ok: false, error: "구성원 id 가 중복됩니다: " + mb.id };
      memIds.add(mb.id);
      if (!isStr(mb.name) || !mb.name.trim()) return { ok: false, error: "members[" + n + "] 의 name 이 비어 있습니다." };
    }

    /* 설정 */
    var defaults = emptyState().prefs;
    if (!isObj(data.prefs)) data.prefs = defaults;
    if (data.prefs.defaultPage != null && !isStr(data.prefs.defaultPage)) return { ok: false, error: "prefs.defaultPage 가 문자열이 아닙니다." };
    if (data.prefs.density != null && !inSet(data.prefs.density, ["조밀", "기본", "넉넉"])) {
      return { ok: false, error: "prefs.density 값을 알 수 없습니다." };
    }
    if (data.prefs.connection != null && !isObj(data.prefs.connection)) {
      return { ok: false, error: "prefs.connection 이 객체가 아닙니다." };
    }
    if (!isObj(data.prefs.connection)) data.prefs.connection = defaults.connection;
    ["adminApiUrl", "sheetId", "note"].forEach(function (f) {
      if (data.prefs.connection[f] != null && !isStr(data.prefs.connection[f])) {
        bad("prefs.connection." + f + " 가 문자열이 아닙니다.");
      }
    });
    if (E.length) return { ok: false, error: E[0] };

    return { ok: true, data: data };
  }

  function get() { return state || load(); }

  /* ── 쓰기 ───────────────────────────────────── */
  /**
   * 주어진 상태를 저장소에 쓴다. 메모리 상태를 건드리지 않는다.
   *   { ok, error, full, memoryOnly }
   */
  function writeThrough(candidate) {
    var text;
    try { text = JSON.stringify(candidate); }
    catch (e) { return { ok: false, error: "저장할 데이터를 직렬화하지 못했습니다(구조가 너무 깊거나 순환 참조)." }; }
    if (memoryOnly) {
      return { ok: false, memoryOnly: true, bytes: text.length,
        error: "브라우저 저장소를 쓸 수 없는 창입니다(시크릿 창·차단 설정). 이 세션에서만 유지되고 새로고침하면 사라집니다." };
    }
    try {
      global.localStorage.setItem(KEY, text);
      storageOk = true;
      storageNote = "";
      return { ok: true, bytes: text.length };
    } catch (e) {
      storageOk = false;
      var full = isQuota(e);
      storageNote = full
        ? "브라우저 저장 공간이 꽉 찼습니다. 백업을 내려받고 가져오기 이력·변경 이력을 줄인 뒤 다시 시도하세요. 방금 변경은 저장되지 않았습니다."
        : "브라우저 저장소에 쓸 수 없습니다. 방금 변경은 저장되지 않았습니다.";
      return { ok: false, error: storageNote, full: full };
    }
  }

  /** 첫 적재에도 이력을 한 줄 남긴다 — 변경 이력이 빈 화면으로 보이지 않게. */
  function seedAudit(note) {
    state.audit = [{
      id: U.uid("log"), at: U.nowIso(), actor: "로컬 사용자", op: "seed",
      targetType: "store", targetId: "", targetName: "예시 데이터",
      note: note, before: null,
      after: {
        entities: state.entities.length, deals: state.deals.length,
        tasks: state.tasks.length, comms: state.comms.length
      }
    }];
  }

  /** 첫 적재(예시 데이터) 전용 — 실패해도 메모리로는 쓸 수 있게 둔다. */
  function persistInitial(note) {
    state.savedAt = U.nowIso();
    var r = writeThrough(state);
    if (!r.ok && !r.memoryOnly) storageNote = r.error;
    return r;
  }

  /**
   * 한 번의 쓰기 = 한 번의 트랜잭션.
   *   순서: 깊은 복사 → fn(draft) → 감사 기록 추가 → **저장** → 그 뒤에야 상태 교체.
   *   저장이 실패하면 메모리와 저장분이 모두 이전 상태로 남고 ok:false 다.
   *   저장소를 아예 쓸 수 없는 창에서는 ok:true + saved:false 로 두고 경고를 계속 띄운다.
   */
  function tx(meta, fn) {
    var current = get();
    var draft;
    try { draft = JSON.parse(JSON.stringify(current)); }
    catch (e) { return { ok: false, error: "상태를 복사하지 못했습니다." }; }

    var result;
    try { result = fn(draft); }
    catch (e) {
      return { ok: false, error: (e && e.message) || "변경 중 오류가 발생했습니다." };
    }
    if (result && result.ok === false) return result;

    var entry = {
      id: U.uid("log"),
      at: U.nowIso(),
      actor: meta.actor || "로컬 사용자",
      op: meta.op || "update",
      targetType: meta.targetType || "",
      targetId: meta.targetId || "",
      targetName: U.clean(meta.targetName || "", 80),
      note: U.clean(meta.note || "", 200),
      before: meta.before === undefined ? null : meta.before,
      after: meta.after === undefined ? null : meta.after
    };
    if (result && result.audit) {
      Object.keys(result.audit).forEach(function (k) { entry[k] = result.audit[k]; });
    }
    if (meta.silentAudit !== true) {
      draft.audit = [entry].concat(draft.audit || []).slice(0, AUDIT_MAX);
    }
    draft.savedAt = U.nowIso();

    /* 바뀐 결과를 저장소가 받아들인 뒤에만 현재 상태로 올린다. */
    var saved = writeThrough(draft);
    if (!saved.ok && !saved.memoryOnly) {
      /* 메모리도 그대로 둔다 — 화면은 이전 값을 계속 보여 주고, 입력 내용은 사라지지 않는다. */
      return { ok: false, error: saved.error, full: !!saved.full, storage: true };
    }
    state = draft;
    notify();
    return {
      ok: true, saved: !!saved.ok,
      warning: saved.ok ? "" : saved.error,
      data: result, logId: entry.id
    };
  }

  /* ── 구독 ───────────────────────────────────── */
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function notify() { listeners.slice().forEach(function (f) { try { f(state); } catch (e) { console.error(e); } }); }

  /* ── 백업 ───────────────────────────────────── */
  function exportBackup() {
    var s = get();
    var payload = {
      kind: "glovek-workspace-backup",
      schema: s.schema,
      exportedAt: U.nowIso(),
      data: {
        schema: s.schema, createdAt: s.createdAt, savedAt: s.savedAt,
        entities: s.entities, deals: s.deals, tasks: s.tasks, comms: s.comms,
        audit: s.audit, imports: s.imports, members: s.members, prefs: s.prefs
      }
    };
    return JSON.stringify(payload, null, 2);
  }

  /** 백업 파일 검증 → 통과하면 교체. 실패하면 현재 데이터를 손대지 않는다. */
  function importBackup(text) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, error: "JSON 형식이 아닙니다. 파일이 손상되었을 수 있습니다." }; }
    var body = parsed && parsed.kind === "glovek-workspace-backup" ? parsed.data : parsed;
    if (parsed && parsed.kind && parsed.kind !== "glovek-workspace-backup") {
      return { ok: false, error: "이 화면의 백업 파일이 아닙니다(kind=" + U.clean(parsed.kind, 40) + ")." };
    }
    var checked = validate(body);
    if (!checked.ok) return { ok: false, error: "복원할 수 없습니다 — " + checked.error };
    var migrated = migrate(checked.data);
    var before = { entities: get().entities.length, deals: get().deals.length };
    return tx({
      op: "restore", targetType: "store", note: "백업 복원",
      before: before, after: { entities: migrated.entities.length, deals: migrated.deals.length }
    }, function (draft) {
      ["entities", "deals", "tasks", "comms", "imports", "members"].forEach(function (k) { draft[k] = migrated[k] || []; });
      draft.prefs = migrated.prefs;
      draft.schema = SCHEMA;
      /* 감사 기록은 합친다 — 복원이 지난 이력을 지우지 않는다. */
      draft.audit = (migrated.audit || []).concat(draft.audit || []).slice(0, AUDIT_MAX);
      return { ok: true, counts: { entities: draft.entities.length, deals: draft.deals.length } };
    });
  }

  /** 초기화 — 호출자가 명시 확인을 받은 뒤에만 부른다. 저장이 안 되면 바꾸지 않는다. */
  function reset(reseed) {
    var prevCounts = { entities: get().entities.length };
    var fresh = emptyState();
    if (reseed && GV.seed) GV.seed.fill(fresh);
    fresh.audit = [{
      id: U.uid("log"), at: U.nowIso(), actor: "로컬 사용자", op: "reset",
      targetType: "store", targetId: "", targetName: "",
      note: reseed ? "예시 데이터로 초기화" : "전체 비우기",
      before: prevCounts, after: { entities: fresh.entities.length }
    }];
    fresh.savedAt = U.nowIso();
    var saved = writeThrough(fresh);
    if (!saved.ok && !saved.memoryOnly) {
      return { ok: false, error: saved.error };
    }
    state = fresh;
    notify();
    return { ok: true, saved: !!saved.ok, warning: saved.ok ? "" : saved.error };
  }

  function health() {
    var text = "";
    try { text = global.localStorage.getItem(KEY) || ""; } catch (e) { /* 읽기 불가 */ }
    return { ok: storageOk, note: storageNote, bytes: text.length, key: KEY, schema: SCHEMA,
      memoryOnly: memoryOnly };
  }
  function clearNote() { storageNote = ""; }
  /** 테스트·진단용 — 저장소 가용성을 다시 판정한다. */
  function recheckStorage() { return probeStorage(); }

  GV.store = {
    KEY: KEY, SCHEMA: SCHEMA,
    load: load, get: get, tx: tx, subscribe: subscribe,
    exportBackup: exportBackup, importBackup: importBackup, reset: reset,
    validate: validate, health: health, clearNote: clearNote, emptyState: emptyState,
    recheckStorage: recheckStorage, writeThrough: writeThrough
  };
})(window);
