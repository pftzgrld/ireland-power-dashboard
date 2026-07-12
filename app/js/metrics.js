/* metrics.js — derived quantities. Observed inputs, labelled derivations. */
const M = {
  demand() { return DATA.series("demandactual", "SYSTEM_DEMAND"); },
  wind() { return DATA.series("windactual", "WIND_ACTUAL"); },
  // Net-import field is region-specific: INTER_NET (all), INTER_NET_ROI, INTER_NET_NI
  netImport() { return DATA.matchSeries("interconnection", "INTER_NET"); },
  snsp() { return DATA.series("SnspALL", "SNSP_ALL"); },
  co2int() { return DATA.series("co2intensity", "CO2_INTENSITY"); },
  co2em() { return DATA.series("co2emission", "CO2_EMISSIONS"); },

  interconnectors() {
    return [
      { key: "INTER_EWIC", label: "East-West (GB)", color: "#58a6ff" },
      { key: "INTER_MOYLE", label: "Moyle (Scotland)", color: "#8957e5" },
      { key: "INTER_GRNLK", label: "Greenlink (Wales)", color: "#e3873b" },
    ].map((ic) => ({ ...ic, s: DATA.series("interconnection", ic.key) }));
  },

  /* Current fuel-mix snapshot -> [{name, value, color}] (MW-equivalent). */
  fuelSnapshot() {
    const map = [
      { f: "FUEL_GAS", name: "Gas", color: "#e3873b" },
      { f: "FUEL_RENEW", name: "Renewables", color: "#35c46b" },
      { f: "FUEL_NET_IMPORT", name: "Net import", color: "#58a6ff" },
      { f: "FUEL_OTHER_FOSSIL", name: "Other fossil", color: "#b05fd6" },
      { f: "FUEL_COAL", name: "Coal", color: "#6b7076" },
    ];
    const a = DATA.area("fuelmix");
    const out = [];
    map.forEach((m) => {
      const arr = (a.series && a.series[m.f]) || [];
      const v = arr.length ? arr[arr.length - 1] : null;
      if (v != null && v > 0) out.push({ name: m.name, value: +v.toFixed(0), color: m.color });
    });
    return out;
  },

  /* Derived generation stack aligned to demand axis.
     Wind + net import are observed; "thermal & other" is the residual
     (demand − wind − net import), i.e. dispatchable + non-wind renewables. */
  genStack() {
    const d = this.demand(), w = this.wind(), imp = this.netImport();
    const idx = {};
    d.t.forEach((t, i) => (idx[t] = { demand: d.v[i] }));
    w.t.forEach((t, i) => { if (idx[t]) idx[t].wind = w.v[i]; });
    imp.t.forEach((t, i) => { if (idx[t]) idx[t].imp = imp.v[i]; });
    const t = d.t;
    const wind = [], imports = [], thermal = [];
    t.forEach((ts) => {
      const r = idx[ts] || {};
      const dm = r.demand ?? null, wd = r.wind ?? 0, im = r.imp ?? 0;
      wind.push(wd);
      imports.push(im > 0 ? im : 0);          // only imports add supply
      thermal.push(dm == null ? null : Math.max(dm - wd - (im > 0 ? im : 0), 0));
    });
    return { t, wind, imports, thermal };
  },

  /* Wind share of demand, % over time. */
  windShare() {
    const w = this.wind(), d = this.demand();
    const dmap = {};
    d.t.forEach((t, i) => (dmap[t] = d.v[i]));
    const v = w.t.map((t, i) => {
      const dm = dmap[t];
      if (dm == null || !dm || w.v[i] == null) return null;
      return +((w.v[i] / dm) * 100).toFixed(1);
    });
    return { t: w.t, v };
  },

  price() { return DATA.series("prices", "DAY_AHEAD_EUR_MWH"); },
  solar() { return DATA.series("gen_by_type", "SOLAR"); },

  /* Wind capture analysis. Revenue-weighted price wind actually earns vs the
     time-weighted (baseload) average. Capture rate < 100% = cannibalisation.
     Returns null until price data exists. Price is hourly; wind is 15-min, so
     wind is matched to the price hour it falls in. */
  capture() {
    const p = this.price(), w = this.wind();
    if (!p.v.length || !w.v.length) return null;
    const priceByHour = {};
    p.t.forEach((t, i) => {
      if (p.v[i] != null) priceByHour[t.slice(0, 13)] = p.v[i]; // YYYY-MM-DDTHH
    });
    let revenue = 0, energy = 0, n = 0;
    const chart = { t: [], wind: [], price: [] };
    w.t.forEach((t, i) => {
      const pr = priceByHour[t.slice(0, 13)];
      const wd = w.v[i];
      if (pr == null || wd == null) return;
      revenue += wd * pr;
      energy += wd;
      n++;
      chart.t.push(t);
      chart.wind.push(wd);
      chart.price.push(pr);
    });
    if (!energy) return null;
    const prices = Object.values(priceByHour);
    const baseload = prices.reduce((a, b) => a + b, 0) / prices.length;
    const capturePrice = revenue / energy;
    return {
      capturePrice,
      baseload,
      captureRate: baseload ? (capturePrice / baseload) * 100 : null,
      points: n,
      chart,
    };
  },

  /* Headline tiles for the overview. */
  tiles() {
    const dl = DATA.latest(this.demand());
    const wl = DATA.latest(this.wind());
    const sl = DATA.latest(this.snsp());
    const cl = DATA.latest(this.co2int());
    const il = DATA.latest(this.netImport());
    const share = (wl.v != null && dl.v) ? (wl.v / dl.v) * 100 : null;
    return [
      { k: "System demand", v: fmt(dl.v), u: "MW" },
      { k: "Wind output", v: fmt(wl.v), u: "MW" },
      { k: "Wind share", v: share == null ? "—" : share.toFixed(0), u: "%" },
      { k: "SNSP", v: fmt(sl.v, 0), u: "%", sub: "non-synchronous" },
      { k: "CO₂ intensity", v: fmt(cl.v), u: "g/kWh" },
      { k: "Net import", v: fmt(il.v), u: "MW", sub: il.v >= 0 ? "importing" : "exporting" },
    ];
  },
};

function fmt(v, dp = 0) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-IE", { maximumFractionDigits: dp });
}
