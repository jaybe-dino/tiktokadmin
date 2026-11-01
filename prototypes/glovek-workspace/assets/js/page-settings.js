/* Glovek Workspace — 중간 체크포인트 임시 화면(settings). 다음 커밋에서 실제 구현으로 교체된다. */
(function (global) {
  "use strict";
  var GV = global.GV, U = GV.util;
  GV.pages = GV.pages || {};
  GV.pages["settings"] = { render: function () {
    var w = U.el("div");
    w.appendChild(U.el("h1", { text: "settings" }));
    w.appendChild(GV.app.banner("warn", "이 화면은 중간 체크포인트에서 아직 구현 전입니다. 다음 커밋에 포함됩니다."));
    return w;
  } };
})(window);
