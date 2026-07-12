#!/usr/bin/env bash
# Daily incremental refresh for the Ireland Power dashboard.
# Wire into launchd/cron, e.g. 07:00 daily.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
# ENTSOE_TOKEN is read from the environment if set (enables the price panel).
python3 etl/build_dataset.py --incremental
echo "[$(date '+%Y-%m-%d %H:%M')] Ireland Power dashboard refreshed."
