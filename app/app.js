/* 공포탐욕 수익률 계산기
   Reads app/data/fng_stats.json (or an inlined <script id="fng-data">)
   and renders the calculator, four charts and the tables. No libraries. */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var DATA = null;
  var tip = document.getElementById("tooltip");

  var state = { score: 50, hz: "1y", ret: "pr", range: "all" };

  var HZ = [
    { id: "3m", label: "3개월", word: "3개월" },
    { id: "6m", label: "6개월", word: "6개월" },
    { id: "1y", label: "1년", word: "1년" },
    { id: "3y", label: "3년", word: "3년(연평균)" }
  ];
  var RET = [
    { id: "pr", label: "가격", word: "가격 수익률" },
    { id: "tr", label: "배당 포함", word: "배당 재투자 총수익률" }
  ];
  var RANGE = [
    { id: "all", label: "1980년~", word: "1980년 이후 (2011년 이전은 복원 지수)" },
    { id: "cnn", label: "2011년~", word: "2011년 이후 (CNN 실측만)" }
  ];
  var CAT_KO = {
    "Extreme Fear": "극단적 공포", "Fear": "공포", "Neutral": "중립",
    "Greed": "탐욕", "Extreme Greed": "극단적 탐욕"
  };
  var CATS = [
    { max: 25, name: "극단적 공포", token: "--fear" },
    { max: 45, name: "공포", token: "--fear-mid" },
    { max: 56, name: "중립", token: "--muted" },
    { max: 75, name: "탐욕", token: "--greed-mid" },
    { max: 101, name: "극단적 탐욕", token: "--greed" }
  ];

  /* ------------------------------------------------------------ utils */
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function pct(v, signed) {
    if (v === null || v === undefined || isNaN(v)) return "–";
    var s = (signed !== false && v > 0 ? "+" : "") + v.toFixed(1) + "%";
    return s;
  }

  function signClass(v) { return v === null || v === undefined ? "" : (v >= 0 ? "pos" : "neg"); }

  function catOf(score) {
    for (var i = 0; i < CATS.length; i++) if (score < CATS[i].max) return CATS[i];
    return CATS[CATS.length - 1];
  }

  function key() { return state.range + "|" + state.ret + "|" + state.hz; }
  function ds() { return DATA.datasets[key()]; }
  function hzWord() { return HZ.filter(function (h) { return h.id === state.hz; })[0].word; }
  function retWord() { return RET.filter(function (r) { return r.id === state.ret; })[0].word; }
  function rangeWord() { return RANGE.filter(function (r) { return r.id === state.range; })[0].word; }
  function retCol() { return state.ret + "_" + state.hz; }

  function niceTicks(min, max, count) {
    var span = max - min;
    if (!(span > 0)) return [min];
    var raw = span / (count || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var out = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
    var top = y - r.height - 14;
    if (top < 8) top = y + 18;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { tip.hidden = true; }

  function frame(shell, height) {
    shell.innerHTML = "";
    var w = Math.max(260, Math.round(shell.clientWidth || 640));
    var svg = el("svg", { viewBox: "0 0 " + w + " " + height, width: w, height: height });
    shell.appendChild(svg);
    return { svg: svg, w: w, h: height };
  }

  function gridline(svg, x1, y1, x2, y2, strong) {
    el("line", {
      x1: x1, y1: y1, x2: x2, y2: y2,
      style: "stroke:var(" + (strong ? "--axis" : "--grid") + ");stroke-width:1"
    }, svg);
  }

  function text(svg, x, y, str, opts) {
    opts = opts || {};
    return el("text", {
      x: x, y: y, "text-anchor": opts.anchor || "middle",
      "dominant-baseline": opts.baseline || "auto",
      style: "font-size:" + (opts.size || 11) + "px;fill:var(" + (opts.token || "--muted") + ");" +
             "font-family:'IBM Plex Mono',ui-monospace,monospace;" + (opts.extra || "")
    }, svg).appendChild(document.createTextNode(str)).parentNode;
  }

  /* ------------------------------------------------------- weekly rows */
  function weeklyRows() {
    var col = retCol();
    var out = [];
    for (var i = 0; i < DATA.weekly.length; i++) {
      var r = DATA.weekly[i];
      if (state.range === "cnn" && !r.s) continue;
      if (r[col] === null || r[col] === undefined) continue;
      out.push({ d: r.d, f: r.f, r: r[col], cnn: !!r.s });
    }
    return out;
  }

  function inBand(rows) {
    var lo = state.score - 5, hi = state.score + 5;
    return rows.filter(function (r) { return r.f >= lo && r.f <= hi; });
  }

  /* ---------------------------------------------------------- controls */
  function segment(host, items, field) {
    host.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      b.setAttribute("aria-pressed", state[field] === it.id ? "true" : "false");
      b.addEventListener("click", function () { state[field] = it.id; renderAll(); });
      host.appendChild(b);
    });
  }

  function buildPresets() {
    var host = $("presets");
    var latest = DATA.meta.latest_fng;
    var items = [
      { v: Math.round(latest), label: "오늘 " + latest.toFixed(0) },
      { v: 10, label: "극단적 공포 10" },
      { v: 30, label: "공포 30" },
      { v: 50, label: "중립 50" },
      { v: 70, label: "탐욕 70" },
      { v: 90, label: "극단적 탐욕 90" }
    ];
    host.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      b.addEventListener("click", function () { setScore(it.v); });
      host.appendChild(b);
    });
  }

  function setScore(v) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    state.score = v;
    $("score-number").value = v;
    $("score-range").value = v;
    renderAll();
  }

  /* ----------------------------------------------------------- verdict */
  function renderVerdict() {
    var c = ds().curve, i = state.score, base = ds().baseline;
    var cat = catOf(i);
    var chip = $("score-cat");
    chip.textContent = cat.name;
    chip.style.setProperty("--chip", "var(" + cat.token + ")");

    var mean = c.mean[i];
    $("hero-label").textContent = hzWord() + " 후 평균 수익률";

    if (mean === null) {
      $("hero-value").textContent = "표본 부족";
      $("hero-value").style.color = "var(--muted)";
      $("hero-note").textContent = "이 점수대에서는 통계를 낼 만큼의 과거 기록이 없습니다.";
      ["t-median", "t-win", "t-band", "t-n"].forEach(function (id) { $(id).textContent = "–"; });
      $("reading").textContent = "데이터 범위를 ‘1980년~’으로 바꾸면 표본이 늘어납니다.";
      return;
    }

    $("hero-value").textContent = pct(mean);
    $("hero-value").style.color = mean >= 0 ? "var(--ink)" : "var(--bad)";
    var diff = mean - base.mean;
    $("hero-note").textContent = "전체 평균 " + pct(base.mean) + " 대비 " +
      (diff >= 0 ? "+" : "") + diff.toFixed(1) + "%p";

    $("t-median").textContent = pct(c.median[i]);
    $("t-median").className = "tile-value " + signClass(c.median[i]);
    $("t-win").textContent = c.win[i].toFixed(0) + "%";
    $("t-band").textContent = pct(c.p10[i]) + " ~ " + pct(c.p90[i]);
    $("t-band").className = "tile-value small";
    $("t-n").textContent = c.n_raw[i].toLocaleString("ko-KR") + "일";
    $("t-n").nextElementSibling.textContent = "±5점 구간 · 독립 " + (c.n_raw[i] / 252).toFixed(1) + "년치";

    var worse = mean < base.mean;
    $("reading").innerHTML =
      "공포탐욕지수 <strong>" + i + "점</strong>(" + cat.name + ")에서 " + rangeWord().split(" (")[0] +
      " 데이터로 본 " + hzWord() + " 후 " + retWord() + "은 평균 <strong>" + pct(mean) +
      "</strong>, 중앙값 <strong>" + pct(c.median[i]) + "</strong>, 플러스로 끝난 경우가 <strong>" +
      c.win[i].toFixed(0) + "%</strong>였습니다. 같은 기간 아무 날에나 샀을 때의 평균은 " +
      pct(base.mean) + "이므로, 이 점수대는 " + (worse ? "평균보다 <strong>낮았습니다</strong>" : "평균보다 <strong>높았습니다</strong>") +
      ". 다만 이 구간의 표본은 " + c.n_raw[i].toLocaleString("ko-KR") + "거래일(겹치는 기간을 감안하면 독립적으로는 " +
      (c.n_raw[i] / 252).toFixed(1) + "년치)에 불과합니다.";
  }

  /* ------------------------------------------------------- curve chart */
  function renderCurve() {
    var shell = $("curve-shell");
    var c = ds().curve, base = ds().baseline;
    var f = frame(shell, shell.clientWidth < 520 ? 260 : 320);
    var padL = 46, padR = 16, padT = 14, padB = 44;
    var pw = f.w - padL - padR, ph = f.h - padT - padB;

    var lows = [], highs = [];
    for (var i = 0; i <= 100; i++) {
      if (c.p10[i] === null) continue;
      lows.push(c.p10[i]); highs.push(c.p90[i]);
    }
    if (!lows.length) return;
    var ymin = Math.min.apply(null, lows), ymax = Math.max.apply(null, highs);
    ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0);
    var padY = (ymax - ymin) * 0.08;
    ymin -= padY; ymax += padY;

    var X = function (s) { return padL + (s / 100) * pw; };
    var Y = function (v) { return padT + (1 - (v - ymin) / (ymax - ymin)) * ph; };

    niceTicks(ymin, ymax, 5).forEach(function (t) {
      gridline(f.svg, padL, Y(t), padL + pw, Y(t), Math.abs(t) < 1e-9);
      text(f.svg, padL - 8, Y(t) + 4, t.toFixed(0) + "%", { anchor: "end" });
    });

    // p10-p90 and p25-p75 envelopes
    function band(loKey, hiKey, opacity) {
      var up = [], dn = [];
      for (var s = 0; s <= 100; s++) {
        if (c[loKey][s] === null) continue;
        up.push(X(s) + "," + Y(c[hiKey][s]));
        dn.unshift(X(s) + "," + Y(c[loKey][s]));
      }
      if (!up.length) return;
      el("path", {
        d: "M" + up.join("L") + "L" + dn.join("L") + "Z",
        style: "fill:var(--series);fill-opacity:" + opacity + ";stroke:none"
      }, f.svg);
    }
    band("p10", "p90", 0.07);
    band("p25", "p75", 0.14);

    // baseline (unconditional average)
    el("line", {
      x1: padL, y1: Y(base.mean), x2: padL + pw, y2: Y(base.mean),
      style: "stroke:var(--axis);stroke-width:1"
    }, f.svg);

    // mean curve
    var pts = [];
    for (var s2 = 0; s2 <= 100; s2++) if (c.mean[s2] !== null) pts.push(X(s2) + "," + Y(c.mean[s2]));
    el("path", {
      d: "M" + pts.join("L"),
      style: "fill:none;stroke:var(--series);stroke-width:2;stroke-linejoin:round;stroke-linecap:round"
    }, f.svg);

    // x axis + sentiment strip
    var gid = "fngGrad" + Math.random().toString(36).slice(2, 7);
    var defs = el("defs", {}, f.svg);
    var lg = el("linearGradient", { id: gid, x1: "0", x2: "1", y1: "0", y2: "0" }, defs);
    [["0%", "--fear"], ["25%", "--fear-mid"], ["50%", "--neutral-mid"],
     ["75%", "--greed-mid"], ["100%", "--greed"]].forEach(function (st) {
      el("stop", { offset: st[0], style: "stop-color:var(" + st[1] + ")" }, lg);
    });
    el("rect", { x: padL, y: padT + ph + 8, width: pw, height: 6, rx: 3, style: "fill:url(#" + gid + ")" }, f.svg);
    [0, 20, 40, 60, 80, 100].forEach(function (s) {
      text(f.svg, X(s), padT + ph + 30, String(s));
    });
    text(f.svg, padL, f.h - 2, "공포", { anchor: "start", size: 10.5 });
    text(f.svg, padL + pw, f.h - 2, "탐욕", { anchor: "end", size: 10.5 });

    // selected-score marker
    if (c.mean[state.score] !== null) {
      el("line", {
        x1: X(state.score), y1: padT, x2: X(state.score), y2: padT + ph,
        style: "stroke:var(--ink);stroke-width:1;stroke-opacity:.35"
      }, f.svg);
      el("circle", {
        cx: X(state.score), cy: Y(c.mean[state.score]), r: 5.5,
        style: "fill:var(--series);stroke:var(--surface);stroke-width:2"
      }, f.svg);
      text(f.svg, X(state.score), Y(c.mean[state.score]) - 14, pct(c.mean[state.score]),
        { token: "--ink", size: 12.5, extra: "font-weight:600;" });
    }

    // hover
    var hover = el("line", { x1: 0, y1: padT, x2: 0, y2: padT + ph, style: "stroke:var(--ink);stroke-width:1;stroke-opacity:0" }, f.svg);
    el("rect", { x: padL, y: padT, width: pw, height: ph, style: "fill:transparent" }, f.svg)
      .addEventListener("mousemove", function (ev) {
        var box = f.svg.getBoundingClientRect();
        var s = Math.round(((ev.clientX - box.left) * (f.w / box.width) - padL) / pw * 100);
        s = Math.max(0, Math.min(100, s));
        if (c.mean[s] === null) { hover.style.strokeOpacity = 0; hideTip(); return; }
        hover.setAttribute("x1", X(s)); hover.setAttribute("x2", X(s));
        hover.style.strokeOpacity = .3;
        showTip("<b>지수 " + s + "</b> · " + catOf(s).name + "<br><span class='tt-mono'>평균 " + pct(c.mean[s]) +
          " · 중앙값 " + pct(c.median[s]) + "<br>상승 " + c.win[s].toFixed(0) + "% · 표본 " +
          c.n_raw[s].toLocaleString("ko-KR") + "일</span>", ev.clientX, ev.clientY);
      });
    f.svg.addEventListener("mouseleave", function () { hover.style.strokeOpacity = 0; hideTip(); });

    $("curve-sub").textContent = hzWord() + " 후 " + retWord() + " · " + rangeWord();
    $("curve-caption").textContent =
      "가로축은 공포탐욕지수, 세로축은 그 점수에서 산 뒤 " + hzWord() + " 동안의 수익률입니다. " +
      "각 점수는 ±" + DATA.meta.kernel_bw + "점 이웃을 가중평균한 값(가우시안 커널)이라 선이 부드럽게 이어집니다.";

    $("curve-legend").innerHTML =
      "<span><i style='background:var(--series)'></i>평균</span>" +
      "<span><i class='band' style='background:var(--series);opacity:.28'></i>중간 50% (25~75%)</span>" +
      "<span><i class='band' style='background:var(--series);opacity:.14'></i>80% 범위 (10~90%)</span>" +
      "<span><i style='background:var(--axis)'></i>전체 평균 " + pct(base.mean) + "</span>";
  }

  /* --------------------------------------------------- histogram chart */
  function renderHist() {
    var shell = $("hist-shell");
    var rows = inBand(weeklyRows());
    var f = frame(shell, 240);
    var padL = 34, padR = 12, padT = 12, padB = 34;
    var pw = f.w - padL - padR, ph = f.h - padT - padB;

    if (rows.length < 4) {
      text(f.svg, f.w / 2, f.h / 2, "표본이 부족합니다", { token: "--muted", size: 13 });
      $("hist-sub").textContent = "지수 " + (state.score - 5) + "~" + (state.score + 5) + "점 · 표본 없음";
      return;
    }

    var vals = rows.map(function (r) { return r.r; }).sort(function (a, b) { return a - b; });
    var lo = vals[0], hi = vals[vals.length - 1];
    var binW = Math.max(2, Math.ceil((hi - lo) / 14 / 2.5) * 2.5);
    var start = Math.floor(lo / binW) * binW;
    var nb = Math.max(1, Math.ceil((hi - start) / binW) + (hi === start ? 1 : 0));
    var bins = new Array(nb).fill(0);
    vals.forEach(function (v) {
      var idx = Math.min(nb - 1, Math.floor((v - start) / binW));
      bins[idx]++;
    });
    var maxN = Math.max.apply(null, bins);
    var median = vals[Math.floor(vals.length / 2)];

    var X = function (v) { return padL + ((v - start) / (nb * binW)) * pw; };
    var Y = function (n) { return padT + (1 - n / maxN) * ph; };

    niceTicks(0, maxN, 3).forEach(function (t) {
      gridline(f.svg, padL, Y(t), padL + pw, Y(t), false);
      text(f.svg, padL - 7, Y(t) + 4, String(t), { anchor: "end", size: 10.5 });
    });

    var slot = pw / nb;
    bins.forEach(function (n, k) {
      if (!n) return;
      var bw = Math.max(3, Math.min(24, slot - 2));
      var x = padL + slot * k + (slot - bw) / 2;
      var y = Y(n), h = padT + ph - y, r = Math.min(4, bw / 2, h);
      var d = "M" + x + "," + (padT + ph) + "V" + (y + r) +
              "a" + r + "," + r + " 0 0 1 " + r + "," + -r +
              "h" + (bw - 2 * r) + "a" + r + "," + r + " 0 0 1 " + r + "," + r +
              "V" + (padT + ph) + "Z";
      var bar = el("path", { d: d, style: "fill:var(--series);fill-opacity:.85" }, f.svg);
      var from = (start + k * binW), to = from + binW;
      bar.addEventListener("mousemove", function (ev) {
        showTip("<b>" + pct(from) + " ~ " + pct(to) + "</b><br><span class='tt-mono'>" + n +
          "주 (" + (100 * n / vals.length).toFixed(0) + "%)</span>", ev.clientX, ev.clientY);
      });
      bar.addEventListener("mouseleave", hideTip);
    });

    // zero line and median marker
    if (start < 0 && start + nb * binW > 0) {
      el("line", { x1: X(0), y1: padT, x2: X(0), y2: padT + ph, style: "stroke:var(--axis);stroke-width:1" }, f.svg);
    }
    el("line", {
      x1: X(median), y1: padT - 4, x2: X(median), y2: padT + ph,
      style: "stroke:var(--ink);stroke-width:2"
    }, f.svg);
    text(f.svg, X(median), padT - 8, "중앙값 " + pct(median), { token: "--ink", size: 11.5, extra: "font-weight:600;" });

    var ticks = niceTicks(start, start + nb * binW, 4);
    ticks.forEach(function (t) { text(f.svg, X(t), padT + ph + 18, t.toFixed(0) + "%"); });
    text(f.svg, padL + pw / 2, f.h - 2, hzWord() + " 수익률", { size: 10.5 });

    var win = vals.filter(function (v) { return v > 0; }).length;
    $("hist-sub").textContent = "지수 " + Math.max(0, state.score - 5) + "~" + Math.min(100, state.score + 5) +
      "점 · " + vals.length + "주 · 플러스 " + (100 * win / vals.length).toFixed(0) + "%";
  }

  /* ----------------------------------------------------- scatter chart */
  function renderScatter() {
    var shell = $("scatter-shell");
    var rows = weeklyRows();
    var f = frame(shell, 240);
    var padL = 40, padR = 12, padT = 12, padB = 34;
    var pw = f.w - padL - padR, ph = f.h - padT - padB;
    if (!rows.length) return;

    var rs = rows.map(function (r) { return r.r; });
    var ymin = Math.min.apply(null, rs), ymax = Math.max.apply(null, rs);
    var X = function (s) { return padL + (s / 100) * pw; };
    var Y = function (v) { return padT + (1 - (v - ymin) / (ymax - ymin)) * ph; };

    niceTicks(ymin, ymax, 4).forEach(function (t) {
      gridline(f.svg, padL, Y(t), padL + pw, Y(t), Math.abs(t) < 1e-9);
      text(f.svg, padL - 7, Y(t) + 4, t.toFixed(0) + "%", { anchor: "end", size: 10.5 });
    });

    var lo = state.score - 5, hi = state.score + 5;
    el("rect", {
      x: X(Math.max(0, lo)), y: padT, width: X(Math.min(100, hi)) - X(Math.max(0, lo)), height: ph,
      style: "fill:var(--series);fill-opacity:.07"
    }, f.svg);

    rows.forEach(function (r) {
      var on = r.f >= lo && r.f <= hi;
      var dot = el("circle", {
        cx: X(r.f), cy: Y(r.r), r: on ? 3.2 : 2.2,
        style: on
          ? "fill:var(--series);fill-opacity:.9;stroke:var(--surface);stroke-width:1.2"
          : "fill:var(--muted);fill-opacity:.3"
      }, f.svg);
      dot.addEventListener("mousemove", function (ev) {
        showTip("<b>" + r.d + "</b><br><span class='tt-mono'>지수 " + r.f.toFixed(0) + " → " +
          hzWord() + " 후 " + pct(r.r) + "</span>" + (r.cnn ? "" : "<br>복원 지수"), ev.clientX, ev.clientY);
      });
      dot.addEventListener("mouseleave", hideTip);
    });

    [0, 25, 50, 75, 100].forEach(function (s) { text(f.svg, X(s), padT + ph + 18, String(s)); });
    text(f.svg, padL + pw / 2, f.h - 2, "공포탐욕지수", { size: 10.5 });
    $("scatter-sub").textContent = rows.length.toLocaleString("ko-KR") + "주 · " + hzWord() + " 후 " + retWord();
  }

  /* ---------------------------------------------------- timeline chart */
  function renderTimeline() {
    var shell = $("timeline-shell");
    var f = frame(shell, shell.clientWidth < 520 ? 200 : 230);
    var padL = 34, padR = 14, padT = 14, padB = 30;
    var pw = f.w - padL - padR, ph = f.h - padT - padB;

    var rows = DATA.history || DATA.weekly;
    rows = rows.filter(function (r) { return state.range !== "cnn" || r.s; });
    if (!rows.length) return;
    var t0 = Date.parse(rows[0].d), t1 = Date.parse(rows[rows.length - 1].d);

    var X = function (t) { return padL + ((t - t0) / (t1 - t0)) * pw; };
    var Y = function (v) { return padT + (1 - v / 100) * ph; };

    [0, 25, 50, 75, 100].forEach(function (v) {
      gridline(f.svg, padL, Y(v), padL + pw, Y(v), v === 50);
      text(f.svg, padL - 7, Y(v) + 4, String(v), { anchor: "end", size: 10.5 });
    });

    // band around the selected score
    var lo = Math.max(0, state.score - 5), hi = Math.min(100, state.score + 5);
    el("rect", { x: padL, y: Y(hi), width: pw, height: Y(lo) - Y(hi), style: "fill:var(--series);fill-opacity:.12" }, f.svg);

    var gid = "tl" + Math.random().toString(36).slice(2, 7);
    var lg = el("linearGradient", {
      id: gid, gradientUnits: "userSpaceOnUse",
      x1: 0, y1: Y(100), x2: 0, y2: Y(0)
    }, el("defs", {}, f.svg));
    [["0%", "--greed"], ["25%", "--greed-mid"], ["50%", "--neutral-mid"],
     ["75%", "--fear-mid"], ["100%", "--fear"]].forEach(function (st) {
      el("stop", { offset: st[0], style: "stop-color:var(" + st[1] + ")" }, lg);
    });

    var d = rows.map(function (r, i) { return (i ? "L" : "M") + X(Date.parse(r.d)) + "," + Y(r.f); }).join("");
    el("path", { d: d, style: "fill:none;stroke:url(#" + gid + ");stroke-width:1;stroke-opacity:.55;stroke-linejoin:round" }, f.svg);

    // dots for weeks inside the selected band
    var hits = rows.filter(function (r) { return r.f >= lo && r.f <= hi; });
    hits.forEach(function (r) {
      el("circle", { cx: X(Date.parse(r.d)), cy: Y(r.f), r: 2.1, style: "fill:var(--series);fill-opacity:.9" }, f.svg);
    });

    // CNN start marker
    var cnnT = Date.parse(DATA.meta.cnn_start);
    if (state.range === "all" && cnnT > t0 && cnnT < t1) {
      el("line", { x1: X(cnnT), y1: padT, x2: X(cnnT), y2: padT + ph, style: "stroke:var(--ink);stroke-width:1;stroke-opacity:.35" }, f.svg);
      text(f.svg, X(cnnT) + 6, padT + 11, "← 복원 | CNN 실측 →", { anchor: "start", size: 10.5, token: "--ink-2" });
    }

    var years = [1980, 1990, 2000, 2010, 2020, 2026];
    years.forEach(function (y) {
      var t = Date.parse(y + "-01-01");
      if (t < t0 || t > t1) return;
      text(f.svg, X(t), padT + ph + 18, String(y));
    });

    var hover = el("line", { x1: 0, y1: padT, x2: 0, y2: padT + ph, style: "stroke:var(--ink);stroke-width:1;stroke-opacity:0" }, f.svg);
    el("rect", { x: padL, y: padT, width: pw, height: ph, style: "fill:transparent" }, f.svg)
      .addEventListener("mousemove", function (ev) {
        var box = f.svg.getBoundingClientRect();
        var t = t0 + ((ev.clientX - box.left) * (f.w / box.width) - padL) / pw * (t1 - t0);
        var best = null, bd = Infinity;
        for (var i = 0; i < rows.length; i++) {
          var dd = Math.abs(Date.parse(rows[i].d) - t);
          if (dd < bd) { bd = dd; best = rows[i]; }
        }
        if (!best) return;
        hover.setAttribute("x1", X(Date.parse(best.d)));
        hover.setAttribute("x2", X(Date.parse(best.d)));
        hover.style.strokeOpacity = .3;
        showTip("<b>" + best.d + "</b><br><span class='tt-mono'>지수 " + best.f.toFixed(0) + "</span> · " +
          catOf(best.f).name + (best.s ? "" : "<br>복원 지수"), ev.clientX, ev.clientY);
      });
    f.svg.addEventListener("mouseleave", function () { hover.style.strokeOpacity = 0; hideTip(); });

    $("timeline-sub").textContent = "주간 종가 기준 공포탐욕지수 · " + rangeWord();
    $("timeline-caption").textContent = "가로 띠가 선택한 " + lo + "~" + hi + "점 구간입니다. 표시된 주는 " +
      hits.length.toLocaleString("ko-KR") + "주이며, 이 시기들이 위 통계의 재료입니다.";
  }

  /* ----------------------------------------------------------- tables */
  function fillTable(tbody, rows, activeTest) {
    tbody.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      if (activeTest(r)) tr.className = "active";
      if (r.mean === undefined) {
        tr.className += " thin";
        tr.innerHTML = "<td>" + r.label + "</td><td>" + r.n + "</td>" +
          "<td colspan='5' style='text-align:right;color:var(--muted)'>통계를 내기에 표본이 부족합니다</td>";
        tbody.appendChild(tr);
        return;
      }
      var mid = (r.lo + r.hi) / 2;
      tr.innerHTML =
        "<td><span class='bucket-key' style='background:var(" + catOf(mid).token + ")'></span>" +
        (CAT_KO[r.label] || r.label) + "</td>" +
        "<td>" + r.n.toLocaleString("ko-KR") + "일<span style='color:var(--muted)'> · " + r.years + "년</span></td>" +
        "<td class='" + signClass(r.mean) + "'>" + pct(r.mean) + "</td>" +
        "<td class='" + signClass(r.median) + "'>" + pct(r.median) + "</td>" +
        "<td>" + r.win.toFixed(0) + "%</td>" +
        "<td class='neg'>" + pct(r.worst) + "</td>" +
        "<td class='pos'>" + pct(r.best) + "</td>";
      tbody.appendChild(tr);
    });
  }

  function renderTables() {
    var d = ds();
    fillTable($("bucket-table").tBodies[0], d.buckets, function (r) {
      return state.score >= r.lo && state.score <= r.hi;
    });
    fillTable($("cat-table").tBodies[0], d.categories, function (r) {
      return state.score >= r.lo && state.score <= r.hi;
    });
    $("table-sub").textContent = hzWord() + " 후 " + retWord() + " · " + rangeWord() +
      " · 표본은 거래일 수이며, 겹치는 기간을 감안한 독립 연수를 함께 적었습니다.";
  }

  /* --------------------------------------------------------- episodes */
  function renderEpisodes() {
    var lo = Math.floor(state.score / 10) * 10;
    var label = lo + "-" + (lo + 10);
    var list = (DATA.episodes || {})[label] || [];
    var host = $("episode-list");
    host.innerHTML = "";
    $("ep-sub").textContent = "지수 " + label + "점 구간에서 가장 나빴던 때와 가장 좋았던 때 · 1년 후 가격 수익률 기준";

    if (!list.length) {
      host.innerHTML = "<li><span class='ep-note'>이 구간에는 정리할 만한 사례가 없습니다.</span></li>";
      return;
    }
    var sorted = list.slice().sort(function (a, b) { return a.r - b.r; });
    var worstCut = sorted[Math.min(2, sorted.length - 1)].r;
    list.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (e) {
      var li = document.createElement("li");
      li.innerHTML =
        "<span class='ep-date'>" + e.d + "</span>" +
        "<span class='ep-score'>" + e.f.toFixed(0) + "점</span>" +
        "<span class='ep-note'>" + (e.r <= worstCut ? "이 구간 최악 국면" : "이 구간 최고 국면") + "</span>" +
        "<span class='ep-ret " + signClass(e.r) + "'>" + pct(e.r) + "</span>";
      host.appendChild(li);
    });
  }

  /* ------------------------------------------------------------ static */
  function renderStatic() {
    var m = DATA.meta;
    $("fact-obs").textContent = m.n_obs.toLocaleString("ko-KR") + "거래일";
    $("fact-range").textContent = m.start + " ~ " + m.end;
    $("fact-latest").textContent = m.latest_fng.toFixed(0) + " (" + catOf(m.latest_fng).name + ", " + m.latest_fng_date + ")";
    $("m-corr").textContent = "피어슨 " + m.calibration.pearson + " / 스피어만 " + m.calibration.spearman;
    $("m-index").textContent =
      "2011-01-03부터는 CNN이 실제로 발표한 값을 그대로 씁니다(" + m.n_cnn.toLocaleString("ko-KR") +
      "일). 그 이전 " + m.n_proxy.toLocaleString("ko-KR") + "일은 CNN의 7개 구성요소 중 가격·변동성으로 " +
      "복원 가능한 5개(50일·125일 이동평균 대비 위치, 52주 고점 대비 낙폭, 20일 등락률, VIX의 50일 평균 대비 수준)를 " +
      "각각 직전 3년 분포에서의 백분위로 바꿔 가중평균한 뒤, CNN 지수 분포에 맞춰 보정한 값입니다.";
    $("m-agg").textContent =
      "점수 한 칸마다 ±" + m.kernel_bw + "점 이웃을 가우시안 가중치로 묶어 평균·중앙값·분위수를 구합니다. " +
      "표 아래쪽 구간 통계는 가중치 없이 10점 단위로 단순 집계한 값입니다.";
    $("foot-sources").textContent = "데이터: " + m.sources.join(" · ") + " — " + m.generated + " 기준";
  }

  /* -------------------------------------------------------------- run */
  function renderAll() {
    ["opt-hz", "opt-ret", "opt-range"].forEach(function (id) {
      var host = $(id), items = id === "opt-hz" ? HZ : id === "opt-ret" ? RET : RANGE;
      var field = id === "opt-hz" ? "hz" : id === "opt-ret" ? "ret" : "range";
      Array.prototype.forEach.call(host.children, function (b, i) {
        b.setAttribute("aria-pressed", state[field] === items[i].id ? "true" : "false");
      });
    });
    renderVerdict();
    renderCurve();
    renderHist();
    renderScatter();
    renderTimeline();
    renderTables();
    renderEpisodes();
  }

  function init() {
    segment($("opt-hz"), HZ, "hz");
    segment($("opt-ret"), RET, "ret");
    segment($("opt-range"), RANGE, "range");
    buildPresets();
    renderStatic();

    $("score-number").addEventListener("input", function () {
      var v = parseFloat(this.value);
      if (isNaN(v)) return;
      setScore(v);
    });
    $("score-range").addEventListener("input", function () { setScore(parseFloat(this.value)); });

    var t = null;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(renderAll, 160);
    });

    setScore(Math.round(DATA.meta.latest_fng));
  }

  function boot() {
    var inline = document.getElementById("fng-data");
    if (inline) { DATA = JSON.parse(inline.textContent); init(); return; }
    fetch("data/fng_stats.json")
      .then(function (r) { return r.json(); })
      .then(function (j) { DATA = j; init(); })
      .catch(function () {
        document.querySelector(".verdict").innerHTML =
          "<p class='reading'>데이터 파일을 불러오지 못했습니다. <code>app/data/fng_stats.json</code>이 " +
          "같은 폴더에 있는지 확인하고, 로컬에서는 <code>python3 -m http.server</code>로 열어주세요.</p>";
      });
  }

  boot();
})();
