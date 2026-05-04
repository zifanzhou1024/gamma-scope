# GammaScope AMH/Nginx Deployment

This folder contains the server-side deployment assets for `gamma.hiqjj.org`.

The target layout is:

- AMH/Nginx is the public HTTPS entrypoint on ports `80` and `443`.
- Docker Compose runs Postgres, Redis, FastAPI, and Next.js on the Debian server.
- FastAPI is bound only to `127.0.0.1:8000`.
- Next.js is bound only to `127.0.0.1:3000`.
- Your own computer runs Moomoo OpenD and the GammaScope collector, then publishes data to `https://gamma.hiqjj.org`.

## Files

- `docker-compose.amh.yml`: production Compose stack.
- `gammascope.nginx.conf`: full Nginx vhost template for `gamma.hiqjj.org`.
- `gammascope.production.env.example`: server env template.
- `gammascope.collector-client.env.example`: local collector env template.
- `generate_secrets.py`: generates matching server and collector env files.

## 1. Debian Docker Setup

Run this on the VPS as `root`. It removes the broken old `docker.list` file if one exists and installs Docker using Docker's current Debian `.sources` repository format.

```bash
set -eux

rm -f /etc/apt/sources.list.d/docker.list
rm -f /etc/apt/sources.list.d/docker.sources

apt-get update
apt-get install -y ca-certificates curl git openssl python3

. /etc/os-release
test "$ID" = "debian"

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

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

docker version
docker compose version
docker run hello-world
```

## 2. Pull The Deployment Branch

```bash
mkdir -p /opt/gammascope
cd /opt/gammascope

git clone https://github.com/zifanzhou1024/gamma-scope.git .
git switch main
git pull
```

## 3. Generate Server Secrets

This writes the real server env file and a matching collector env file. Both generated files are ignored by Git.

```bash
cd /opt/gammascope

python3 ops/amh-nginx/generate_secrets.py \
  --server-output ops/amh-nginx/gammascope.production.env \
  --collector-output ops/amh-nginx/gammascope.collector-client.env
```

Save the printed values:

- `web admin username`
- `web admin password`
- `collector admin token`

If you need to regenerate files intentionally:

```bash
python3 ops/amh-nginx/generate_secrets.py \
  --server-output ops/amh-nginx/gammascope.production.env \
  --collector-output ops/amh-nginx/gammascope.collector-client.env \
  --force
```

If the stack has already started once, `--force` also changes `GAMMASCOPE_POSTGRES_PASSWORD`. On a fresh test install, stop and remove the database volume before restarting:

```bash
docker compose \
  --env-file ops/amh-nginx/gammascope.production.env \
  -f ops/amh-nginx/docker-compose.amh.yml \
  down -v
```

Do not use `down -v` after you have real production data unless you have a database backup. For a live database, keep the existing Postgres password or rotate it manually inside Postgres before changing the env file.

## 4. Start Backend And Frontend

```bash
cd /opt/gammascope

docker compose \
  --env-file ops/amh-nginx/gammascope.production.env \
  -f ops/amh-nginx/docker-compose.amh.yml \
  up -d --build
```

Check the containers:

```bash
docker compose \
  --env-file ops/amh-nginx/gammascope.production.env \
  -f ops/amh-nginx/docker-compose.amh.yml \
  ps
```

Local smoke checks on the server:

```bash
curl -I http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:8000/api/spx/0dte/replay/sessions | python3 -m json.tool
```

## 5. Configure AMH/Nginx

In AMH, create a site for:

```text
gamma.hiqjj.org
```

Set the reverse proxy rules to:

```text
/_next/                                -> http://127.0.0.1:3000
/images/                               -> http://127.0.0.1:3000
/favicon.ico                           -> http://127.0.0.1:3000
/api/admin/                            -> http://127.0.0.1:3000
/api/replay/imports                    -> http://127.0.0.1:3000
/api/views                             -> http://127.0.0.1:3000
/api/spx/0dte/snapshot/latest          -> http://127.0.0.1:3000
/api/spx/0dte/status                   -> http://127.0.0.1:3000
/api/spx/0dte/heatmap/latest           -> http://127.0.0.1:3000
/api/spx/0dte/experimental/            -> http://127.0.0.1:3000
/api/spx/0dte/experimental-flow/       -> http://127.0.0.1:3000
/api/spx/0dte/replay/                  -> http://127.0.0.1:3000
/api/spx/0dte/scenario                 -> http://127.0.0.1:3000
/                                      -> http://127.0.0.1:3000
/ws/                                   -> http://127.0.0.1:8000
/api/spx/0dte/collector/events         -> http://127.0.0.1:8000
/api/spx/0dte/collector/events/bulk    -> http://127.0.0.1:8000
```

Do not add a broad `/api/ -> 127.0.0.1:8000` rule. Next.js owns routes such as `/api/admin/login` and the authenticated realtime proxy at `/api/spx/0dte/snapshot/latest`; broad API proxying will make private-mode browser pages keep seeing seed data.

For AMH URL rules, paste location blocks, not a full `server { ... }` block:

```nginx
location ^~ /_next/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
}

location ^~ /images/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /favicon.ico {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/admin/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/replay/imports {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/views {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/spx/0dte/snapshot/latest {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/spx/0dte/status {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/spx/0dte/heatmap/latest {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/spx/0dte/experimental/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/spx/0dte/experimental-flow/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/spx/0dte/replay/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/spx/0dte/scenario {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/spx/0dte/collector/events {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/spx/0dte/collector/events/bulk {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /ws/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
    proxy_buffering off;
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
    proxy_buffering off;
}
```

If you use the full template directly, copy it after the TLS certificate exists:

```bash
cp /opt/gammascope/ops/amh-nginx/gammascope.nginx.conf /etc/nginx/conf.d/gammascope.conf
nginx -t
systemctl reload nginx || systemctl restart nginx
```

The template expects certificates at:

```text
/etc/letsencrypt/live/gamma.hiqjj.org/fullchain.pem
/etc/letsencrypt/live/gamma.hiqjj.org/privkey.pem
```

If AMH manages SSL elsewhere, update the two `ssl_certificate` paths in the copied Nginx config.

## 6. Public Smoke Checks

Run from your computer:

```bash
curl -I https://gamma.hiqjj.org/
curl -fsS https://gamma.hiqjj.org/api/spx/0dte/replay/sessions | python3 -m json.tool
```

Verify that AMH is not intercepting Next.js assets:

```bash
ASSET_PATH="$(curl -fsS https://gamma.hiqjj.org/ | grep -oE '/_next/[^"]+' | head -1)"
echo "$ASSET_PATH"
curl -I "https://gamma.hiqjj.org$ASSET_PATH"
```

Expected: `HTTP/2 200` and a Next static asset content type such as CSS or JavaScript.

Collector ingestion should reject missing tokens:

```bash
curl -i -X POST https://gamma.hiqjj.org/api/spx/0dte/collector/events/bulk \
  -H 'Content-Type: application/json' \
  --data '[]'
```

Expected: `403`.

Collector ingestion should accept the generated token:

```bash
ADMIN_TOKEN="<collector admin token>"

curl -i -X POST https://gamma.hiqjj.org/api/spx/0dte/collector/events/bulk \
  -H "X-GammaScope-Admin-Token: $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '[]'
```

Expected: `200`.

## 7. Configure Your Local Collector

Copy the generated collector env from the server to your local repo checkout:

```bash
scp root@gamma.hiqjj.org:/opt/gammascope/ops/amh-nginx/gammascope.collector-client.env \
  /Users/sakura/WebstormProjects/gamma-scope/.worktrees/amh-nginx-server-setup/ops/amh-nginx/gammascope.collector-client.env
```

Start Moomoo OpenD locally, then run from your computer:

```bash
cd /Users/sakura/WebstormProjects/gamma-scope/.worktrees/amh-nginx-server-setup

set -a
. ops/amh-nginx/gammascope.collector-client.env
set +a

pnpm collector:moomoo-snapshot -- \
  --host "$GAMMASCOPE_MOOMOO_HOST" \
  --port "$GAMMASCOPE_MOOMOO_PORT" \
  --api "$GAMMASCOPE_SERVER_API" \
  --spot RUT="$GAMMASCOPE_RUT_SPOT" \
  --spot NDX="$GAMMASCOPE_NDX_SPOT" \
  --publish
```

Open:

```text
https://gamma.hiqjj.org/
https://gamma.hiqjj.org/heatmap
```

Live dashboard viewing is public. The web admin login is only needed for replay import/upload flows; collector ingestion still uses the generated admin token.

## 8. Operations

Update and rebuild:

```bash
cd /opt/gammascope
git pull
docker compose --env-file ops/amh-nginx/gammascope.production.env -f ops/amh-nginx/docker-compose.amh.yml up -d --build
```

View logs:

```bash
docker compose --env-file ops/amh-nginx/gammascope.production.env -f ops/amh-nginx/docker-compose.amh.yml logs -f api
docker compose --env-file ops/amh-nginx/gammascope.production.env -f ops/amh-nginx/docker-compose.amh.yml logs -f web
```

Backup Postgres:

```bash
docker compose --env-file ops/amh-nginx/gammascope.production.env -f ops/amh-nginx/docker-compose.amh.yml exec postgres \
  pg_dump -U gammascope gammascope > "gammascope-$(date +%Y%m%d-%H%M%S).sql"
```
