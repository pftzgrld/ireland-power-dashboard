#!/usr/bin/env python3
"""
Ireland Power Dashboard — ETL

Fetches observed all-island (SEM) power system data from the EirGrid Smart Grid
Dashboard service and writes columnar JSON for the static frontend.

Data source: https://www.smartgriddashboard.com/DashboardService.svc/data
  Public, tokenless. 15-minute cadence. Regions: ALL (all-island), ROI, NI.

Optional: day-ahead wholesale prices from the ENTSO-E Transparency Platform.
  Needs a free API token in ENTSOE_TOKEN (see methodology.md). Skipped if absent.

Stdlib only (urllib, json) + retry/backoff — the EirGrid service throws
intermittent HTTP 503s under load, so every call retries.

Usage:
  python3 etl/build_dataset.py --days 30            # full pull, last 30 days
  python3 etl/build_dataset.py --incremental        # re-fetch last 2 days only
"""

import argparse
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "app", "data")
CACHE_DIR = os.path.join(HERE, ".cache")

EIRGRID_BASE = "https://www.smartgriddashboard.com/DashboardService.svc/data"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Referer": "https://www.smartgriddashboard.com/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}

# EirGrid "area" -> the series we extract from it.
# Each area returns Rows of {EffectiveTime, FieldName, Region, Value}.
# We keep the raw FieldName so new fuels/interconnectors appear automatically.
AREAS = [
    "demandactual",
    "generationactual",
    "windactual",
    "fuelmix",
    "interconnection",
    "co2intensity",
    "co2emission",
    "SnspALL",
]
REGION = "ALL"  # all-island SEM. ROI / NI also valid.

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def _make_ssl_ctx():
    """Prefer certifi's CA bundle — Python's default store often misses the
    system roots on macOS, which breaks verification of the EirGrid chain."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001
        return ssl.create_default_context()


SSL_CTX = _make_ssl_ctx()


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def _fmt(dt):
    """EirGrid wants DD-Mon-YYYY HH:MM (url-encoded)."""
    return f"{dt.day:02d}-{MONTHS[dt.month-1]}-{dt.year} {dt.hour:02d}:{dt.minute:02d}"


def fetch_area(area, region, dt_from, dt_to, retries=6):
    params = {
        "area": area,
        "region": region,
        "datefrom": _fmt(dt_from),
        "dateto": _fmt(dt_to),
    }
    url = EIRGRID_BASE + "?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=45, context=SSL_CTX) as r:
                body = r.read().decode("utf-8", "replace")
            data = json.loads(body)
            if data.get("Status") == "Success" or data.get("Rows"):
                return data.get("Rows", [])
            # "No data returned" etc. — treat as empty, not an error
            return []
        except json.JSONDecodeError:
            last_err = "503/non-JSON"  # service-unavailable HTML page
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        time.sleep(2.0 + attempt * 2.0)
    print(f"  ! {area} {_fmt(dt_from)}..{_fmt(dt_to)} failed: {last_err}",
          file=sys.stderr)
    return []


def fetch_series(area, region, start, end, chunk_days=10):
    """Walk the window in chunks (the service caps long ranges)."""
    rows = []
    cur = start
    while cur < end:
        nxt = min(cur + timedelta(days=chunk_days), end)
        rows.extend(fetch_area(area, region, cur, nxt))
        cur = nxt
        time.sleep(1.0)  # be polite; the service is fragile
    return rows


# ---------------------------------------------------------------------------
# Normalise
# ---------------------------------------------------------------------------

def parse_time(s):
    # "10-Jul-2026 00:15:00"
    try:
        return datetime.strptime(s, "%d-%b-%Y %H:%M:%S")
    except ValueError:
        return datetime.strptime(s, "%d-%b-%Y %H:%M")


def rows_to_series(rows):
    """
    Collapse Rows into {timestamps:[iso...], series:{FIELD:[values...]}}.
    Values aligned to a shared sorted timestamp axis; missing -> null.
    """
    by_field = {}          # field -> {iso: value}
    stamps = set()
    for r in rows:
        et = r.get("EffectiveTime")
        fn = r.get("FieldName")
        val = r.get("Value")
        if not et or not fn:
            continue
        try:
            iso = parse_time(et).replace(tzinfo=timezone.utc).isoformat()
        except Exception:  # noqa: BLE001
            continue
        stamps.add(iso)
        by_field.setdefault(fn, {})[iso] = val

    axis = sorted(stamps)
    series = {}
    for field, m in by_field.items():
        series[field] = [m.get(iso) for iso in axis]
    return {"timestamps": axis, "series": series}


# ---------------------------------------------------------------------------
# ENTSO-E day-ahead prices (optional)
# ---------------------------------------------------------------------------

ENTSOE_BASE = "https://web-api.tp.entsoe.eu/api"
SEM_DA_DOMAIN = "10Y1001A1001A59C"  # Ireland (SEM) bidding zone


def fetch_entsoe_prices(start, end):
    token = os.environ.get("ENTSOE_TOKEN", "").strip()
    if not token:
        print("  · ENTSOE_TOKEN not set — skipping wholesale prices "
              "(see methodology.md)")
        return None
    import re
    params = {
        "securityToken": token,
        "documentType": "A44",          # price document
        "in_Domain": SEM_DA_DOMAIN,
        "out_Domain": SEM_DA_DOMAIN,
        "periodStart": start.strftime("%Y%m%d%H%M"),
        "periodEnd": end.strftime("%Y%m%d%H%M"),
    }
    url = ENTSOE_BASE + "?" + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as r:
            xml = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"  ! ENTSO-E fetch failed: {e}", file=sys.stderr)
        return None

    # Minimal XML walk: each TimeSeries has a Period with a start + resolution
    # and Point(position, price.amount). Avoids an XML dep beyond stdlib.
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        print("  ! ENTSO-E returned non-XML (token/acknowledgement?)",
              file=sys.stderr)
        return None
    ns = {"n": root.tag[root.tag.find("{")+1: root.tag.find("}")]} \
        if "}" in root.tag else {}

    def f(tag):
        return f"n:{tag}" if ns else tag

    stamps, prices = [], []
    for ts in root.findall(f("TimeSeries"), ns):
        period = ts.find(f("Period"), ns)
        if period is None:
            continue
        ti = period.find(f("timeInterval"), ns)
        p_start = ti.find(f("start"), ns).text
        base = datetime.strptime(p_start, "%Y-%m-%dT%H:%MZ").replace(
            tzinfo=timezone.utc)
        res = period.find(f("resolution"), ns).text  # e.g. PT60M
        step_min = 60
        m = re.match(r"PT(\d+)M", res or "")
        if m:
            step_min = int(m.group(1))
        for pt in period.findall(f("Point"), ns):
            pos = int(pt.find(f("position"), ns).text)
            amt = float(pt.find(f("price.amount"), ns).text)
            t = base + timedelta(minutes=step_min * (pos - 1))
            stamps.append(t.isoformat())
            prices.append(amt)
    if not stamps:
        return None
    order = sorted(range(len(stamps)), key=lambda i: stamps[i])
    return {
        "timestamps": [stamps[i] for i in order],
        "series": {"DAY_AHEAD_EUR_MWH": [prices[i] for i in order]},
    }


# ENTSO-E production-type codes we care about (A75). Solar is the headline —
# EirGrid's own feed has no solar series, so this is the only free MW source.
PSR_TYPES = {
    "B16": "SOLAR",
    "B19": "WIND_ONSHORE",
    "B18": "WIND_OFFSHORE",
    "B04": "GAS",
    "B05": "COAL",
    "B06": "OIL",
    "B01": "BIOMASS",
    "B17": "WASTE",
    "B10": "PUMPED_STORAGE",
    "B11": "HYDRO_ROR",
    "B12": "HYDRO_RESERVOIR",
    "B20": "OTHER",
}


def _parse_gen_xml(xml):
    """Parse one A75 response -> {field: {iso: value}} (generation in-flows)."""
    import re
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None  # acknowledgement / error document
    ns = {"n": root.tag[root.tag.find("{")+1: root.tag.find("}")]} \
        if "}" in root.tag else {}

    def f(tag):
        return f"n:{tag}" if ns else tag

    out = {}
    for ts in root.findall(f("TimeSeries"), ns):
        psr = ts.find(f("MktPSRType"), ns)
        code = psr.find(f("psrType"), ns).text if psr is not None else None
        field = PSR_TYPES.get(code)
        if not field:
            continue
        # skip out-flows (storage charging) — count only generation into the zone
        if ts.find(f("outBiddingZone_Domain.mRID"), ns) is not None:
            continue
        period = ts.find(f("Period"), ns)
        if period is None:
            continue
        ti = period.find(f("timeInterval"), ns)
        base = datetime.strptime(ti.find(f("start"), ns).text,
                                 "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        res = period.find(f("resolution"), ns).text or "PT60M"
        m = re.match(r"PT(\d+)M", res)
        step = int(m.group(1)) if m else 60
        d = out.setdefault(field, {})
        for pt in period.findall(f("Point"), ns):
            pos = int(pt.find(f("position"), ns).text)
            qty = float(pt.find(f("quantity"), ns).text)
            iso = (base + timedelta(minutes=step * (pos - 1))).isoformat()
            d[iso] = d.get(iso, 0) + qty
    return out


def fetch_entsoe_generation(start, end):
    """Actual generation per production type (A75) for the SEM zone — real solar
    MW (B16) plus the full fuel split with history, which EirGrid's feed lacks.
    ENTSO-E caps the generation response window, so we fetch in 1-day chunks and
    merge. Best-effort; returns None without a token or on total failure."""
    token = os.environ.get("ENTSOE_TOKEN", "").strip()
    if not token:
        return None
    merged = {}   # field -> {iso: value}
    cur = start
    while cur < end:
        nxt = min(cur + timedelta(days=1), end)
        params = {
            "securityToken": token,
            "documentType": "A75",
            "processType": "A16",
            "in_Domain": SEM_DA_DOMAIN,
            "periodStart": cur.strftime("%Y%m%d%H%M"),
            "periodEnd": nxt.strftime("%Y%m%d%H%M"),
        }
        url = ENTSOE_BASE + "?" + urllib.parse.urlencode(params)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as r:
                chunk = _parse_gen_xml(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001
            print(f"  ! ENTSO-E gen {cur:%Y-%m-%d} failed: {e}", file=sys.stderr)
            chunk = None
        if chunk:
            for fld, m in chunk.items():
                merged.setdefault(fld, {}).update(m)
        cur = nxt
    if not merged:
        return None
    stamps = sorted({iso for m in merged.values() for iso in m})
    return {
        "timestamps": stamps,
        "series": {fld: [m.get(iso) for iso in stamps] for fld, m in merged.items()},
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def now_utc():
    # allow a frozen clock for reproducible runs / tests
    override = os.environ.get("ETL_NOW")
    if override:
        return datetime.strptime(override, "%Y-%m-%d %H:%M").replace(
            tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


REGIONS = ["ALL", "ROI", "NI"]

# Fuel mix -> friendly name, in stack order. NI has no coal; missing fuels are
# simply skipped.
FUEL_LABELS = {
    "FUEL_GAS": "Gas",
    "FUEL_RENEW": "Renewables",
    "FUEL_NET_IMPORT": "Net import",
    "FUEL_OTHER_FOSSIL": "Other fossil",
    "FUEL_COAL": "Coal",
}

FUELMIX_LOG = os.path.join(DATA_DIR, "fuelmix_log.json")


def fuelmix_shares(region):
    """Current fuel-mix snapshot -> {fuel: percent}. The absolute values are a
    trailing-energy total of ambiguous unit, so we store normalised % only."""
    rows = fetch_area("fuelmix", region,
                      now_utc().replace(tzinfo=None) - timedelta(hours=1),
                      now_utc().replace(tzinfo=None))
    vals = {}
    for r in rows:
        fn, v = r.get("FieldName"), r.get("Value")
        if fn in FUEL_LABELS and v is not None:
            vals[FUEL_LABELS[fn]] = float(v)
    total = sum(x for x in vals.values() if x > 0)
    if not total:
        return {}
    return {k: round(v / total * 100, 2) for k, v in vals.items() if v > 0}


def log_fuelmix():
    """Append the current fuel-mix snapshot (all regions) to a running log.
    Run on a schedule (e.g. every 30 min) to build the history EirGrid's feed
    does not provide."""
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(FUELMIX_LOG) as fh:
            log = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        log = []
    stamp = now_utc().replace(minute=(now_utc().minute // 15) * 15,
                              second=0, microsecond=0).isoformat()
    entry = {"t": stamp}
    for region in REGIONS:
        entry[region] = fuelmix_shares(region)
        time.sleep(1.0)
    # de-dupe on timestamp (idempotent within a 15-min bucket)
    log = [e for e in log if e.get("t") != stamp]
    log.append(entry)
    # keep ~200 days at 15-min cadence (~19k points, a few MB)
    log = log[-19200:]
    with open(FUELMIX_LOG, "w") as fh:
        json.dump(log, fh, separators=(",", ":"))
    print(f"Logged fuel mix @ {stamp}: ALL={entry['ALL']}")


def build_region(region, start, end):
    out = {}
    for area in AREAS:
        if area == "SnspALL" and region != "ALL":
            out[area] = {"timestamps": [], "series": {}}  # SNSP is all-island
            continue
        rows = fetch_series(area, region, start, end)
        norm = rows_to_series(rows)
        n = len(norm["timestamps"])
        fields = ", ".join(sorted(norm["series"].keys())) or "(none)"
        print(f"    [{region}] {area}: {n} steps · {fields}")
        out[area] = norm
    return out


def main():
    ap = argparse.ArgumentParser(description="Build Ireland power dataset")
    ap.add_argument("--days", type=int, default=30,
                    help="days of history to fetch (default 30)")
    ap.add_argument("--incremental", action="store_true",
                    help="re-fetch only the last 2 days")
    ap.add_argument("--regions", default=",".join(REGIONS),
                    help="comma list: ALL,ROI,NI")
    ap.add_argument("--log-fuelmix", action="store_true",
                    help="append current fuel-mix snapshot to the running log "
                         "and exit (for the scheduled poller)")
    args = ap.parse_args()

    if args.log_fuelmix:
        log_fuelmix()
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    regions = [r.strip().upper() for r in args.regions.split(",") if r.strip()]
    # The EirGrid service buckets data to the exact request minute: an off-grid
    # datefrom (e.g. 09:41) returns null-valued rows. Floor to the hour so every
    # bucket lands on a clean 15-minute mark.
    end = now_utc().replace(minute=0, second=0, microsecond=0,
                            tzinfo=None) + timedelta(hours=1)
    days = 2 if args.incremental else args.days
    start = end - timedelta(days=days)

    print(f"Ireland Power ETL — regions={regions} "
          f"{start:%Y-%m-%d} .. {end:%Y-%m-%d}")

    dataset = {
        "meta": {
            "regions": regions,
            "source": "EirGrid Smart Grid Dashboard (observed)",
            "generated_utc": now_utc().isoformat(),
            "window_start_utc": start.replace(tzinfo=timezone.utc).isoformat(),
            "window_end_utc": end.replace(tzinfo=timezone.utc).isoformat(),
            "cadence": "15-minute",
        },
        "regions": {},
    }

    for region in regions:
        print(f"  region {region} ...")
        dataset["regions"][region] = {"areas": build_region(region, start, end)}

    # ENTSO-E series are all-island (SEM market zone). Attached to every region
    # so the price/capture/solar panels work whichever region is selected.
    prices = fetch_entsoe_prices(start, end)
    dataset["meta"]["has_prices"] = bool(prices)
    if prices:
        print(f"    day-ahead prices: {len(prices['timestamps'])} points")

    gen = fetch_entsoe_generation(start, end)
    dataset["meta"]["has_solar"] = bool(gen and "SOLAR" in gen.get("series", {}))
    if gen:
        fields = ", ".join(sorted(gen["series"].keys()))
        print(f"    gen-by-type ({len(gen['timestamps'])} pts): {fields}")

    for region in regions:
        if prices:
            dataset["regions"][region]["areas"]["prices"] = prices
        if gen:
            dataset["regions"][region]["areas"]["gen_by_type"] = gen

    # NB: the fuel-mix running log is owned by the cloud poller
    # (.github/workflows/poll-fuelmix.yml via --log-fuelmix). Full builds do NOT
    # append to it, to avoid diverging from the authoritative cloud copy.

    out = os.path.join(DATA_DIR, "dataset.json")
    with open(out, "w") as fh:
        json.dump(dataset, fh, separators=(",", ":"))
    size = os.path.getsize(out) / 1024
    print(f"Wrote {out} ({size:.0f} KB)")

    with open(os.path.join(DATA_DIR, "meta.json"), "w") as fh:
        json.dump(dataset["meta"], fh, indent=2)


if __name__ == "__main__":
    main()
