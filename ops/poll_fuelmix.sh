#!/usr/bin/env bash
# Poll the EirGrid fuel-mix snapshot and append it to the running log.
# The fuel-mix feed has no history — this builds it. Run every ~30 min via cron.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
/usr/bin/env python3 etl/build_dataset.py --log-fuelmix >> ops/poll_fuelmix.log 2>&1
