/* data.js — load the ETL dataset and expose typed accessors.
   Single source of truth: data is read from the GitHub repo's raw files, which
   the cloud Actions keep current (fuel-mix every 15 min, full ETL daily). The
   local dashboard and any hosted copy therefore show the same live data — no
   local ETL, cron, or copy to keep in sync. Append ?local to the URL to read
   the co-located files instead (for pipeline development). */
const RAW_BASE =
  "https://raw.githubusercontent.com/pftzgrld/ireland-power-dashboard/main/app";
const DATA_BASE =
  new URLSearchParams(location.search).has("local") ? "." : RAW_BASE;

const DATA = {
  raw: null,
  region: "ALL",            // active region: ALL | ROI | NI
  fuelLog: null,            // running fuel-mix history (may be empty)
  base: DATA_BASE,

  async load() {
    const res = await fetch(`${DATA_BASE}/data/dataset.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("dataset.json not reachable (offline?)");
    this.raw = await res.json();
    // backward-compat: old single-region shape had top-level `areas`
    if (this.raw.areas && !this.raw.regions) {
      this.raw = { meta: this.raw.meta, regions: { ALL: { areas: this.raw.areas } } };
    }
    // pick a sensible default region that actually has data
    const avail = this.regions();
    if (!avail.includes(this.region)) this.region = avail[0] || "ALL";
    // optional running fuel-mix log (sidecar; fine if absent)
    try {
      const r2 = await fetch(`${DATA_BASE}/data/fuelmix_log.json`, { cache: "no-store" });
      this.fuelLog = r2.ok ? await r2.json() : [];
    } catch (e) { this.fuelLog = []; }
    return this.raw;
  },

  meta() { return (this.raw && this.raw.meta) || {}; },
  regions() { return this.raw && this.raw.regions ? Object.keys(this.raw.regions) : ["ALL"]; },
  setRegion(r) { if (this.regions().includes(r)) this.region = r; },
  hasPrices() { return !!this.meta().has_prices; },

  _areas() {
    const reg = this.raw && this.raw.regions && this.raw.regions[this.region];
    return (reg && reg.areas) || {};
  },

  area(name) { return this._areas()[name] || { timestamps: [], series: {} }; },
  fields(name) { return Object.keys(this.area(name).series || {}); },

  series(area, field) {
    const a = this.area(area);
    return { t: a.timestamps || [], v: (a.series && a.series[field]) || [] };
  },

  firstSeries(area) {
    const f = this.fields(area);
    return f.length ? this.series(area, f[0]) : { t: [], v: [] };
  },

  matchSeries(area, ...needles) {
    const f = this.fields(area);
    const hit = f.find((name) =>
      needles.some((n) => name.toUpperCase().includes(n.toUpperCase())));
    return hit ? this.series(area, hit) : { t: [], v: [] };
  },

  latest(s) {
    for (let i = s.v.length - 1; i >= 0; i--) {
      if (s.v[i] != null) return { t: s.t[i], v: s.v[i] };
    }
    return { t: null, v: null };
  },

  /* Fuel-mix history for the active region -> {t:[], series:{fuel:[pct...]}}.
     Empty until the poller has logged ≥2 points. */
  fuelHistory() {
    const log = (this.fuelLog || []).filter((e) => e[this.region] &&
      Object.keys(e[this.region]).length);
    const fuels = new Set();
    log.forEach((e) => Object.keys(e[this.region]).forEach((f) => fuels.add(f)));
    const t = log.map((e) => e.t);
    const series = {};
    fuels.forEach((f) => { series[f] = log.map((e) => e[this.region][f] ?? null); });
    return { t, series, points: log.length };
  },
};
