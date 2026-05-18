#!/bin/zsh
set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

APP_PATH="/Applications/moomoo_OpenD.app"
PROCESS_PATTERN="/Applications/moomoo_OpenD.app/Contents/MacOS/moomoo_OpenD"
DATA_DIR="/Users/sakura/local-ml-data/gamma-ml-research"
LOG_DIR="${DATA_DIR}/logs"

mkdir -p "${LOG_DIR}"

while true; do
  if pgrep -f "${PROCESS_PATTERN}" >/dev/null 2>&1; then
    sleep 60
    continue
  fi

  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') starting moomoo OpenD"
  /usr/bin/open -ga "${APP_PATH}"
  sleep 60
done
