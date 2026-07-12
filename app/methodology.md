# Methodology & data provenance

Every figure on this dashboard is **observed** data from public grid operators,
or a clearly-labelled **derivation** from observed data. Nothing here is a
stylised forecast or a proprietary model.

## Sources

| Source | Data | Cadence | Access |
|--------|------|---------|--------|
| EirGrid Smart Grid Dashboard | System demand, wind, generation, fuel mix, CO₂, interconnectors, SNSP — all-island (SEM) | 15-minute | Public, tokenless |
| ENTSO-E Transparency Platform | SEM day-ahead wholesale price | Hourly | Free API token |

## Regions

The header toggle switches every panel between **All-island** (the SEM market
boundary), **ROI** (Republic), and **NI** (Northern Ireland). EirGrid publishes
each series per jurisdiction; the ETL fetches all three. SNSP is an all-island
operating metric, so that panel is only populated for All-island. NI carries no
coal, so that slice is simply absent there.

## What is observed vs derived

- **Observed (EirGrid):** system demand, wind output, CO₂ intensity, CO₂
  emissions rate, SNSP, per-interconnector flows (East-West, Moyle, Greenlink),
  and the current fuel-mix snapshot (gas / renewables / net import / other
  fossil / coal).
- **Derived — "Generation by fuel" and "Fuel mix over time":** the EirGrid
  fuel-mix feed returns only the **latest snapshot**, not history. The
  historical stack is therefore built from observed series:
  - Wind = observed `WIND_ACTUAL`
  - Net import = observed `INTER_NET` (positive values only)
  - **Thermal & other = demand − wind − net import** (the residual). This bundles
    dispatchable thermal with non-wind renewables (solar, hydro, biomass); the
    free feed does not split them at 15-minute resolution. Treat this band as an
    estimate, not a metered value.

## Key definitions

- **SNSP** (System Non-Synchronous Penetration) — the share of demand met by
  non-synchronous sources (wind + HVDC imports) at an instant. EirGrid operates
  to an instantaneous limit (currently 75%); the dashboard marks that line.
- **Net import** — positive = importing into the island, negative = exporting.
- **CO₂ intensity** — grams CO₂ per kWh of electricity consumed.

## Fuel mix — snapshot vs. running log

The EirGrid fuel-mix feed returns only the **current** breakdown — there is no
history in the API. Its absolute numbers are a trailing-energy total of ambiguous
unit, so the dashboard stores and shows **normalised % share** only.

To build the history EirGrid does not provide, a poller
(`ops/poll_fuelmix.sh`, cron every 30 min) appends each snapshot's shares to
`app/data/fuelmix_log.json`. Once the log has ≥2 points, the "Fuel mix over time"
panel switches from the derived stack to the **logged** gas/coal/renewables/import
split. Until then it falls back to the derived wind/import/thermal stack.

## Wind capture price

For the active region, capture analysis compares what wind actually earns to the
average market price:

- **Capture price** = Σ(wind × price) ÷ Σ(wind) — revenue-weighted.
- **Baseload price** = simple time-weighted average of the day-ahead price.
- **Capture rate** = capture ÷ baseload. Below 100% = **cannibalisation** (wind
  depresses price exactly when it generates). This is the core revenue risk for a
  merchant wind asset, and the reason the price overlay matters.

Price is hourly (day-ahead auction); wind is 15-minute, matched to its price hour.
The panel is dark until an ENTSO-E token is supplied.

## No solar series

EirGrid's public feed has **no solar field** — utility-scale solar is folded into
"Renewables" in the fuel mix and is not broken out, and rooftop solar is
behind-the-meter and invisible to the operator entirely. There is no free data
source that exposes all-island solar at 15-minute resolution.

## Other limitations

- **Embedded / behind-the-meter generation** (rooftop solar, small wind) is
  largely invisible to the operator feed, as it is in every European grid's
  public data.
- The fuel-mix snapshot is a point-in-time reading; totals will not always
  reconcile exactly with metered generation.
- Wholesale price is the **day-ahead auction** clearing price (SDAC), not the
  balancing/imbalance price.

## Enabling wholesale prices

The price panel is dark until you supply a free ENTSO-E token:

1. Register at <https://transparency.entsoe.eu/> and request API access
   (Account Settings → "Generate a new token", or email the helpdesk).
2. Export it before running the ETL:
   ```
   export ENTSOE_TOKEN="your-token-here"
   python3 etl/build_dataset.py --days 30
   ```

The SEM day-ahead bidding zone is `10Y1001A1001A59C`.
