#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${GAMMASCOPE_DOMAIN:-gamma.hiqjj.org}"
REPO_URL="${GAMMASCOPE_REPO_URL:-https://github.com/zifanzhou1024/gamma-scope.git}"
BRANCH="${GAMMASCOPE_BRANCH:-codex/amh-nginx-server-setup}"
APP_DIR="${GAMMASCOPE_APP_DIR:-/opt/gammascope}"

SERVER_ENV="ops/amh-nginx/gammascope.production.env"
COLLECTOR_ENV="ops/amh-nginx/gammascope.collector-client.env"
COMPOSE_FILE="ops/amh-nginx/docker-compose.amh.yml"

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "run this script as root on the Debian VPS"
  fi
}

require_debian() {
  . /etc/os-release
  if [ "${ID:-}" != "debian" ]; then
    die "this bootstrap is written for Debian; detected ID=${ID:-unknown}"
  fi
}

install_base_packages() {
  log "Installing base packages"
  apt-get update
  apt-get install -y ca-certificates curl git openssl python3
}

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker is already installed"
    systemctl enable --now docker >/dev/null 2>&1 || true
    return
  fi

  log "Installing Docker from the Debian repository"
  rm -f /etc/apt/sources.list.d/docker.list
  rm -f /etc/apt/sources.list.d/docker.sources

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  . /etc/os-release
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  docker run --rm hello-world >/dev/null
}

checkout_repo() {
  log "Checking out $REPO_URL branch $BRANCH into $APP_DIR"

  if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    git fetch origin
    git switch "$BRANCH"
    git pull --ff-only
    return
  fi

  if [ -e "$APP_DIR" ] && [ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]; then
    die "$APP_DIR exists but is not a Git checkout"
  fi

  mkdir -p "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
}

generate_env_files_if_needed() {
  cd "$APP_DIR"

  if [ -f "$SERVER_ENV" ] && [ -f "$COLLECTOR_ENV" ]; then
    log "Found $SERVER_ENV and $COLLECTOR_ENV; keeping existing secrets"
    chmod 600 "$SERVER_ENV" "$COLLECTOR_ENV"
    return
  fi

  if [ -f "$SERVER_ENV" ] || [ -f "$COLLECTOR_ENV" ]; then
    die "only one env file exists; refusing to generate mismatched secrets. Restore the missing env file or move both files aside."
  fi

  log "Generating new server and collector env files"
  python3 ops/amh-nginx/generate_secrets.py \
    --domain "$DOMAIN" \
    --server-output "$SERVER_ENV" \
    --collector-output "$COLLECTOR_ENV"
}

start_compose_stack() {
  cd "$APP_DIR"

  log "Building and starting GammaScope containers"
  docker compose \
    --env-file "$SERVER_ENV" \
    -f "$COMPOSE_FILE" \
    up -d --build

  docker compose \
    --env-file "$SERVER_ENV" \
    -f "$COMPOSE_FILE" \
    ps
}

run_smoke_tests() {
  log "Running local server smoke tests"
  curl -fsSI http://127.0.0.1:3000/ >/dev/null
  curl -fsS http://127.0.0.1:8000/api/spx/0dte/replay/sessions >/dev/null
}

print_next_steps() {
  cat <<EOF

Server bootstrap finished.

If this was the first run, save the generated web admin password and collector admin token printed above.
Do not paste those values into chat, screenshots, logs, issues, or GitHub.

If AMH/Nginx was not already configured, paste the gamma.hiqjj.org URL rules from:
  $APP_DIR/ops/amh-nginx/README.md

Then reload AMH Nginx:
  /usr/local/nginx-1.24/sbin/nginx -t && /usr/local/nginx-1.24/sbin/nginx -s reload

Public smoke tests:
  curl -I https://$DOMAIN/
  curl -fsS https://$DOMAIN/api/spx/0dte/snapshot/latest

Collector env for the Mac:
  scp root@$DOMAIN:$APP_DIR/$COLLECTOR_ENV ops/amh-nginx/gammascope.collector-client.env
EOF
}

main() {
  require_root
  require_debian
  install_base_packages
  install_docker_if_needed
  checkout_repo
  generate_env_files_if_needed
  start_compose_stack
  run_smoke_tests
  print_next_steps
}

main "$@"
