#!/usr/bin/env bash
set -Eeuo pipefail

SESSION_NAME="${GAMMASCOPE_COLLECTOR_SESSION:-gammascope-collector}"
ROOT_DIR="${GAMMASCOPE_LOCAL_REPO:-}"

if [ -z "$ROOT_DIR" ]; then
  ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

ENV_FILE="${GAMMASCOPE_COLLECTOR_ENV:-$ROOT_DIR/ops/amh-nginx/gammascope.collector-client.env}"
LOG_FILE="$ROOT_DIR/.gammascope/moomoo-collector.screen.log"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

need_command pnpm
need_command python3
need_command screen

cd "$ROOT_DIR"

[ -f package.json ] || die "run from the GammaScope repo root or set GAMMASCOPE_LOCAL_REPO"
[ -f "$ENV_FILE" ] || die "missing collector env file: $ENV_FILE"

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi

if [ ! -d node_modules ]; then
  pnpm install
fi

.venv/bin/python -m pip install -e "apps/api[dev]" moomoo-api pandas

set -a
. "$ENV_FILE"
set +a

: "${GAMMASCOPE_SERVER_API:?missing GAMMASCOPE_SERVER_API}"
: "${GAMMASCOPE_ADMIN_TOKEN:?missing GAMMASCOPE_ADMIN_TOKEN}"
: "${GAMMASCOPE_MOOMOO_HOST:?missing GAMMASCOPE_MOOMOO_HOST}"
: "${GAMMASCOPE_MOOMOO_PORT:?missing GAMMASCOPE_MOOMOO_PORT}"
: "${GAMMASCOPE_RUT_SPOT:?missing GAMMASCOPE_RUT_SPOT}"
: "${GAMMASCOPE_NDX_SPOT:?missing GAMMASCOPE_NDX_SPOT}"

python3 - <<'PY'
import os
import socket

host = os.environ["GAMMASCOPE_MOOMOO_HOST"]
port = int(os.environ["GAMMASCOPE_MOOMOO_PORT"])

sock = socket.socket()
sock.settimeout(2)
try:
    sock.connect((host, port))
except OSError as exc:
    raise SystemExit(f"Moomoo OpenD is not reachable at {host}:{port}: {exc}")
finally:
    sock.close()

print(f"moomoo-opend={host}:{port} reachable")
PY

mkdir -p "$(dirname "$LOG_FILE")"

screen -S "$SESSION_NAME" -X quit >/dev/null 2>&1 || true

screen -dmS "$SESSION_NAME" bash -lc "
  cd $(printf '%q' "$ROOT_DIR") || exit 1
  set -a
  . $(printf '%q' "$ENV_FILE")
  set +a
  SSL_CERT_FILE=\"\${SSL_CERT_FILE:-/etc/ssl/cert.pem}\" pnpm collector:moomoo-snapshot \
    --host \"\$GAMMASCOPE_MOOMOO_HOST\" \
    --port \"\$GAMMASCOPE_MOOMOO_PORT\" \
    --api \"\$GAMMASCOPE_SERVER_API\" \
    --spot RUT=\"\$GAMMASCOPE_RUT_SPOT\" \
    --spot NDX=\"\$GAMMASCOPE_NDX_SPOT\" \
    --publish 2>&1 | tee -a $(printf '%q' "$LOG_FILE")
"

printf 'collector screen session started: %s\n' "$SESSION_NAME"
printf 'log file: %s\n' "$LOG_FILE"
printf 'attach with: screen -r %s\n' "$SESSION_NAME"
