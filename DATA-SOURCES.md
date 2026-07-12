# Data sources & intel roadmap

What this dashboard uses today, and what else is reachable — ranked by value to a
merchant Irish wind/clean-power thesis (Greenfish).

## Live now — EirGrid Smart Grid Dashboard (public, tokenless)

Demand, wind, generation, fuel-mix snapshot, interconnector flows, CO₂
intensity/emissions, SNSP. 15-minute, all-island / ROI / NI. This is the backbone.

## The ENTSO-E token unlocks most of the rest

One free token (already being requested) is the master key. Beyond day-ahead
price it exposes, for the SEM zone (`10Y1001A1001A59C`):

| Feed | Doc | Why it matters |
|------|-----|----------------|
| **Actual generation per type** | A75 | The real MW split — gas, coal, oil, biomass, hydro, pumped storage, **solar (B16)**, wind. Fixes the two biggest gaps below in one call. |
| Wind & solar day-ahead **forecast** | A69 | Forecast vs actual = balancing exposure. |
| **Generation & transmission outages** | A80/A78 | Market-moving: big units offline → price spikes. |
| Cross-border **scheduled + physical flows** | A11/A88 | Per-interconnector, both directions, richer than EirGrid's net. |
| **Installed capacity per type** | A68 | Tracks the wind/solar/battery build-out — i.e. the cannibalisation trajectory. |

## Solar — two routes

1. **Direct (preferred):** ENTSO-E A75 reports **B16 = Solar** for the SEM zone.
   Grid-scale solar that EirGrid dispatches should appear. *Caveat:* Irish solar
   is new; how fully EirGrid populates B16 needs a check once the token is live.
2. **Deduced (no token, from data we already log):** solar is zero at night, so
   `solar ≈ (renewables − wind)_daytime − (renewables − wind)_pre-dawn baseline`.
   We already log the fuel-mix **Renewables** share every 15 min and have
   `WIND_ACTUAL` and total generation (`GEN_EXP`); scaling renewables to MW and
   subtracting wind isolates hydro+bio+solar, and the daytime bump over the
   nighttime floor is solar. Rough, but real, and buildable from the running log.

## Battery / storage — partly visible, mostly not

- **Pumped storage** (Turlough Hill, 292 MW) shows up as ENTSO-E **B10** — visible.
- **Grid-scale batteries (BESS):** no dedicated ENTSO-E production type, and most
  sites are under the reporting threshold, so lithium storage is largely
  **invisible** in free public data. Best partial signals: EirGrid DS3 / system-
  services reports, and inferring net storage from the residual (hard, noisy).
  Honest answer: batteries are the one thing we can't cleanly see for free.

## Highest-value add not yet wired — wind curtailment

**Dispatch-down of wind** — the MW of wind ordered to reduce output for
**curtailment** (system-wide oversupply / SNSP limit) or **constraint** (local
grid limits). This is *direct lost revenue* for a wind asset and the sharpest
number in any Irish wind thesis. EirGrid publishes it in quarterly/annual
curtailment reports and some operational feeds. Chasing this down is the single
most useful next dataset — more so than any prettier chart.

## Other prices wind is exposed to

- **Balancing / imbalance price** (SEMO) — the second price beyond day-ahead;
  what wind actually settles at when it deviates from schedule.
- **Capacity market** auction results (SEM T-4/T-1) — capacity payments, the
  revenue-stacking layer on top of energy.

## Priority order

1. ENTSO-E token → **actual solar** + real fuel-by-type + outages (one integration).
2. **Wind curtailment / dispatch-down** (revenue risk — the thesis number).
3. Balancing price + capacity-market data (full revenue stack).
4. Battery: accept the blind spot; revisit if EirGrid opens BESS data.
