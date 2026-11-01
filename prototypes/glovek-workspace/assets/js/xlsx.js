/* Glovek Workspace — 최소 XLSX 읽기(내장)
 *   외부 라이브러리를 받지 않는다. 브라우저에 있는 것만 쓴다:
 *     · ZIP 구조는 직접 읽는다(중앙 디렉터리 → 로컬 헤더)
 *     · 압축 해제는 DecompressionStream('deflate-raw') (브라우저 내장)
 *     · 시트 XML 은 DOMParser 로 읽는다
 *   첫 시트의 셀 값만 꺼낸다. 수식은 계산하지 않고 저장된 값(<v>)을 쓴다.
 *   쓰기는 지원하지 않는다 — 가져오기 전용이다.
 */
(function (global) {
  "use strict";
  var GV = global.GV = global.GV || {};

  function u16(b, p) { return b[p] | (b[p + 1] << 8); }
  function u32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }

  /** ZIP 중앙 디렉터리를 읽어 { 이름: {method, start, size} } 를 만든다. */
  function readZip(bytes) {
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("ZIP 구조를 찾지 못했습니다. xlsx 파일이 맞는지 확인해 주세요.");
    var count = u16(bytes, eocd + 10);
    var cdOff = u32(bytes, eocd + 16);
    var entries = {}, p = cdOff;
    for (var n = 0; n < count; n++) {
      if (u32(bytes, p) !== 0x02014b50) break;
      var method = u16(bytes, p + 10);
      var csize = u32(bytes, p + 20);
      var nameLen = u16(bytes, p + 28);
      var extraLen = u16(bytes, p + 30);
      var cmtLen = u16(bytes, p + 32);
      var localOff = u32(bytes, p + 42);
      var name = new TextDecoder("utf-8").decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method: method, csize: csize, localOff: localOff };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  async function readEntry(bytes, entry) {
    if (!entry) return null;
    var p = entry.localOff;
    if (u32(bytes, p) !== 0x04034b50) throw new Error("ZIP 항목 헤더가 올바르지 않습니다.");
    var nameLen = u16(bytes, p + 26);
    var extraLen = u16(bytes, p + 28);
    var start = p + 30 + nameLen + extraLen;
    var raw = bytes.subarray(start, start + entry.csize);
    if (entry.method === 0) return new TextDecoder("utf-8").decode(raw);
    if (entry.method !== 8) throw new Error("지원하지 않는 압축 방식입니다(method " + entry.method + ").");
    if (typeof global.DecompressionStream !== "function") {
      throw new Error("이 브라우저가 압축 해제(DecompressionStream)를 지원하지 않습니다. CSV 로 가져와 주세요.");
    }
    var ds = new global.DecompressionStream("deflate-raw");
    var blob = new Blob([raw]);
    var stream = blob.stream().pipeThrough(ds);
    var text = await new Response(stream).text();
    return text;
  }

  function colToIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || "");
    if (!m) return 0;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  /**
   * 첫 번째 시트를 2차원 배열로 돌려준다.
   *   날짜 서식이 걸린 숫자 셀은 { date: Date } 로 감싸 돌려준다(시리얼 오해 방지).
   */
  async function parse(file) {
    var buf = await file.arrayBuffer();
    var bytes = new Uint8Array(buf);
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      throw new Error("xlsx 파일이 아닙니다(ZIP 서명 없음). 97-2003 형식(.xls)은 지원하지 않습니다.");
    }
    var zip = readZip(bytes);
    var wbText = await readEntry(bytes, zip["xl/workbook.xml"]);
    if (!wbText) throw new Error("통합문서(xl/workbook.xml)를 찾지 못했습니다.");
    var dp = new DOMParser();
    var wb = dp.parseFromString(wbText, "application/xml");
    var sheetEls = Array.prototype.slice.call(wb.getElementsByTagName("sheet"));
    if (!sheetEls.length) throw new Error("시트가 없습니다.");
    var first = sheetEls[0];
    var sheetName = first.getAttribute("name") || "Sheet1";
    var rid = first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");

    var target = "xl/worksheets/sheet1.xml";
    var relText = await readEntry(bytes, zip["xl/_rels/workbook.xml.rels"]);
    if (relText && rid) {
      var rels = dp.parseFromString(relText, "application/xml");
      var list = Array.prototype.slice.call(rels.getElementsByTagName("Relationship"));
      var hit = list.find(function (r) { return r.getAttribute("Id") === rid; });
      if (hit) {
        var t = hit.getAttribute("Target") || "";
        target = t.indexOf("/") === 0 ? t.slice(1) : (t.indexOf("xl/") === 0 ? t : "xl/" + t);
      }
    }
    if (!zip[target]) {
      var guess = Object.keys(zip).find(function (k) { return /^xl\/worksheets\/.+\.xml$/.test(k); });
      if (!guess) throw new Error("시트 XML 을 찾지 못했습니다.");
      target = guess;
    }

    /* 공유 문자열 */
    var shared = [];
    var ssText = await readEntry(bytes, zip["xl/sharedStrings.xml"]);
    if (ssText) {
      var ss = dp.parseFromString(ssText, "application/xml");
      shared = Array.prototype.slice.call(ss.getElementsByTagName("si")).map(function (si) {
        var ts = Array.prototype.slice.call(si.getElementsByTagName("t"));
        return ts.map(function (t) { return t.textContent; }).join("");
      });
    }

    /* 날짜 서식이 걸린 스타일 번호 모으기 */
    var dateStyles = new Set();
    var stylesText = await readEntry(bytes, zip["xl/styles.xml"]);
    if (stylesText) {
      var st = dp.parseFromString(stylesText, "application/xml");
      var dateFmtIds = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
      Array.prototype.slice.call(st.getElementsByTagName("numFmt")).forEach(function (nf) {
        var code = nf.getAttribute("formatCode") || "";
        if (/[yYmMdD]/.test(code) && !/[#0]/.test(code)) dateFmtIds.add(Number(nf.getAttribute("numFmtId")));
      });
      var cellXfs = st.getElementsByTagName("cellXfs")[0];
      if (cellXfs) {
        Array.prototype.slice.call(cellXfs.getElementsByTagName("xf")).forEach(function (xf, idx) {
          if (dateFmtIds.has(Number(xf.getAttribute("numFmtId")))) dateStyles.add(idx);
        });
      }
    }

    var shText = await readEntry(bytes, zip[target]);
    var sh = dp.parseFromString(shText, "application/xml");
    var rowEls = Array.prototype.slice.call(sh.getElementsByTagName("row"));
    var rows = [];
    rowEls.forEach(function (rowEl) {
      var cells = [];
      Array.prototype.slice.call(rowEl.getElementsByTagName("c")).forEach(function (c) {
        var idx = colToIndex(c.getAttribute("r"));
        var type = c.getAttribute("t");
        var value = "";
        if (type === "inlineStr") {
          var is = c.getElementsByTagName("is")[0];
          value = is ? Array.prototype.slice.call(is.getElementsByTagName("t"))
            .map(function (t) { return t.textContent; }).join("") : "";
        } else {
          var vEl = c.getElementsByTagName("v")[0];
          var raw = vEl ? vEl.textContent : "";
          if (type === "s") value = shared[Number(raw)] != null ? shared[Number(raw)] : "";
          else if (type === "str") value = raw;
          else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
          else if (type === "e") value = raw;
          else {
            var sNum = Number(c.getAttribute("s"));
            if (raw !== "" && dateStyles.has(sNum)) {
              var d = GV.util.serialToDate(raw);
              value = d ? GV.util.fmtDate(d) : raw;
            } else value = raw;
          }
        }
        cells[idx] = String(value == null ? "" : value);
      });
      for (var k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = "";
      rows.push(cells);
    });
    var trimmed = rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ""; });
    });
    return { sheetName: sheetName, rows: trimmed, sheets: sheetEls.length };
  }

  GV.xlsx = { parse: parse, readZip: readZip, colToIndex: colToIndex };
})(window);
