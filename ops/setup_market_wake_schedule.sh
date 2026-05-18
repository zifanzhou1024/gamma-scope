#!/bin/zsh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must be run with sudo because pmset power scheduling is system-wide." >&2
  echo "Run: sudo /Users/sakura/WebstormProjects/gamma-scope/ops/setup_market_wake_schedule.sh" >&2
  exit 1
fi

pmset repeat wakeorpoweron MTWRF 06:20:00
pmset -g sched
