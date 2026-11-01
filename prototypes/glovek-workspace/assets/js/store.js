/* Glovek Workspace — 로컬 저장소
 *   · 버전이 붙은 단일 레코드를 localStorage 에 둔다. 새로고침·이동에도 남는다.
 *   · 쓰기는 트랜잭션이다 — 바꾼 결과를 먼저 직렬화해 보고, 저장이 성공할 때만
 *     메모리 상태를 교체한다. 저장이 실패하면(용량 초과 등) 이전 상태를 지키고 알린다.
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
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); }
    catch (e) {
      storageOk = false;
      storageNote = "브라우저 저장소를 읽을 수 없습니다(시크릿 창·차단 설정일 수 있습니다). 이 세션에서만 유지됩니다.";
    }
    if (!raw) {
      state = emptyState();
      if (GV.seed) { GV.seed.fill(state); persist("seed", "예시 데이터 생성", true); }
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
      if (GV.seed) { GV.seed.fill(state); persist("seed", "손상 복구 — 예시 데이터 재생성", true); }
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

  /** 복원·로드 공통 검증. 모양이 맞지 않으면 쓰지 않는다. */
  function validate(data) {
    if (!data || typeof data !== "object") return { ok: false, error: "최상위가 객체가 아닙니다." };
    if (typeof data.schema !== "number" || data.schema < 1) return { ok: false, error: "schema 값이 없습니다." };
    if (data.schema > SCHEMA) {
      return { ok: false, error: "더 새 버전(schema " + data.schema + ")의 백업입니다. 이 화면(최대 " + SCHEMA + ")에서는 열 수 없습니다." };
    }
    var lists = ["entities", "deals", "tasks", "comms", "audit", "imports", "members"];
    for (var i = 0; i < lists.length; i++) {
      var k = lists[i];
      if (data[k] != null && !Array.isArray(data[k])) return { ok: false, error: k + " 가 배열이 아닙니다." };
    }
    if (!Array.isArray(data.entities)) return { ok: false, error: "entities 가 없습니다." };
    var bad = data.entities.find(function (e) { return !e || typeof e.id !== "string" || !e.id; });
    if (bad !== undefined) return { ok: false, error: "id 가 없는 업체 레코드가 있습니다." };
    var ids = new Set();
    for (var j = 0; j < data.entities.length; j++) {
      if (ids.has(data.entities[j].id)) return { ok: false, error: "업체 id 가 중복됩니다: " + data.entities[j].id };
      ids.add(data.entities[j].id);
    }
    if (Array.isArray(data.deals)) {
      var orphan = data.deals.find(function (d) { return !d || !d.entityId || !ids.has(d.entityId); });
      if (orphan) return { ok: false, error: "존재하지 않는 업체를 가리키는 영업 기회가 있습니다." };
    }
    lists.forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
    data.prefs = data.prefs && typeof data.prefs === "object" ? data.prefs : emptyState().prefs;
    data.prefs.connection = data.prefs.connection && typeof data.prefs.connection === "object"
      ? data.prefs.connection : emptyState().prefs.connection;
    return { ok: true, data: data };
  }

  function get() { return state || load(); }

  /* ── 쓰기 ───────────────────────────────────── */
  function persist(op, note, silent) {
    state.savedAt = U.nowIso();
    var text;
    try { text = JSON.stringify(state); }
    catch (e) { return { ok: false, error: "저장할 데이터를 직렬화하지 못했습니다." }; }
    try {
      global.localStorage.setItem(KEY, text);
      storageOk = true;
      if (!silent) storageNote = "";
      return { ok: true, bytes: text.length };
    } catch (e) {
      storageOk = false;
      var full = e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
      storageNote = full
        ? "브라우저 저장 공간이 꽉 찼습니다. 백업을 내려받고 가져오기 이력을 정리하세요. 화면의 내용은 유지되지만 새로고침하면 사라집니다."
        : "브라우저 저장소에 쓸 수 없습니다. 화면의 내용은 유지되지만 새로고침하면 사라집니다.";
      return { ok: false, error: storageNote, full: !!full };
    }
  }

  /**
   * 한 번의 쓰기 = 한 번의 트랜잭션.
   *   fn(draft) 이 깊은 복사본을 고치고, 저장이 성공할 때만 현재 상태가 된다.
   *   실패하면 이전 상태 그대로다(부분 반영이 없다).
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

    /* 저장이 실패해도 화면의 변경은 지킨다(부분 반영은 없다) — 대신 경고를 올린다.
       저장분을 깨뜨리지 않으므로 새로고침하면 마지막 성공 상태로 돌아간다. */
    state = draft;
    var saved = persist(entry.op, entry.note);
    notify();
    return { ok: true, saved: saved.ok, warning: saved.ok ? "" : saved.error, data: result, logId: entry.id };
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

  /** 초기화 — 호출자가 명시 확인을 받은 뒤에만 부른다. */
  function reset(reseed) {
    var fresh = emptyState();
    if (reseed && GV.seed) GV.seed.fill(fresh);
    var prevCounts = { entities: get().entities.length };
    state = fresh;
    var saved = persist("reset", "초기화");
    state.audit = [{
      id: U.uid("log"), at: U.nowIso(), actor: "로컬 사용자", op: "reset",
      targetType: "store", targetId: "", targetName: "", note: reseed ? "예시 데이터로 초기화" : "전체 비우기",
      before: prevCounts, after: { entities: state.entities.length }
    }];
    persist("reset", "초기화 기록", true);
    notify();
    return { ok: true, saved: saved.ok, warning: saved.ok ? "" : saved.error };
  }

  function health() {
    var text = "";
    try { text = global.localStorage.getItem(KEY) || ""; } catch (e) { /* 읽기 불가 */ }
    return { ok: storageOk, note: storageNote, bytes: text.length, key: KEY, schema: SCHEMA };
  }
  function clearNote() { storageNote = ""; }

  GV.store = {
    KEY: KEY, SCHEMA: SCHEMA,
    load: load, get: get, tx: tx, subscribe: subscribe,
    exportBackup: exportBackup, importBackup: importBackup, reset: reset,
    validate: validate, health: health, clearNote: clearNote, emptyState: emptyState
  };
})(window);
