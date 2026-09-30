#!/usr/bin/env bash
# Run from a trusted release checkout. No upstream shell script is downloaded or executed.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v docker >/dev/null 2>&1 || { echo 'Install Docker Engine and the Compose plugin, then run this installer again.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null 2>&1 || { echo 'Docker is not running or this user cannot access it.' >&2; exit 1; }
command_name="${1:-install}"
settings_file='.install.env'
compose=(docker compose --project-name relaydesk --file compose.install.yaml)
if [[ -f "$settings_file" ]]; then compose+=(--env-file "$settings_file"); fi
case "$command_name" in
  menu)
    [[ -t 0 ]] || { echo 'Open the menu in an interactive terminal.' >&2; exit 1; }
    printf '\nRelaydesk\n1) Status\n2) Set up HTTPS\n3) HTTPS status / certificate expiry\n4) HTTPS logs\n5) Start services\n6) Stop application\n7) Upgrade current source checkout\n8) Stop managed HTTPS\n0) Exit\n'
    read -r -p 'Choose: ' choice
    case "$choice" in
      1) exec bash install.sh status ;; 2) exec bash https.sh enable ;;
      3) exec bash https.sh status ;; 4) exec bash https.sh logs ;;
      5) exec bash install.sh start ;; 6) exec bash install.sh stop ;;
      7) exec bash install.sh upgrade ;; 8) exec bash https.sh disable ;;
      0) exit 0 ;; *) echo 'Unknown choice.' >&2; exit 1 ;;
    esac
    ;;
  https) exec bash https.sh "${2:-status}" ;;
  install)
    if [[ -f "$settings_file" ]]; then
      echo 'Installer settings already exist. Run bash install.sh start, or use Settings in the panel.' >&2
      exit 1
    fi
    [[ -t 0 ]] || { echo 'Run bash install.sh in an interactive terminal.' >&2; exit 1; }
    relaydesk_port="${RELAYDESK_HTTP_PORT:-3210}"
    if [[ ! "$relaydesk_port" =~ ^[1-9][0-9]{0,4}$ ]] || ((relaydesk_port > 65535)); then echo 'Invalid port.' >&2; exit 1; fi
    "${compose[@]}" build
    # No host port is published by this one-shot wizard. The volume holds its DB and key.
    "${compose[@]}" run --rm --no-deps relaydesk node src/setup.js
    (umask 077; printf 'RELAYDESK_HTTP_PORT=%s\n' "$relaydesk_port" > "$settings_file")
    compose+=(--env-file "$settings_file")
    "${compose[@]}" up -d --wait --wait-timeout 60
    printf '\nRelaydesk listens on 127.0.0.1:%s. Configure your HTTPS proxy to forward there.\n' "$relaydesk_port"
    echo 'Manage it with: bash install.sh status | logs | stop | start'
    bash https.sh enable || echo 'Application installed. HTTPS is not confirmed; fix the reported issue and run bash install.sh https enable.' >&2
    ;;
  start)
    "${compose[@]}" up -d --wait --wait-timeout 60
    if [[ -f .https.env ]]; then bash https.sh start; fi
    ;;
  stop) "${compose[@]}" stop ;;
  status) "${compose[@]}" ps ;;
  logs) "${compose[@]}" logs --tail=100 -f ;;
  upgrade)
    echo 'Back up the database, master.key and runtime.json before upgrading. This command builds the current trusted checkout.'
    read -r -p 'Backup completed and release reviewed? [y/N]: ' ready
    [[ "$ready" == y || "$ready" == Y ]] || exit 1
    "${compose[@]}" build
    "${compose[@]}" up -d --wait --wait-timeout 60
    ;;
  *) echo 'Usage: bash install.sh [menu|install|start|stop|status|logs|upgrade|https]' >&2; exit 1 ;;
esac
