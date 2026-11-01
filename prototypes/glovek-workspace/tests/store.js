/* 저장소 점검 — 검증 거절 목록과 저장 실패 안전성.
 *   사용: node tests/store.js
 *   브라우저 없이 vm 안에서 util/model/seed/store 를 돌리고 localStorage 를 흉내 낸다.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");

function makeEnv(opts) {
  opts = opts || {};
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (opts.failAll) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      if (opts.failBig && k === "glovek.workspace") { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      if (opts.blocked) { const e = new Error("blocked"); e.name = "SecurityError"; throw e; }
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    _raw: store
  };
  const sandbox = {
    window: {}, localStorage: ls, console,
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    URL, Blob: class {}, TextDecoder, DOMParser: class {}, Date, Math, JSON, crypto
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.localStorage = ls;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  ["assets/js/util.js", "assets/js/model.js", "assets/js/seed.js", "assets/js/store.js"].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
  });
  return { GV: sandbox.window.GV, ls: ls };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++; console.log("  X " + name + (extra ? " -- " + extra : ""));
}
function rejects(S, name, payload, noClone) {
  /* 기본은 복사해서 넘긴다(validate 가 입력을 보정하므로). Infinity 처럼
     JSON 복사로 사라지는 값은 noClone 으로 원본을 그대로 넘긴다. */
  const r = S.validate(noClone ? payload : JSON.parse(JSON.stringify(payload)));
  ok("거절: " + name, r.ok === false, "통과해 버렸다");
}

const env = makeEnv();
const S = env.GV.store;
const U = env.GV.util;

console.log("1) 검증이 거절해야 하는 것들");
const base = () => ({ schema: 3, entities: [], deals: [], tasks: [], comms: [], audit: [], imports: [], members: [], prefs: {} });
rejects(S, "최상위가 배열", []);
rejects(S, "schema 없음", { entities: [] });
rejects(S, "더 새 스키마", Object.assign(base(), { schema: 99 }));
rejects(S, "entities 가 문자열", Object.assign(base(), { entities: "nope" }));
rejects(S, "tasks 에 null", Object.assign(base(), { entities: [{ id: "x", name: "a" }], tasks: [null] }));
rejects(S, "comms 에 null", Object.assign(base(), { entities: [{ id: "x", name: "a" }], comms: [null] }));
rejects(S, "id 만 있고 name 없음", Object.assign(base(), { entities: [{ id: "x" }] }));
rejects(S, "name 이 숫자", Object.assign(base(), { entities: [{ id: "x", name: 123 }] }));
rejects(S, "revenue 가 문자열", Object.assign(base(), { entities: [{ id: "x", name: "a", revenue: "bad" }] }));
rejects(S, "revenue.amount 가 NaN 문자열", Object.assign(base(), { entities: [{ id: "x", name: "a", revenue: { amount: "많음" } }] }));
rejects(S, "revenue.amount 음수", Object.assign(base(), { entities: [{ id: "x", name: "a", revenue: { amount: -5 } }] }));
rejects(S, "revenue.year 가 1800", Object.assign(base(), { entities: [{ id: "x", name: "a", revenue: { amount: 1, year: 1800 } }] }));
rejects(S, "revenue.scope 모르는 값", Object.assign(base(), { entities: [{ id: "x", name: "a", revenue: { scope: "weird" } }] }));
rejects(S, "revenue.status 모르는 값", Object.assign(base(), { entities: [{ id: "x", name: "a", revenue: { status: "weird" } }] }));
rejects(S, "quality 모르는 값", Object.assign(base(), { entities: [{ id: "x", name: "a", quality: "S" }] }));
rejects(S, "kind 모르는 값", Object.assign(base(), { entities: [{ id: "x", name: "a", kind: "robot" }] }));
rejects(S, "업체 id 중복", Object.assign(base(), { entities: [{ id: "x", name: "a" }, { id: "x", name: "b" }] }));
rejects(S, "날짜가 날짜 아님", Object.assign(base(), { entities: [{ id: "x", name: "a", inflowAt: "어제" }] }));
rejects(S, "contacts 가 배열 아님", Object.assign(base(), { entities: [{ id: "x", name: "a", contacts: {} }] }));
rejects(S, "contacts 안에 null", Object.assign(base(), { entities: [{ id: "x", name: "a", contacts: [null] }] }));
rejects(S, "연락처 id 중복", Object.assign(base(), { entities: [{ id: "x", name: "a", contacts: [{ id: "c", name: "n" }, { id: "c", name: "m" }] }] }));
rejects(S, "deal id 중복", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  deals: [{ id: "d", entityId: "x", service: "s", stage: "meeting", status: "open" },
          { id: "d", entityId: "x", service: "t", stage: "meeting", status: "open" }]
}));
rejects(S, "deal 이 없는 업체를 가리킴", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  deals: [{ id: "d", entityId: "zzz", service: "s", stage: "meeting", status: "open" }]
}));
rejects(S, "deal stage 모르는 값", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  deals: [{ id: "d", entityId: "x", service: "s", stage: "flying", status: "open" }]
}));
rejects(S, "deal status 모르는 값", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  deals: [{ id: "d", entityId: "x", service: "s", stage: "meeting", status: "maybe" }]
}));
rejects(S, "deal 금액이 Infinity", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  deals: [{ id: "d", entityId: "x", service: "s", stage: "meeting", status: "open", expectedAmount: Infinity }]
}), true);
/* JSON.parse("1e400") 은 Infinity 가 된다 — 파일에서 실제로 들어올 수 있는 경로다. */
rejects(S, "백업 파일의 1e400 금액", JSON.parse('{"schema":3,"entities":[{"id":"x","name":"a"}],'
  + '"deals":[{"id":"d","entityId":"x","service":"s","stage":"meeting","status":"open","expectedAmount":1e400}]}'), true);
rejects(S, "매출 금액 1e400", JSON.parse('{"schema":3,"entities":[{"id":"x","name":"a","revenue":{"amount":1e400}}]}'), true);
rejects(S, "task 가 없는 기회를 가리킴", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  tasks: [{ id: "t", title: "a", entityId: "x", dealId: "nope" }]
}));
rejects(S, "task done 이 문자열", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }], tasks: [{ id: "t", title: "a", done: "yes" }]
}));
rejects(S, "comm direction 모르는 값", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  comms: [{ id: "c", entityId: "x", direction: "sideways", channel: "call", body: "b", at: "2026-01-01T00:00:00Z" }]
}));
rejects(S, "comm 이 없는 업체를 가리킴", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }],
  comms: [{ id: "c", entityId: "zz", direction: "in", channel: "call", body: "b", at: "2026-01-01T00:00:00Z" }]
}));
rejects(S, "members id 중복", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }], members: [{ id: "m", name: "a" }, { id: "m", name: "b" }]
}));
rejects(S, "prefs 가 배열", Object.assign(base(), { entities: [{ id: "x", name: "a" }], prefs: [] }));
rejects(S, "prefs.connection 이 문자열", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }], prefs: { connection: "x" }
}));
rejects(S, "prefs.density 모르는 값", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }], prefs: { density: "엄청" }
}));
rejects(S, "audit 에 op 없음", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }], audit: [{ id: "l", at: "2026-01-01T00:00:00Z" }]
}));
rejects(S, "imports 건수가 음수", Object.assign(base(), {
  entities: [{ id: "x", name: "a" }], imports: [{ id: "i", at: "2026-01-01T00:00:00Z", rows: -1 }]
}));

console.log("1-b) 가져오기 출처 필드는 통과한다");
ok("importedFrom 이 있어도 통과", S.validate({
  schema: 3, entities: [{ id: "x", name: "a",
    importedFrom: { file: "a.csv", rowNo: 2, at: "2026-11-01T00:00:00Z" },
    lastImport: { file: "a.csv", rowNo: 2, at: "2026-11-01T00:00:00Z" } }]
}).ok === true);

console.log("2) 정상 백업은 그대로 통과한다(왕복)");
const live = S.get();
ok("예시 데이터가 적재됐다", live.entities.length >= 35, String(live.entities.length));
const backupText = S.exportBackup();
const parsed = JSON.parse(backupText);
ok("백업 모양", parsed.kind === "glovek-workspace-backup");
const check = S.validate(JSON.parse(JSON.stringify(parsed.data)));
ok("자기 백업은 검증 통과", check.ok === true, check.error);
const beforeCount = S.get().entities.length;
const restored = S.importBackup(backupText);
ok("복원 성공", restored.ok === true, restored.error);
ok("건수 유지", S.get().entities.length === beforeCount);

console.log("2-b) 왕복 복원에서 이력 id 가 중복되지 않는다");
/* 복원 전에 변경을 한 번 만들어 이력을 쌓는다 */
S.tx({ op: "entity.update", targetType: "entity", targetId: S.get().entities[0].id, note: "왕복 테스트" }, (d) => {
  d.entities[0].memo = "왕복 전 메모";
  return { ok: true, audit: { targetName: d.entities[0].name, before: "", after: "왕복 전 메모" } };
});
const snapText = S.exportBackup();
const restoresBefore = S.get().audit.filter((a) => a.op === "restore").length;
const idsBefore = S.get().audit.map((a) => a.id);
ok("복원 전 이력 id 가 유일", new Set(idsBefore).size === idsBefore.length);
const rt1 = S.importBackup(snapText);
ok("1회 복원 성공", rt1.ok === true, rt1.error);
const rt2 = S.importBackup(snapText);
ok("2회 복원 성공", rt2.ok === true, rt2.error);
const ids = S.get().audit.map((a) => a.id);
ok("왕복 뒤에도 이력 id 가 유일", new Set(ids).size === ids.length,
  ids.length + "건 중 유일 " + new Set(ids).size + "건");
const sameEvent = S.get().audit.filter((a) => a.note === "왕복 테스트");
ok("같은 사건이 한 번만 남는다", sameEvent.length === 1, String(sameEvent.length));
const restores = S.get().audit.filter((a) => a.op === "restore").length;
ok("복원 기록이 복원 횟수만큼만 늘어난다", restores === restoresBefore + 2,
  restoresBefore + " -> " + restores);
ok("이력이 최신순", S.get().audit.every((a, i, arr) => i === 0 || String(arr[i - 1].at) >= String(a.at)));
ok("이력 상한 600 을 넘지 않는다", S.get().audit.length <= 600, String(S.get().audit.length));

console.log("3) 저장 공간이 꽉 차면 메모리도 바뀌지 않는다");
const q = makeEnv();
const QS = q.GV.store;
QS.load();
const goodRaw = q.ls._raw.get("glovek.workspace");
const goodCount = QS.get().entities.length;
/* 이제부터 본 키 쓰기만 실패하게 만든다(용량 초과) */
q.ls.setItem = (k, v) => {
  if (k === "glovek.workspace") { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
  q.ls._raw.set(k, String(v));
};
const r = QS.tx({ op: "entity.create", targetType: "entity", note: "용량 테스트" }, (d) => {
  d.entities.unshift({
    id: "quota-test", extId: "Q-1", kind: "company", name: "용량테스트", legalName: "", category: "리빙",
    source: "엑셀 업로드", inflowAt: new Date().toISOString(), owner: "미배정", quality: "미분류",
    readiness: "L0", readinessOverride: null, phone: "", email: "", website: "", followers: null,
    revenue: { amount: null, year: null, currency: "KRW", legalEntity: "", scope: "", status: "unknown", sourceUrl: "" },
    memo: "", contacts: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lastCommAt: null, nextActionAt: null, nextAction: ""
  });
  return { ok: true };
});
ok("ok:false 로 돌려준다", r.ok === false, JSON.stringify(r));
ok("저장소 문제임을 알려 준다", !!r.storage && /공간|저장/.test(r.error || ""), r.error);
ok("메모리 건수가 그대로", QS.get().entities.length === goodCount,
  goodCount + " -> " + QS.get().entities.length);
ok("메모리에 새 레코드가 없다", !QS.get().entities.some((e) => e.id === "quota-test"));
ok("저장분이 이전 그대로", q.ls._raw.get("glovek.workspace") === goodRaw);
const persistedCount = JSON.parse(q.ls._raw.get("glovek.workspace")).entities.length;
ok("저장분 건수도 그대로", persistedCount === goodCount, String(persistedCount));

console.log("4) 초기화·복원도 저장 실패 때 안전하다");
const rr = QS.reset(true);
ok("초기화가 실패로 돌아온다", rr.ok === false, JSON.stringify(rr));
ok("초기화 실패 뒤에도 메모리 유지", QS.get().entities.length === goodCount);
ok("초기화 실패 뒤에도 저장분 유지", q.ls._raw.get("glovek.workspace") === goodRaw);
const rb = QS.importBackup(backupText);
ok("복원도 실패로 돌아온다", rb.ok === false, JSON.stringify(rb));
ok("복원 실패 뒤에도 메모리 유지", QS.get().entities.length === goodCount);
ok("복원 실패 뒤에도 저장분 유지", q.ls._raw.get("glovek.workspace") === goodRaw);

console.log("5) 저장소를 아예 못 쓰는 창은 메모리 전용으로 알린다");
const b = makeEnv({ blocked: true });
const BS = b.GV.store;
BS.load();
const h = BS.health();
ok("메모리 전용으로 판정", h.memoryOnly === true, JSON.stringify(h));
const br = BS.tx({ op: "entity.memo", targetType: "entity", note: "메모리 전용" }, (d) => {
  if (d.entities[0]) d.entities[0].memo = "메모리 전용 저장";
  return { ok: true };
});
ok("변경은 되고 경고가 붙는다", br.ok === true && br.saved === false && !!br.warning, JSON.stringify(br));
ok("경고에 새로고침 안내가 있다", /새로고침/.test(br.warning), br.warning);

console.log("");
console.log(pass + " 통과, " + fail + " 실패");
process.exit(fail ? 1 : 0);
