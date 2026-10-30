#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root inside the Debian 13 LXC." >&2
  exit 1
fi
if [[ ! -f package.json || ! -f pnpm-lock.yaml || ! -f prisma/schema.prisma ]]; then
  echo "Run this script from the Choice Fatigue checkout directory." >&2
  exit 1
fi
if [[ -f .env || -f /etc/systemd/system/choice-fatigue.service ]]; then
  echo "An existing configuration or service was found. Back it up and use the upgrade instructions instead." >&2
  exit 1
fi

public_url=${1:-}
if [[ -z "$public_url" ]]; then
  read -r -p "Public Choice Fatigue URL (include https://): " public_url
fi
if [[ ! "$public_url" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "Enter a valid http:// or https:// URL without spaces or quotes." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl nodejs npm postgresql postgresql-client
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if (( node_major < 22 )); then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
  if (( node_major < 22 )); then echo "Node.js 22 or newer is required; found $(node --version)." >&2; exit 1; fi
fi
corepack enable 2>/dev/null || true
npm install --global pnpm@12.16.1

if ! id choicefatigue >/dev/null 2>&1; then useradd --system --create-home --home-dir /var/lib/choice-fatigue --shell /usr/sbin/nologin choicefatigue; fi
project_dir=$(pwd -P)
chown -R choicefatigue:choicefatigue "$project_dir"
chmod 700 "$project_dir"

db_password=$(openssl rand -hex 32)
auth_secret=$(openssl rand -base64 48 | tr -d '\n')
credential_key=$(openssl rand -base64 32 | tr -d '\n')
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE choice_fatigue LOGIN PASSWORD '${db_password}'"
runuser -u postgres -- createdb --owner=choice_fatigue choice_fatigue
cat > .env <<EOF
DATABASE_URL=postgresql://choice_fatigue:${db_password}@localhost:5432/choice_fatigue?schema=public
BETTER_AUTH_SECRET=${auth_secret}
BETTER_AUTH_URL=${public_url}
INTEGRATION_CREDENTIALS_KEY=${credential_key}
EOF
chown choicefatigue:choicefatigue .env
chmod 600 .env

runuser -u choicefatigue -- pnpm install --frozen-lockfile
runuser -u choicefatigue -- pnpm db:generate
runuser -u choicefatigue -- pnpm build
runuser -u choicefatigue -- pnpm db:deploy

pnpm_bin=$(command -v pnpm)
cat > /etc/systemd/system/choice-fatigue.service <<EOF
[Unit]
Description=Choice Fatigue
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=choicefatigue
Group=choicefatigue
WorkingDirectory=${project_dir}
EnvironmentFile=${project_dir}/.env
Environment=NODE_ENV=production
Environment=PORT=4173
Environment=HOSTNAME=0.0.0.0
ExecStart=${pnpm_bin} start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now choice-fatigue.service
echo "Choice Fatigue is installed. Configure your reverse proxy for this LXC on port 4173, then verify the public URL and HTTPS certificate."
