/* Glovek Workspace — 공통 도구
 *   · 모든 사용자·파일 유래 문자열은 textContent 또는 esc() 로만 넣는다.
 *   · 링크는 http(s) 만 통과시킨다(javascript:·data: 차단).
 *   · CSV 내보내기는 수식 주입을 막는다.
 *   외부 네트워크·외부 라이브러리를 쓰지 않는다.
 */
(function (global) {
  "use strict";
  var GV = global.GV = global.GV || {};

  /* ── 문자열 ─────────────────────────────────── */
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }
  /** 제어문자를 지우고 길이를 제한한다 — 셀·행을 깨뜨리는 값 방지. */
  function clean(s, max) {
    var out = String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(/[ \t]+/g, " ").trim();
    return max ? out.slice(0, max) : out;
  }

  /** http(s) 주소만 통과. 그 밖(javascript:, data:, 자격증명 포함)은 null. */
  function safeUrl(raw) {
    var v = clean(raw, 400);
    if (!v) return null;
    if (/^[=+\-@]/.test(v)) return null;
    var candidate = /^[a-z][a-z0-9+.\-]*:\/\//i.test(v) ? v : "https://" + v;
    var u;
    try { u = new URL(candidate); } catch (e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname || u.hostname.indexOf(".") < 0) return null;
    return u.href;
  }
  function safeEmail(raw) {
    var v = clean(raw, 200).toLowerCase();
    return /^[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[a-z]{2,}$/i.test(v) ? v : null;
  }
  function safePhone(raw) {
    var v = clean(raw, 40);
    return /^[0-9+][0-9\-+() .]*$/.test(v) ? v : null;
  }

  /* ── DOM ────────────────────────────────────── */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") { node.textContent = String(v); return; }
      if (k === "html") { node.innerHTML = v; return; }
      if (k === "class") { node.className = v; return; }
      if (k.slice(0, 2) === "on" && typeof v === "function") { node.addEventListener(k.slice(2), v); return; }
      node.setAttribute(k, v === true ? "" : String(v));
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function frag(nodes) {
    var f = document.createDocumentFragment();
    (nodes || []).forEach(function (n) { if (n) f.appendChild(n); });
    return f;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ── 아이콘(인라인 SVG — 외부 아이콘 폰트를 쓰지 않는다) ── */
  var PATHS = {
    "table": "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18",
    "columns": "M4 4h5v16H4zM10 4h5v16h-5zM16 4h4v16h-4z",
    "calendar": "M4 5h16v16H4zM4 9h16M9 3v4M15 3v4M9 14l2 2 4-4",
    "message": "M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    "database": "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    "history": "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2",
    "settings": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 14H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 2.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    "search": "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
    "grip": "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
    "clock": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    "plus": "M12 5v14M5 12h14",
    "x": "M18 6 6 18M6 6l12 12",
    "check": "M20 6 9 17l-5-5",
    "upload": "M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2",
    "download": "M12 4v12M7 11l5 5 5-5M4 19h16",
    "warn": "M12 3 2 20h20L12 3zM12 9v5M12 17h.01",
    "info": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
    "user": "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "undo": "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-5",
    "link": "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
    "chevron": "m9 6 6 6-6 6"
  };
  function icon(name, size) {
    var d = PATHS[name] || PATHS.info;
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor"'
      + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'
      + d + '"/></svg>';
  }
  function iconNode(name, size) {
    var span = document.createElement("span");
    span.style.display = "inline-flex";
    span.innerHTML = icon(name, size);   /* 내부 상수만 — 사용자 입력이 섞이지 않는다 */
    return span.firstChild;
  }

  /* ── 날짜 ───────────────────────────────────── */
  function nowIso() { return new Date().toISOString(); }
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(base, n) { var x = new Date(base); x.setDate(x.getDate() + n); return x; }
  function parseDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var s = String(v).trim();
    var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
    if (m) {
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return (d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) ? d : null;
    }
    var dt = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(:\d{2})?$/.exec(s);
    if (dt && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) {
      /* 시간대 표기가 없는 "날짜 시각" 은 KST 로 읽는다(국내 운영 기준). */
      var norm = dt[1] + "-" + pad(dt[2]) + "-" + pad(dt[3]) + "T" + pad(dt[4]) + ":" + dt[5];
      var iso = kstInputToIso(norm);
      if (iso) return new Date(iso);
    }
    var t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }
  function fmtDate(v) {
    var d = parseDate(v);
    if (!d) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtDateTime(v) {
    var d = parseDate(v);
    if (!d) return "";
    return fmtDate(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtShort(v) {
    var d = parseDate(v);
    if (!d) return "";
    return pad(d.getMonth() + 1) + "/" + pad(d.getDate());
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function relDays(v) {
    var d = parseDate(v);
    if (!d) return null;
    return Math.round((dayStart(d) - dayStart(new Date())) / 86400000);
  }
  function relLabel(v) {
    var n = relDays(v);
    if (n == null) return "";
    if (n === 0) return "오늘";
    if (n === 1) return "내일";
    if (n === -1) return "어제";
    return n < 0 ? Math.abs(n) + "일 지남" : n + "일 뒤";
  }
  /* ── KST 고정 변환 ──────────────────────────
   *   유입일시는 "몇 시에 들어왔는지" 가 중요하다(최신 유입 정렬). 브라우저 시간대에
   *   따라 흔들리지 않게, 표시와 입력을 모두 KST(+09:00) 로 못 박는다.
   */
  var KST_MS = 9 * 3600000;
  function kstParts(iso) {
    var d = parseDate(iso);
    if (!d) return null;
    var k = new Date(d.getTime() + KST_MS);
    return {
      y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(),
      h: k.getUTCHours(), mi: k.getUTCMinutes()
    };
  }
  /** ISO → "YYYY-MM-DD HH:mm" (KST 벽시계). */
  function fmtKst(iso) {
    var k = kstParts(iso);
    if (!k) return "";
    return k.y + "-" + pad(k.m) + "-" + pad(k.d) + " " + pad(k.h) + ":" + pad(k.mi);
  }
  /** ISO → "YYYY-MM-DD" (KST). */
  function fmtKstDate(iso) {
    var k = kstParts(iso);
    return k ? k.y + "-" + pad(k.m) + "-" + pad(k.d) : "";
  }
  /** ISO → datetime-local 입력값 "YYYY-MM-DDTHH:mm" (KST 벽시계). */
  function kstInputValue(iso) {
    var k = kstParts(iso);
    if (!k) return "";
    return k.y + "-" + pad(k.m) + "-" + pad(k.d) + "T" + pad(k.h) + ":" + pad(k.mi);
  }
  /** datetime-local 입력값(KST 로 읽음) → ISO. 시간대를 +09:00 으로 명시해 만든다. */
  function kstInputToIso(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(v || "").trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    var utc = Date.UTC(y, mo - 1, d, h, mi) - KST_MS;
    var dt = new Date(utc);
    if (isNaN(dt.getTime())) return null;
    /* 2026-02-31 같은 값이 넘어가 버리는 것을 막는다 */
    var back = kstParts(dt.toISOString());
    if (!back || back.m !== mo || back.d !== d) return null;
    return dt.toISOString();
  }
  /** 날짜만 있는 값(YYYY-MM-DD)을 KST 00:00 으로 읽는다. */
  function kstDateToIso(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "").trim());
    return m ? kstInputToIso(v + "T00:00") : null;
  }

  /** 엑셀 날짜 시리얼(1899-12-30 기준) → Date(UTC 기준 벽시계). */
  function serialToDate(n) {
    var num = Number(n);
    if (!isFinite(num) || num <= 0 || num > 80000) return null;
    return new Date(Math.round((num - 25569) * 86400000));
  }
  /**
   * 시리얼 → "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm" (벽시계 그대로).
   *   UTC 게터로 읽는다 — 로컬 시간대 때문에 날짜가 하루 밀리지 않게.
   */
  function serialText(n, withTime) {
    var d = serialToDate(n);
    if (!d) return null;
    var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
    if (withTime) s += " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
    return s;
  }

  /* ── 숫자·금액 ──────────────────────────────── */
  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(String(v).replace(/[,\s₩]/g, ""));
    return isFinite(n) ? n : null;
  }
  function intOrNull(v) {
    var n = num(v);
    return n == null ? null : Math.round(n);
  }
  function won(v) {
    var n = num(v);
    if (n == null) return "미확인";
    if (n === 0) return "0원";
    if (Math.abs(n) >= 100000000) return trim(n / 100000000) + "억원";
    if (Math.abs(n) >= 10000) return trim(n / 10000) + "만원";
    return n.toLocaleString("ko-KR") + "원";
  }
  function eok(v) {
    var n = num(v);
    if (n == null) return "미확인";
    return trim(n) + "억원";
  }
  function trim(n) { return String(Number(n.toFixed(2))); }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  /* ── CSV ────────────────────────────────────── */
  /** RFC4180 파서 — 따옴표 안 콤마·줄바꿈을 지킨다. */
  function parseCsv(text) {
    var rows = [], row = [], cur = "", q = false, i = 0;
    var s = String(text).replace(/^﻿/, "");
    while (i < s.length) {
      var c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') { cur += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cur += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ",") { row.push(cur); cur = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; continue; }
      cur += c; i++;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
  }
  /** 수식 주입 방지 — = + - @ 탭·CR 로 시작하는 값 앞에 ' 를 붙인다(CSV 전용). */
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }
  function download(name, text, mime) {
    var blob = new Blob(["﻿" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ── 기타 ───────────────────────────────────── */
  function uid(prefix) {
    var r = (global.crypto && global.crypto.randomUUID)
      ? global.crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    return (prefix || "id") + "_" + r;
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 180);
    };
  }
  function sortBy(arr, key, dir) {
    var sign = dir === "desc" ? -1 : 1;
    return arr.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;            /* 미확인은 항상 뒤로 */
      if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
      return String(x).localeCompare(String(y), "ko") * sign;
    });
  }
  function groupCount(arr, key) {
    var m = new Map();
    arr.forEach(function (x) { var k = key(x); m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }

  GV.util = {
    esc: esc, clean: clean, safeUrl: safeUrl, safeEmail: safeEmail, safePhone: safePhone,
    el: el, frag: frag, clearNode: clear, icon: icon, iconNode: iconNode,
    nowIso: nowIso, dayStart: dayStart, addDays: addDays, parseDate: parseDate,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtShort: fmtShort, relDays: relDays,
    relLabel: relLabel, serialToDate: serialToDate, serialText: serialText, pad: pad,
    fmtKst: fmtKst, fmtKstDate: fmtKstDate, kstInputValue: kstInputValue,
    kstInputToIso: kstInputToIso, kstDateToIso: kstDateToIso,
    num: num, intOrNull: intOrNull, won: won, eok: eok, pct: pct,
    parseCsv: parseCsv, toCsv: toCsv, csvCell: csvCell, download: download,
    uid: uid, debounce: debounce, sortBy: sortBy, groupCount: groupCount
  };
})(window);
