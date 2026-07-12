/* charts.js — ECharts panels. Theme-aware via CSS variables. */
const CHARTS = {};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function baseGrid() {
  return { left: 48, right: 16, top: 24, bottom: 44 };
}

function timeAxis() {
  return {
    type: "time",
    axisLine: { lineStyle: { color: cssVar("--line") } },
    axisLabel: { color: cssVar("--muted"), fontSize: 11 },
    splitLine: { show: false },
  };
}

function valueAxis(name) {
  return {
    type: "value",
    name: name || "",
    nameTextStyle: { color: cssVar("--muted"), fontSize: 10 },
    axisLabel: { color: cssVar("--muted"), fontSize: 11 },
    axisLine: { show: false },
    splitLine: { lineStyle: { color: cssVar("--line"), opacity: 0.5 } },
  };
}

function tooltip(extra) {
  return Object.assign({
    trigger: "axis",
    backgroundColor: cssVar("--panel-2"),
    borderColor: cssVar("--line"),
    textStyle: { color: cssVar("--text"), fontSize: 12 },
  }, extra || {});
}

function pair(s) { return s.t.map((t, i) => [t, s.v[i]]); }

function mount(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (CHARTS[id]) { CHARTS[id].dispose(); }
  const c = echarts.init(el, null, { renderer: "canvas" });
  CHARTS[id] = c;
  return c;
}

const RENDER = {
  genmix() {
    const c = mount("c-genmix"); if (!c) return;
    const g = M.genStack();
    const mk = (name, data, color) => ({
      name, type: "line", stack: "gen", areaStyle: { opacity: 0.85 },
      lineStyle: { width: 0 }, symbol: "none", color,
      data: g.t.map((t, i) => [t, data[i]]),
    });
    c.setOption({
      grid: baseGrid(),
      legend: { top: 0, textStyle: { color: cssVar("--muted"), fontSize: 11 }, right: 8 },
      tooltip: tooltip(),
      xAxis: timeAxis(),
      yAxis: valueAxis("MW"),
      series: [
        mk("Wind (observed)", g.wind, cssVar("--wind")),
        mk("Net import (observed)", g.imports, cssVar("--import")),
        mk("Thermal & other (derived)", g.thermal, cssVar("--gas")),
      ],
    });
  },

  windDemand() {
    const c = mount("c-wind-demand"); if (!c) return;
    c.setOption({
      grid: baseGrid(),
      legend: { top: 0, right: 8, textStyle: { color: cssVar("--muted"), fontSize: 11 } },
      tooltip: tooltip(),
      xAxis: timeAxis(),
      yAxis: valueAxis("MW"),
      series: [
        { name: "Demand", type: "line", symbol: "none", color: cssVar("--muted"),
          lineStyle: { width: 1.5 }, data: pair(M.demand()) },
        { name: "Wind", type: "line", symbol: "none", color: cssVar("--wind"),
          areaStyle: { opacity: 0.25 }, lineStyle: { width: 1.5 }, data: pair(M.wind()) },
      ],
    });
  },

  snsp() {
    const c = mount("c-snsp"); if (!c) return;
    c.setOption({
      grid: baseGrid(),
      tooltip: tooltip(),
      xAxis: timeAxis(),
      yAxis: Object.assign(valueAxis("%"), { max: 100 }),
      series: [{
        name: "SNSP", type: "line", symbol: "none", color: cssVar("--accent-2"),
        areaStyle: { opacity: 0.2 }, lineStyle: { width: 1.5 }, data: pair(M.snsp()),
        markLine: {
          silent: true, symbol: "none",
          lineStyle: { color: cssVar("--warn"), type: "dashed" },
          data: [{ yAxis: 75, label: { formatter: "75% op. limit", color: cssVar("--warn"), fontSize: 10 } }],
        },
      }],
    });
  },

  fuelDonut() {
    const c = mount("c-fuel-donut"); if (!c) return;
    const data = M.fuelSnapshot();
    document.getElementById("fuelmix-time").textContent = "latest snapshot · % share";
    c.setOption({
      tooltip: { trigger: "item", backgroundColor: cssVar("--panel-2"),
        borderColor: cssVar("--line"), textStyle: { color: cssVar("--text") },
        formatter: "{b}: {d}%" },
      legend: { bottom: 0, textStyle: { color: cssVar("--muted"), fontSize: 11 } },
      series: [{
        type: "pie", radius: ["45%", "70%"], center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: cssVar("--panel"), borderWidth: 2 },
        label: { color: cssVar("--text"), fontSize: 11 },
        data: data.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.color } })),
      }],
    });
  },

  fuelArea() {
    const c = mount("c-fuel-area"); if (!c) return;
    const hist = DATA.fuelHistory();
    const areaTag = document.querySelector('#c-fuel-area')
      .closest(".card").querySelector(".tag");

    // Prefer the logged fuel-mix history (true gas/coal split) once the poller
    // has ≥2 points; otherwise fall back to the derived wind/import/thermal stack.
    if (hist.points >= 2) {
      const colorFor = {
        Gas: cssVar("--gas"), Renewables: cssVar("--wind"),
        "Net import": cssVar("--import"), "Other fossil": cssVar("--oil"),
        Coal: cssVar("--coal"),
      };
      const fuels = Object.keys(hist.series);
      if (areaTag) areaTag.textContent = `% share · logged (${hist.points} pts)`;
      c.setOption({
        grid: baseGrid(),
        legend: { top: 0, right: 8, textStyle: { color: cssVar("--muted"), fontSize: 11 } },
        tooltip: tooltip(),
        xAxis: timeAxis(),
        yAxis: Object.assign(valueAxis("%"), { max: 100 }),
        series: fuels.map((f) => ({
          name: f, type: "line", stack: "s", areaStyle: { opacity: 0.85 },
          lineStyle: { width: 0 }, symbol: "none",
          color: colorFor[f] || cssVar("--muted"),
          data: hist.t.map((t, i) => [t, hist.series[f][i]]),
        })),
      });
      return;
    }
    if (areaTag) areaTag.textContent = "% share · derived (awaiting log)";
    const g = M.genStack();
    const totals = g.t.map((_, i) =>
      (g.wind[i] || 0) + (g.imports[i] || 0) + (g.thermal[i] || 0));
    const pct = (arr) => g.t.map((t, i) =>
      [t, totals[i] ? +((arr[i] || 0) / totals[i] * 100).toFixed(1) : null]);
    const mk = (name, data, color) => ({
      name, type: "line", stack: "s", areaStyle: { opacity: 0.85 },
      lineStyle: { width: 0 }, symbol: "none", color, data,
    });
    c.setOption({
      grid: baseGrid(),
      legend: { top: 0, right: 8, textStyle: { color: cssVar("--muted"), fontSize: 11 } },
      tooltip: tooltip(),
      xAxis: timeAxis(),
      yAxis: Object.assign(valueAxis("%"), { max: 100 }),
      series: [
        mk("Wind", pct(g.wind), cssVar("--wind")),
        mk("Net import", pct(g.imports), cssVar("--import")),
        mk("Thermal & other", pct(g.thermal), cssVar("--gas")),
      ],
    });
  },

  wind() {
    const c = mount("c-wind"); if (!c) return;
    c.setOption({
      grid: baseGrid(), tooltip: tooltip(), xAxis: timeAxis(), yAxis: valueAxis("MW"),
      dataZoom: [{ type: "inside" }],
      series: [{ name: "Wind", type: "line", symbol: "none", color: cssVar("--wind"),
        areaStyle: { opacity: 0.3 }, lineStyle: { width: 1.5 }, data: pair(M.wind()) }],
    });
  },

  windShare() {
    const c = mount("c-wind-share"); if (!c) return;
    c.setOption({
      grid: baseGrid(), tooltip: tooltip(), xAxis: timeAxis(),
      yAxis: Object.assign(valueAxis("%"), { max: 100 }),
      series: [{ name: "Wind share", type: "line", symbol: "none", color: cssVar("--accent"),
        areaStyle: { opacity: 0.2 }, lineStyle: { width: 1.5 }, data: pair(M.windShare()) }],
    });
  },

  co2int() {
    const c = mount("c-co2-int"); if (!c) return;
    c.setOption({
      grid: baseGrid(), tooltip: tooltip(), xAxis: timeAxis(),
      yAxis: valueAxis("gCO₂/kWh"), dataZoom: [{ type: "inside" }],
      series: [{ name: "CO₂ intensity", type: "line", symbol: "none", color: cssVar("--carbon"),
        areaStyle: { opacity: 0.2 }, lineStyle: { width: 1.5 }, data: pair(M.co2int()) }],
    });
  },

  co2em() {
    const c = mount("c-co2-em"); if (!c) return;
    c.setOption({
      grid: baseGrid(), tooltip: tooltip(), xAxis: timeAxis(),
      yAxis: valueAxis("tCO₂/hr"), dataZoom: [{ type: "inside" }],
      series: [{ name: "CO₂ emissions", type: "line", symbol: "none", color: cssVar("--carbon"),
        lineStyle: { width: 1.5 }, data: pair(M.co2em()) }],
    });
  },

  flows() {
    const c = mount("c-flows"); if (!c) return;
    const ics = M.interconnectors();
    const series = ics.map((ic, i) => {
      const s = {
        name: ic.label, type: "line", symbol: "none", color: ic.color,
        lineStyle: { width: 1.3 }, data: pair(ic.s),
      };
      if (i === 0) {
        s.markLine = { silent: true, symbol: "none",
          label: { show: false },
          lineStyle: { color: cssVar("--muted"), type: "dashed", opacity: 0.6 },
          data: [{ yAxis: 0 }] };
      }
      return s;
    });
    c.setOption({
      grid: baseGrid(),
      legend: { top: 0, right: 8, data: ics.map((ic) => ic.label),
        textStyle: { color: cssVar("--muted"), fontSize: 11 } },
      tooltip: tooltip(), xAxis: timeAxis(), yAxis: valueAxis("MW"),
      series,
    });
  },

  price() {
    const note = document.getElementById("price-note");
    const p = DATA.series("prices", "DAY_AHEAD_EUR_MWH");
    const el = document.getElementById("c-price");
    if (!p.v.length) {
      if (CHARTS["c-price"]) { CHARTS["c-price"].dispose(); delete CHARTS["c-price"]; }
      if (el) {
        el.innerHTML = '<div style="height:100%;display:flex;align-items:center;'
          + 'justify-content:center;padding:0 24px;"><div style="text-align:center;'
          + 'color:var(--muted);font-size:13px;max-width:520px;">Wholesale price '
          + 'panel is dark.<br>Set a free <code>ENTSOE_TOKEN</code> and re-run the '
          + 'ETL to enable it (see the Methodology tab).</div></div>';
      }
      note.textContent = "Day-ahead SEM prices come from the ENTSO-E Transparency Platform (free token).";
      return;
    }
    const c = mount("c-price"); if (!c) return;
    note.textContent = "SEM day-ahead auction, hourly. Source: ENTSO-E Transparency Platform.";
    c.setOption({
      grid: baseGrid(), tooltip: tooltip(), xAxis: timeAxis(),
      yAxis: valueAxis("€/MWh"),
      series: [{ name: "Day-ahead", type: "line", symbol: "none", step: "end",
        color: cssVar("--accent-2"), lineStyle: { width: 1.5 }, data: pair(p) }],
    });
  },

  capture() {
    const el = document.getElementById("c-capture");
    const tiles = document.getElementById("capture-tiles");
    const note = document.getElementById("capture-note");
    const cap = M.capture();

    if (!cap) {
      if (CHARTS["c-capture"]) { CHARTS["c-capture"].dispose(); delete CHARTS["c-capture"]; }
      if (tiles) tiles.innerHTML = "";
      if (el) el.innerHTML = '<div style="height:100%;display:flex;align-items:center;'
        + 'justify-content:center;padding:0 24px;"><div style="text-align:center;'
        + 'color:var(--muted);font-size:13px;max-width:560px;">Needs wholesale price '
        + 'data.<br>This lights up automatically once <code>ENTSOE_TOKEN</code> is set '
        + 'and the ETL has run — capture price, baseload, and capture rate for wind on '
        + 'the active region.</div></div>';
      if (note) note.textContent = "Capture rate = revenue-weighted wind price ÷ time-weighted (baseload) price. Below 100% = cannibalisation.";
      return;
    }

    if (tiles) {
      tiles.innerHTML = [
        { k: "Capture price", v: "€" + cap.capturePrice.toFixed(1), u: "/MWh" },
        { k: "Baseload price", v: "€" + cap.baseload.toFixed(1), u: "/MWh" },
        { k: "Capture rate", v: cap.captureRate.toFixed(0), u: "%",
          sub: cap.captureRate < 100 ? "cannibalisation" : "premium" },
      ].map((t) => `<div class="tile"><div class="k">${t.k}</div>
        <div class="v">${t.v}<span class="u">${t.u}</span></div>
        ${t.sub ? `<div class="sub2">${t.sub}</div>` : ""}</div>`).join("");
    }
    const c = mount("c-capture"); if (!c) return;
    c.setOption({
      grid: { left: 52, right: 56, top: 24, bottom: 40 },
      legend: { top: 0, right: 8, textStyle: { color: cssVar("--muted"), fontSize: 11 } },
      tooltip: tooltip(),
      xAxis: timeAxis(),
      yAxis: [
        Object.assign(valueAxis("MW"), { position: "left" }),
        Object.assign(valueAxis("€/MWh"), { position: "right", splitLine: { show: false } }),
      ],
      series: [
        { name: "Wind", type: "line", symbol: "none", yAxisIndex: 0,
          color: cssVar("--wind"), areaStyle: { opacity: 0.2 }, lineStyle: { width: 1 },
          data: cap.chart.t.map((t, i) => [t, cap.chart.wind[i]]) },
        { name: "Price", type: "line", symbol: "none", yAxisIndex: 1, step: "end",
          color: cssVar("--accent-2"), lineStyle: { width: 1.3 },
          data: cap.chart.t.map((t, i) => [t, cap.chart.price[i]]) },
      ],
    });
    if (note) note.textContent =
      `Wind earns €${cap.capturePrice.toFixed(1)}/MWh vs €${cap.baseload.toFixed(1)} baseload `
      + `— a ${cap.captureRate.toFixed(0)}% capture rate over ${cap.points} intervals.`;
  },
};

function renderAll() {
  Object.values(RENDER).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
}

window.addEventListener("resize", () => {
  Object.values(CHARTS).forEach((c) => c && c.resize());
});
