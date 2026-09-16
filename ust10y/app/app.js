/* 국채금리 수익률 계산기
   app/data/ust10y_panel.json (또는 인라인 <script id="ust10y-data">)을 읽어
   입력 금리 주변의 과거 관측치를 모아 통계를 낸다. 라이브러리 없음. */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var HALO = "paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round";
  var DATA = null;
  var PANEL = [];
  var tip = document.getElementById("tooltip");

  var state = { rate: 4.6, asset: "stock", basis: "nom", win: 0.5, hz: "5", era: "e1953" };

  var ASSETS = [
    { id: "stock", tag: "s", label: "S&P 500", word: "S&P 500 주식", short: "주식" },
    { id: "bond", tag: "b", label: "10년 국채", word: "10년 국채", short: "국채" }
  ];
  var HZ = [
    { id: "1", label: "1년", word: "1년 후" },
    { id: "3", label: "3년", word: "3년 후" },
    { id: "5", label: "5년", word: "5년 후" }
  ];
  var BASIS = [
    { id: "nom", label: "명목", word: "명목" },
    { id: "real", label: "실질(물가조정)", word: "물가를 뺀 실질" }
  ];
  var WINDOWS = [
    { id: 0.25, label: "±0.25%p" },
    { id: 0.5, label: "±0.5%p" },
    { id: 1, label: "±1%p" }
  ];
  /* 기준 기간은 서로 포개진다: 1953년 이후 ⊃ 1980년 이후 ⊃ 2010년 이후 */
  var ERAS = [
    { id: "e1953", from: "1953-04", label: "1953년~", name: "1950년대 이후", segs: 3 },
    { id: "e1980", from: "1980-01", label: "1980년~", name: "1980년대 이후", segs: 2 },
    { id: "e2010", from: "2010-01", label: "2010년~", name: "2010년대 이후", segs: 1 }
  ];
  /* 그래프의 점 색은 겹치지 않는 세 구간으로 나눈다 */
  var SEGS = [
    { from: "1953-04", to: "1979-12", label: "1953–79", token: "--era-1" },
    { from: "1980-01", to: "2009-12", label: "1980–2009", token: "--era-2" },
    { from: "2010-01", to: "9999-99", label: "2010–", token: "--era-3" }
  ];
  var BUCKETS = [
    { lo: 0, hi: 2, label: "2% 미만" },
    { lo: 2, hi: 3, label: "2 – 3%" },
    { lo: 3, hi: 4, label: "3 – 4%" },
    { lo: 4, hi: 5, label: "4 – 5%" },
    { lo: 5, hi: 6, label: "5 – 6%" },
    { lo: 6, hi: 7, label: "6 – 7%" },
    { lo: 7, hi: 8, label: "7 – 8%" },
    { lo: 8, hi: 10, label: "8 – 10%" },
    { lo: 10, hi: 99, label: "10% 이상" }
  ];
  var PRESETS = [1, 2, 3, 4, 5, 6, 8, 10];

  /* ------------------------------------------------------------ utils */
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag), k;
    for (k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function pick(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  function minus(s) { return s.replace(/-/g, "−"); }

  function pct(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return "–";
    var d = digits === undefined ? 1 : digits;
    return minus((v > 0 ? "+" : "") + v.toFixed(d)) + "%";
  }

  function signClass(v) {
    if (v === null || v === undefined || isNaN(v)) return "";
    return v >= 0 ? "pos" : "neg";
  }

  /* 패널의 열 이름: 자산(s/b) + 기간(1/3/5) + 실질이면 r */
  function key(assetId, hz) {
    return pick(ASSETS, assetId).tag + hz + (state.basis === "real" ? "r" : "");
  }

  function monthKo(m) { return m.slice(0, 4) + "년 " + String(Number(m.slice(5))) + "월"; }

  function mean(a) {
    var s = 0, i;
    for (i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    if (sorted[base + 1] === undefined) return sorted[base];
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }

  /* 시작 금리가 test를 통과한 달들의 이후 수익률 통계 */
  function collect(eraFrom, assetId, hz, test) {
    var k = key(assetId, hz), vals = [], best = null, worst = null, i, row, v;
    for (i = 0; i < PANEL.length; i++) {
      row = PANEL[i];
      if (row.m < eraFrom) continue;
      v = row[k];
      if (v === undefined) continue;
      if (!test(row.y)) continue;
      vals.push(v);
      if (!best || v > best.v) best = { v: v, m: row.m };
      if (!worst || v < worst.v) worst = { v: v, m: row.m };
    }
    if (!vals.length) return { n: 0 };
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var up = 0;
    for (i = 0; i < vals.length; i++) if (vals[i] > 0) up++;
    return {
      n: vals.length,
      mean: mean(vals),
      median: quantile(sorted, 0.5),
      best: best,
      worst: worst,
      up: up / vals.length
    };
  }

  /* 입력 금리 ± 폭 */
  function stats(eraFrom, assetId, hz, rate, win) {
    return collect(eraFrom, assetId, hz, function (y) { return Math.abs(y - rate) <= win + 1e-9; });
  }

  /* 구간 [lo, hi) — 경계에 걸친 달이 두 줄에 겹쳐 세어지지 않게 한쪽만 닫는다 */
  function bucketStats(eraFrom, assetId, hz, lo, hi) {
    return collect(eraFrom, assetId, hz, function (y) { return y >= lo && y < hi; });
  }

  /* 표본이 몇 개의 연속된 국면에서 나왔는지 — 겹치는 관측치의 실체를 보여준다 */
  function runsOf(eraFrom, rate, win) {
    var runs = [], prev = -2, i, row;
    for (i = 0; i < PANEL.length; i++) {
      row = PANEL[i];
      if (row.m < eraFrom) continue;
      if (Math.abs(row.y - rate) > win + 1e-9) continue;
      if (i !== prev + 1) runs.push({ from: row.m, to: row.m, n: 0 });
      runs[runs.length - 1].to = row.m;
      runs[runs.length - 1].n++;
      prev = i;
    }
    return runs;
  }

  function correlation(assetId, hz, eraFrom) {
    var k = key(assetId, hz), xs = [], ys = [], i, row;
    for (i = 0; i < PANEL.length; i++) {
      row = PANEL[i];
      if (row.m < eraFrom || row[k] === undefined) continue;
      xs.push(row.y); ys.push(row[k]);
    }
    if (xs.length < 3) return null;
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0, dx, dy;
    for (i = 0; i < xs.length; i++) {
      dx = xs[i] - mx; dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return sxy / Math.sqrt(sxx * syy);
  }

  function overallMean(assetId, hz, eraFrom) {
    var k = key(assetId, hz), vals = [], i;
    for (i = 0; i < PANEL.length; i++) {
      if (PANEL[i].m >= eraFrom && PANEL[i][k] !== undefined) vals.push(PANEL[i][k]);
    }
    return vals.length ? mean(vals) : null;
  }

  /* ------------------------------------------------------------ chrome */
  function seg(host, items, current, onPick) {
    host.textContent = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      b.setAttribute("aria-pressed", String(it.id === current));
      b.addEventListener("click", function () { onPick(it.id); });
      host.appendChild(b);
    });
  }

  function buildControls() {
    seg($("opt-asset"), ASSETS, state.asset, function (id) { state.asset = id; render(); });
    seg($("opt-basis"), BASIS, state.basis, function (id) { state.basis = id; render(); });
    seg($("opt-window"), WINDOWS, state.win, function (id) { state.win = id; render(); });
    seg($("opt-hz"), HZ, state.hz, function (id) { state.hz = id; render(); });
    seg($("opt-era"), ERAS.map(function (e) { return { id: e.id, label: e.label }; }),
        state.era, function (id) { state.era = id; render(); });

    var host = $("presets");
    host.textContent = "";
    PRESETS.forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = r + "%";
      b.addEventListener("click", function () { setRate(r); });
      host.appendChild(b);
    });
    var now = document.createElement("button");
    now.type = "button";
    now.textContent = "최근 " + DATA.meta.latestRate.toFixed(2) + "%";
    now.addEventListener("click", function () { setRate(DATA.meta.latestRate); });
    host.appendChild(now);
  }

  function setRate(v) {
    v = Math.min(16, Math.max(0.5, Number(v)));
    if (isNaN(v)) return;
    state.rate = v;
    $("rate-number").value = v.toFixed(2);
    $("rate-range").value = v;
    render();
  }

  /* ------------------------------------------------------------ verdict */
  function levelChip(rate) {
    var below = 0, i;
    for (i = 0; i < PANEL.length; i++) if (PANEL[i].y < rate) below++;
    var share = Math.round(below / PANEL.length * 100);
    var word = rate < 2 ? "매우 낮음" : rate < 3.5 ? "낮음" : rate < 5 ? "보통"
             : rate < 7 ? "높은 편" : rate < 10 ? "높음" : "매우 높음";
    return word + " · 1953년 이후 " + share + "%가 이보다 낮았음";
  }

  function renderVerdict() {
    var hz = pick(HZ, state.hz), asset = pick(ASSETS, state.asset);
    var parts = ERAS.map(function (era) {
      var s = stats(era.from, state.asset, state.hz, state.rate, state.win);
      if (!s.n) return era.label + " 표본 없음";
      return era.label + " <span class=\"num " + signClass(s.mean) + "\">" + pct(s.mean) +
             "</span> <span class=\"num\">(" + s.n + "개월)</span>";
    });
    $("verdict").innerHTML =
      "금리 <strong class=\"num\">" + state.rate.toFixed(2) + "%</strong> 안팎(±" +
      state.win + "%p)에서 시작한 달의 <strong>" + hz.word + " " + asset.word + "</strong> " +
      pick(BASIS, state.basis).word + " 연평균 총수익률 — " + parts.join(", ") + ".";
  }

  /* -------------------------------------------------------------- eras */
  function other(assetId) { return assetId === "stock" ? "bond" : "stock"; }

  function renderEras() {
    var host = $("era-grid");
    host.textContent = "";
    var otherAsset = pick(ASSETS, other(state.asset));

    ERAS.forEach(function (era) {
      var card = document.createElement("article");
      card.className = "era";

      var head = document.createElement("div");
      head.className = "era-head";
      var sw = document.createElement("div");
      sw.className = "era-swatch";
      SEGS.slice(SEGS.length - era.segs).forEach(function (s) {
        var i = document.createElement("i");
        i.style.background = "var(" + s.token + ")";
        sw.appendChild(i);
      });
      head.appendChild(sw);
      var h3 = document.createElement("h3");
      h3.textContent = era.name;
      head.appendChild(h3);

      /* 표본이 몇 개의 국면에서 나왔는지를 카드마다 한 줄로 밝힌다 */
      var runs = runsOf(era.from, state.rate, state.win);
      var sub = document.createElement("div");
      sub.className = "era-sub";
      if (!runs.length) {
        sub.textContent = "이 금리대가 없었던 기간";
      } else {
        var years = [];
        runs.forEach(function (r) {
          var y = r.from.slice(0, 4);
          if (years[years.length - 1] !== y) years.push(y);
        });
        var shown = years.slice(0, 4).join(", ") + (years.length > 4 ? " …" : "");
        sub.textContent = runs.length + "개 국면 · " + shown + "년에 시작";
      }
      head.appendChild(sub);
      card.appendChild(head);

      var rows = document.createElement("div");
      rows.className = "hz-rows";
      HZ.forEach(function (h) {
        var s = stats(era.from, state.asset, h.id, state.rate, state.win);
        var o = stats(era.from, other(state.asset), h.id, state.rate, state.win);
        var row = document.createElement("div");
        row.className = "hz" + (s.n ? "" : " empty");

        var lab = document.createElement("div");
        lab.className = "hz-label";
        lab.textContent = h.word;
        row.appendChild(lab);

        var m = document.createElement("div");
        m.className = "hz-mean " + (s.n ? signClass(s.mean) : "");
        m.textContent = s.n ? pct(s.mean) : "표본 없음";
        row.appendChild(m);

        var m1 = document.createElement("div");
        m1.className = "hz-meta";
        var m2 = document.createElement("div");
        m2.className = "hz-meta";
        var m3 = document.createElement("div");
        m3.className = "hz-meta";
        if (s.n) {
          m1.textContent = "중앙값 " + pct(s.median) + " · 플러스 " +
                           Math.round(s.up * 100) + "% · " + s.n + "개월";
          m2.textContent = minus("최저 " + pct(s.worst.v) + " ~ 최고 " + pct(s.best.v));
          m3.textContent = o.n ? "같은 조건 " + otherAsset.short + " " + pct(o.mean) : "";
          m3.className = "hz-meta compare";
        } else {
          m1.textContent = "이 기간에 이 금리대가 없었습니다";
        }
        row.appendChild(m1);
        row.appendChild(m2);
        row.appendChild(m3);
        rows.appendChild(row);
      });
      card.appendChild(rows);
      host.appendChild(card);
    });
  }

  /* ------------------------------------------------------------- chart */
  function segOf(m) {
    for (var i = 0; i < SEGS.length; i++) if (m >= SEGS[i].from && m <= SEGS[i].to) return SEGS[i];
    return SEGS[SEGS.length - 1];
  }

  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.classList.add("on");
    var pad = 14;
    var x = evt.clientX + pad, y = evt.clientY - pad;
    var box = tip.getBoundingClientRect();
    if (x + box.width > window.innerWidth - 8) x = evt.clientX - box.width - pad;
    if (y < 8) y = evt.clientY + pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() { tip.classList.remove("on"); }

  function renderLegend() {
    var host = $("legend");
    host.textContent = "";
    SEGS.forEach(function (s) {
      var span = document.createElement("span");
      var dot = document.createElement("i");
      dot.style.background = "var(" + s.token + ")";
      span.appendChild(dot);
      span.appendChild(document.createTextNode(s.label + " 시작"));
      host.appendChild(span);
    });
  }

  /* 눈금 간격: 값의 폭에 맞춰 6~10개 선이 되도록 고른다 */
  function tickStep(range) {
    var steps = [1, 2, 5, 10, 20, 25], i;
    for (i = 0; i < steps.length; i++) if (range / steps[i] <= 9) return steps[i];
    return 50;
  }

  function renderChart() {
    var shell = $("chart");
    shell.textContent = "";
    var k = key(state.asset, state.hz);
    var hz = pick(HZ, state.hz), asset = pick(ASSETS, state.asset);

    var pts = [], i;
    for (i = 0; i < PANEL.length; i++) if (PANEL[i][k] !== undefined) pts.push(PANEL[i]);

    var w = shell.clientWidth || 820;
    var h = w < 560 ? 300 : 360;
    var padL = 52, padR = 18, padT = 14, padB = 44;
    var pw = w - padL - padR, ph = h - padT - padB;

    var svg = el("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h,
                          role: "img", "aria-label":
                          "시작 금리와 " + hz.word + " " + asset.word + " 연평균 수익률 산점도" },
                 shell);

    var xMax = 16, yLo = 0, yHi = 0;
    pts.forEach(function (p) {
      if (p[k] < yLo) yLo = p[k];
      if (p[k] > yHi) yHi = p[k];
    });
    var step = tickStep(yHi - yLo);
    yLo = Math.floor((yLo - step / 2) / step) * step;
    yHi = Math.ceil((yHi + step / 2) / step) * step;

    function X(v) { return padL + v / xMax * pw; }
    function Y(v) { return padT + (yHi - v) / (yHi - yLo) * ph; }

    /* 입력 금리 밴드 */
    var bx1 = X(Math.max(0, state.rate - state.win));
    var bx2 = X(Math.min(xMax, state.rate + state.win));
    el("rect", { x: bx1, y: padT, width: Math.max(2, bx2 - bx1), height: ph,
                 style: "fill:var(--band)" }, svg);

    /* 가로 격자 */
    for (var t = yLo; t <= yHi + 1e-9; t += step) {
      var strong = Math.abs(t) < 1e-9;
      el("line", { x1: padL, y1: Y(t), x2: padL + pw, y2: Y(t),
                   style: "stroke:var(" + (strong ? "--axis" : "--grid") + ");stroke-width:1" }, svg);
      el("text", { x: padL - 8, y: Y(t) + 4, "text-anchor": "end",
                   style: "fill:var(--muted);font-size:11px;font-family:'IBM Plex Mono',monospace" }, svg)
        .appendChild(document.createTextNode(minus(t + "%")));
    }
    /* 세로 눈금 */
    for (var xv = 0; xv <= xMax; xv += 2) {
      el("line", { x1: X(xv), y1: padT, x2: X(xv), y2: padT + ph,
                   style: "stroke:var(--grid);stroke-width:1" }, svg);
      el("text", { x: X(xv), y: padT + ph + 18, "text-anchor": "middle",
                   style: "fill:var(--muted);font-size:11px;font-family:'IBM Plex Mono',monospace" }, svg)
        .appendChild(document.createTextNode(xv + "%"));
    }
    el("text", { x: padL + pw, y: padT + ph + 36, "text-anchor": "end",
                 style: "fill:var(--muted);font-size:11.5px" }, svg)
      .appendChild(document.createTextNode("→ 시작 시점의 10년 국채금리"));

    if (state.asset === "bond" && state.basis === "nom") {
      /* 국채: 만기까지 들고 있었다면 받았을 수익률 = 시작 금리 */
      var dLo = Math.max(yLo, 0), dHi = Math.min(yHi, xMax);
      el("line", { x1: X(dLo), y1: Y(dLo), x2: X(dHi), y2: Y(dHi),
                   style: "stroke:var(--axis);stroke-width:1.5;stroke-dasharray:4 4" }, svg);
      el("text", { x: X(dHi) - 6, y: Y(dHi) - 8, "text-anchor": "end",
                   style: "fill:var(--muted);font-size:11.5px;" + HALO }, svg)
        .appendChild(document.createTextNode("수익률 = 시작 금리"));
    } else {
      /* 주식: 금리와 무관한 기준선 — 전 기간 평균 */
      var avg = overallMean(state.asset, state.hz, ERAS[0].from);
      if (avg !== null) {
        el("line", { x1: padL, y1: Y(avg), x2: padL + pw, y2: Y(avg),
                     style: "stroke:var(--axis);stroke-width:1.5;stroke-dasharray:4 4" }, svg);
        el("text", { x: padL + pw - 6, y: Y(avg) - 8, "text-anchor": "end",
                     style: "fill:var(--muted);font-size:11.5px;" + HALO }, svg)
          .appendChild(document.createTextNode("금리를 안 보고 늘 보유했다면 " + pct(avg)));
      }
    }

    /* 점: 한 달에 하나 */
    pts.forEach(function (p) {
      var s = segOf(p.m);
      el("circle", { cx: X(p.y), cy: Y(p[k]), r: 2.9,
                     style: "fill:var(" + s.token + ");fill-opacity:.58;" +
                            "stroke:var(--surface);stroke-width:.6" }, svg);
    });

    /* 밴드 안 평균 (1953년 이후 전체) */
    var all = stats(ERAS[0].from, state.asset, state.hz, state.rate, state.win);
    if (all.n) {
      el("line", { x1: bx1 - 6, y1: Y(all.mean), x2: bx2 + 6, y2: Y(all.mean),
                   style: "stroke:var(--ink);stroke-width:2" }, svg);
      var lx = bx2 + 10, anchor = "start";
      if (lx > padL + pw - 110) { lx = bx1 - 10; anchor = "end"; }
      el("text", { x: lx, y: Y(all.mean) - 7, "text-anchor": anchor,
                   style: "fill:var(--ink);font-size:11.5px;font-weight:600;" + HALO }, svg)
        .appendChild(document.createTextNode("1953년 이후 평균 " + pct(all.mean)));
    }

    /* 호버 */
    var hit = el("rect", { x: padL, y: padT, width: pw, height: ph, style: "fill:transparent" }, svg);
    var ring = el("circle", { r: 5.5, style: "fill:none;stroke:var(--ink);stroke-width:1.6;opacity:0" }, svg);
    hit.addEventListener("mousemove", function (evt) {
      var box = svg.getBoundingClientRect();
      var sx = (evt.clientX - box.left) / box.width * w;
      var sy = (evt.clientY - box.top) / box.height * h;
      var best = null, bd = Infinity;
      pts.forEach(function (p) {
        var dx = X(p.y) - sx, dy = Y(p[k]) - sy, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      });
      if (!best || bd > 400) { ring.style.opacity = 0; hideTip(); return; }
      ring.setAttribute("cx", X(best.y));
      ring.setAttribute("cy", Y(best[k]));
      ring.style.opacity = 1;
      showTip(evt, monthKo(best.m) + " 시작 · 금리 " + best.y.toFixed(2) + "%<br>" +
                   hz.word + " " + asset.short + " 연평균 " + pct(best[k]));
    });
    hit.addEventListener("mouseleave", function () { ring.style.opacity = 0; hideTip(); });

    var r = correlation(state.asset, state.hz, ERAS[0].from);
    var strength = r === null ? "" :
      Math.abs(r) < 0.25 ? " — 거의 관계가 없습니다"
      : Math.abs(r) < 0.6 ? " — 약한 관계입니다" : " — 뚜렷한 관계입니다";
    $("chart-note").textContent =
      "점 하나가 시작한 달 하나입니다. " + pts.length + "개월 · " +
      "시작 금리와 " + hz.word + " " + asset.short + " 수익률의 상관계수 " +
      (r === null ? "–" : minus(r.toFixed(2))) + strength + ".";
  }

  /* -------------------------------------------------------------- table */
  function renderTable() {
    var era = pick(ERAS, state.era);
    var body = $("bucket-table").querySelector("tbody");
    body.textContent = "";

    BUCKETS.forEach(function (b) {
      var cells = HZ.map(function (h) { return bucketStats(era.from, state.asset, h.id, b.lo, b.hi); });
      var five = cells[2];
      var tr = document.createElement("tr");
      if (state.rate >= b.lo && state.rate < b.hi) tr.className = "here";

      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = b.label;
      tr.appendChild(th);

      var n = document.createElement("td");
      n.className = "num dim";
      n.textContent = five.n ? five.n + "개월" : "–";
      tr.appendChild(n);

      cells.forEach(function (s) {
        var td = document.createElement("td");
        td.className = "num " + (s.n ? signClass(s.mean) : "dim");
        td.textContent = s.n ? pct(s.mean) : "–";
        tr.appendChild(td);
      });

      var up = document.createElement("td");
      up.className = "num dim";
      up.textContent = five.n ? Math.round(five.up * 100) + "%" : "–";
      tr.appendChild(up);

      body.appendChild(tr);
    });

    $("bucket-caption").textContent =
      era.name + " (" + era.from.replace("-", ".") + " – " +
      DATA.meta.last.replace("-", ".") + ") · " + pick(ASSETS, state.asset).word +
      " · " + pick(BASIS, state.basis).word +
      " 연평균 총수익률 · 표본은 5년 수익률을 알 수 있는 달 수";
  }

  /* ------------------------------------------------------------- render */
  function render() {
    buildControls();
    document.documentElement.setAttribute("data-asset", state.asset);
    $("rate-cat").textContent = levelChip(state.rate);
    renderVerdict();
    renderEras();
    renderLegend();
    renderChart();
    renderTable();
  }

  function boot(data) {
    DATA = data;
    PANEL = data.panel;
    state.rate = data.meta.latestRate;

    $("fact-obs").textContent = data.meta.count.toLocaleString("ko-KR") + "개월";
    $("fact-range").textContent = data.meta.first.replace("-", ".") + " – " +
                                  data.meta.last.replace("-", ".");
    $("fact-latest").textContent = data.meta.latestRate.toFixed(2) + "% (" +
                                   monthKo(data.meta.last) + ")";

    var num = $("rate-number"), rng = $("rate-range");
    num.value = state.rate.toFixed(2);
    rng.value = state.rate;
    num.addEventListener("input", function () {
      var v = Number(num.value);
      if (num.value === "" || isNaN(v)) return;
      state.rate = Math.min(16, Math.max(0.5, v));
      rng.value = state.rate;
      render();
    });
    num.addEventListener("blur", function () { setRate(Number(num.value) || state.rate); });
    rng.addEventListener("input", function () {
      state.rate = Number(rng.value);
      num.value = state.rate.toFixed(2);
      render();
    });

    var timer = null;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(renderChart, 150);
    });

    render();
  }

  var inline = document.getElementById("ust10y-data");
  if (inline) {
    boot(JSON.parse(inline.textContent));
  } else {
    fetch("data/ust10y_panel.json")
      .then(function (r) { return r.json(); })
      .then(boot)
      .catch(function () {
        $("verdict").textContent =
          "데이터를 불러오지 못했습니다. 로컬 서버로 열어 주세요: python3 -m http.server";
      });
  }
})();
