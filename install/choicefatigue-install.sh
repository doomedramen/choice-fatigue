#!/usr/bin/env bash

# Copyright (c) 2026 Choice Fatigue
# Source: https://github.com/doomedramen/choice-fatigue

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

if [[ -z "${var_public_url:-}" ]]; then
  read -r -p "Public Choice Fatigue HTTPS URL (for example https://choice.example.com): " var_public_url
fi
if [[ ! "$var_public_url" =~ ^https://[^[:space:]/]+/?$ ]]; then
  msg_error "Enter the public HTTPS origin without a path, such as https://choice.example.com."
  exit 1
fi
var_public_url="${var_public_url%/}"

msg_info "Installing Choice Fatigue dependencies"
$STD apt install -y ca-certificates curl openssl
msg_ok "Installed Choice Fatigue dependencies"

PG_VERSION="17" setup_postgresql
PG_DB_NAME="choice_fatigue" PG_DB_USER="choice_fatigue" setup_postgresql_db
NODE_VERSION="22" setup_nodejs
$STD npm install --global pnpm@12.16.1

msg_info "Fetching Choice Fatigue"
fetch_and_deploy_gh_branch "choicefatigue" "doomedramen/choice-fatigue" "main" "/opt/choice-fatigue"
msg_ok "Fetched Choice Fatigue"

msg_info "Creating Choice Fatigue service account"
if ! id choicefatigue >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/choice-fatigue --shell /usr/sbin/nologin choicefatigue
fi
chown -R choicefatigue:choicefatigue /opt/choice-fatigue
chmod 0750 /opt/choice-fatigue
msg_ok "Created Choice Fatigue service account"

auth_secret=$(openssl rand -base64 48 | tr -d '\n')
credential_key=$(openssl rand -base64 32 | tr -d '\n')
cat <<EOF >/opt/choice-fatigue/.env
DATABASE_URL=postgresql://${PG_DB_USER}:${PG_DB_PASS}@127.0.0.1:5432/${PG_DB_NAME}?schema=public
BETTER_AUTH_SECRET=${auth_secret}
BETTER_AUTH_URL=${var_public_url}
INTEGRATION_CREDENTIALS_KEY=${credential_key}
EOF
chown choicefatigue:choicefatigue /opt/choice-fatigue/.env
chmod 0600 /opt/choice-fatigue/.env
pnpm_bin=$(command -v pnpm)

msg_info "Building Choice Fatigue and applying database migrations"
$STD runuser -u choicefatigue -- bash -c 'cd /opt/choice-fatigue && set -a && . ./.env && set +a && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build && pnpm db:deploy'
msg_ok "Built Choice Fatigue and applied database migrations"

msg_info "Creating Choice Fatigue service"
cat <<EOF >/etc/systemd/system/choice-fatigue.service
[Unit]
Description=Choice Fatigue
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=choicefatigue
Group=choicefatigue
WorkingDirectory=/opt/choice-fatigue
EnvironmentFile=/opt/choice-fatigue/.env
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
systemctl enable -q --now choice-fatigue.service
msg_ok "Created Choice Fatigue service"

msg_info "Checking Choice Fatigue health"
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:4173/api/health >/dev/null; then
    break
  fi
  sleep 2
done
if ! curl --fail --silent http://127.0.0.1:4173/api/health >/dev/null; then
  systemctl status --no-pager choice-fatigue.service || true
  msg_error "Choice Fatigue did not become healthy. Check journalctl -u choice-fatigue.service."
  exit 1
fi
msg_ok "Choice Fatigue is healthy"

motd_ssh
customize
cleanup_lxc
