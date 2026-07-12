# Ireland Power — All-Island Grid Terminal

A real-data market-intelligence dashboard for the all-island (SEM) power system,
in the style of a commodity-analytics terminal. Modelled on
[gb-power-dashboard](https://github.com/lptva/gb-power-dashboard), rebuilt for
Ireland on EirGrid + ENTSO-E data.

Static single-page app, no build step. A Python-stdlib ETL fetches observed data
and writes columnar JSON; the frontend renders it with vendored ECharts.

## What it shows

A header toggle switches every panel between **All-island / ROI / NI**.

- **Overview** — headline tiles (demand, wind, wind share, SNSP, CO₂, net
  import), derived generation stack, wind-vs-demand, SNSP against the 75% limit.
- **Fuel Mix** — live fuel-mix donut (gas / renewables / imports / other fossil /
  coal) and the mix share over time (from the running log once it has ≥2 points).
- **Renewables** — wind output and wind share of demand.
- **Carbon** — CO₂ intensity and emissions rate.
- **Flows & Prices** — per-interconnector flows (East-West, Moyle, Greenlink),
  the SEM day-ahead wholesale price, and **wind capture price** (capture rate vs
  baseload — the merchant cannibalisation view). Price + capture need a free
  ENTSO-E token.
- **Methodology** — full provenance; observed vs derived is labelled throughout.

## Fuel-mix running log

EirGrid's fuel-mix feed has no history. `ops/poll_fuelmix.sh` (installed in cron,
every 30 min) appends each snapshot's shares to `app/data/fuelmix_log.json`, so
the mix-over-time panel builds real history you own.

## Run it

```bash
# 1. fetch data (30 days of 15-minute observations)
python3 etl/build_dataset.py --days 30

# 2. serve the app (file:// will NOT work — the app fetches JSON)
cd app && python3 -m http.server 8000
# open http://localhost:8000
```

Refresh incrementally (re-fetches the last 2 days, runs in seconds):

```bash
python3 etl/build_dataset.py --incremental
```

Optional daily refresh: `ops/refresh.sh` (wire into cron/launchd).

## Data & provenance

All figures are observed grid-operator data or clearly-labelled derivations —
see [methodology.md](app/methodology.md). The EirGrid feed is public and tokenless;
wholesale prices need a free ENTSO-E token (instructions in the methodology).

## Dependencies

- **ETL:** Python 3.9+, standard library only, plus `certifi` (for TLS on macOS).
- **Frontend:** none — ECharts is vendored in `app/js/vendor/`.

## Layout

```
etl/build_dataset.py   fetch + normalise + write JSON
app/index.html         single-page terminal
app/css/style.css      terminal theme (light/dark aware)
app/js/                data / metrics / charts / controller
app/data/dataset.json  generated columnar dataset
app/methodology.md     provenance + definitions (served in-app)
ops/refresh.sh         daily refresh hook
```
