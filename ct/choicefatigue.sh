#!/usr/bin/env bash
_CS_DEFAULT_URL="https://raw.githubusercontent.com/doomedramen/choice-fatigue/main"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")

# Copyright (c) 2026 Choice Fatigue
# Source: https://github.com/doomedramen/choice-fatigue

APP="Choice Fatigue"
var_tags="${var_tags:-media;discovery}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-4096}"
var_disk="${var_disk:-20}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"
var_arm64="${var_arm64:-yes}"
export var_public_url="${var_public_url:-}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/choice-fatigue ]]; then
    msg_error "No Choice Fatigue installation was found."
    exit 1
  fi

  if check_for_gh_branch "choicefatigue" "doomedramen/choice-fatigue" "main"; then
    msg_info "Backing up the Choice Fatigue database"
    install -d -m 0750 -o postgres -g postgres /var/backups/choice-fatigue
    runuser -u postgres -- pg_dump --format=custom --file="/var/backups/choice-fatigue/choice-fatigue-$(date +%Y%m%d%H%M%S).dump" choice_fatigue
    msg_ok "Backed up the Choice Fatigue database"

    msg_info "Stopping Choice Fatigue"
    systemctl stop choice-fatigue.service
    msg_ok "Stopped Choice Fatigue"

    create_backup /opt/choice-fatigue/.env
    CLEAN_INSTALL=1 fetch_and_deploy_gh_branch "choicefatigue" "doomedramen/choice-fatigue" "main" "/opt/choice-fatigue"
    restore_backup
    chown -R choicefatigue:choicefatigue /opt/choice-fatigue

    msg_info "Building Choice Fatigue and applying database migrations"
    $STD runuser -u choicefatigue -- bash -c 'cd /opt/choice-fatigue && set -a && . ./.env && set +a && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build && pnpm db:deploy'
    msg_ok "Built Choice Fatigue and applied database migrations"

    msg_info "Starting Choice Fatigue"
    systemctl start choice-fatigue.service
    msg_ok "Started Choice Fatigue"

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
    msg_ok "Updated Choice Fatigue successfully"
  else
    msg_ok "Choice Fatigue is already up to date"
  fi
  exit 0
}

start
build_container
description

msg_ok "Completed successfully"
echo -e "${INFO}${YW}After configuring HTTPS on your reverse proxy, open the URL you entered during installation.${CL}"
