#!/usr/bin/env bash
# Run from a trusted release checkout. No upstream shell script is downloaded or executed.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command_name="${1:-install}"
if [[ "$command_name" == help || "$command_name" == --help ]]; then
  printf 'Relaydesk management\nUsage: relaydesk [menu|status|info|start|stop|restart|logs|reset-password|change-username|backup|upgrade|https]\nAccount commands prompt privately; never pass a password as an argument.\nUpgrade builds the trusted source checkout; it does not download updates.\n'
  exit 0
fi
command -v docker >/dev/null 2>&1 || { echo 'Install Docker Engine and the Compose plugin, then run this installer again.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null 2>&1 || { echo 'Docker is not running or this user cannot access it.' >&2; exit 1; }
settings_file='.install.env'
compose=(docker compose --project-name relaydesk --file compose.install.yaml)
if [[ -f "$settings_file" ]]; then compose+=(--env-file "$settings_file"); fi
require_install() { [[ -f "$settings_file" ]] || { echo 'No completed installation here. Run setup first.' >&2; exit 1; }; }
offline_run() (
  require_install
  services="$("${compose[@]}" ps --status running --services)"
  restore=false
  if printf '%s\n' "$services" | grep -qx relaydesk; then restore=true; fi
  # Called indirectly by the EXIT trap, including command failure paths.
  # shellcheck disable=SC2317
  restore_app() {
    local result=$?
    trap - EXIT
    if [[ "$restore" == true ]]; then
      if ! "${compose[@]}" up -d --wait --wait-timeout 60 >&2; then
        echo 'Application restart failed. Run relaydesk start and inspect relaydesk logs.' >&2
        result=1
      fi
    fi
    exit "$result"
  }
  trap restore_app EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ "$restore" == true ]]; then "${compose[@]}" stop >&2; fi
  "$@"
)
backup_data() {
  local backup_dir
  umask 077
  [[ ! -L backups ]] || { echo 'Refusing a symlinked backup directory.' >&2; return 1; }
  mkdir -p backups
  backup_dir="$(mktemp -d "$PWD/backups/backup-XXXXXXXX")"
  printf 'Creating private backup in %s. Treat it as a secret.\n' "$backup_dir" >&2
  if ! "${compose[@]}" run --rm -T --no-deps --entrypoint tar relaydesk -C /app/data -czf - . > "$backup_dir/data.tar.gz"; then
    echo 'Backup failed; directory is incomplete and must not be used for restoration.' >&2
    return 1
  fi
  tar -tzf "$backup_dir/data.tar.gz" >/dev/null
  cp .install.env "$backup_dir/"
  if [[ -f .https.env ]]; then cp .https.env "$backup_dir/"; fi
  cp package.json "$backup_dir/"
  printf 'Backup complete: %s\nIncludes database, encryption key and runtime configuration. Gateway certificate volumes are separate.\n' "$backup_dir"
}
case "$command_name" in
  menu)
    [[ -t 0 ]] || { echo 'Open the menu in an interactive terminal.' >&2; exit 1; }
    while true; do
    printf '\nRelaydesk management\n1) Status\n2) Panel address, version and accounts\n3) Reset password (custom or generated)\n4) Change username\n5) Start services\n6) Stop application\n7) Restart application\n8) Application logs\n9) Back up application data\n10) Set up HTTPS\n11) HTTPS status / certificate expiry\n12) HTTPS logs\n13) Stop managed HTTPS\n14) Upgrade trusted source checkout\n0) Exit\n'
    read -r -p 'Choose: ' choice || exit 0
    case "$choice" in
      1) action=(status) ;; 2) action=(info) ;; 3) action=(reset-password) ;; 4) action=(change-username) ;;
      5) action=(start) ;; 6) action=(stop) ;; 7) action=(restart) ;; 8) action=(logs) ;; 9) action=(backup) ;;
      10) action=(https enable) ;; 11) action=(https status) ;; 12) action=(https logs) ;; 13) action=(https disable) ;;
      14) action=(upgrade) ;; 0) exit 0 ;; *) echo 'Unknown choice.' >&2; continue ;;
    esac
    bash install.sh "${action[@]}" || echo 'Action did not complete. See the message above.' >&2
    read -r -p 'Press Enter to return to the menu: ' || exit 0
    done
    ;;
  info)
    require_install
    "${compose[@]}" run --rm -T --no-deps relaydesk node src/operator.js info
    ;;
  reset-password|change-username)
    [[ $# == 1 && -t 0 ]] || { echo "Run relaydesk $command_name interactively, without account or password arguments." >&2; exit 1; }
    offline_run "${compose[@]}" run --rm --no-deps relaydesk node src/operator.js "$command_name"
    ;;
  backup) require_install; offline_run backup_data ;;
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
  stop) require_install; "${compose[@]}" stop ;;
  restart) require_install; "${compose[@]}" restart relaydesk; "${compose[@]}" up -d --wait --wait-timeout 60 ;;
  status) "${compose[@]}" ps ;;
  logs) "${compose[@]}" logs --tail=100 ;;
  upgrade)
    echo 'Back up the database, master.key and runtime.json before upgrading. This command builds the current trusted checkout.'
    read -r -p 'Backup completed and release reviewed? [y/N]: ' ready
    [[ "$ready" == y || "$ready" == Y ]] || exit 1
    "${compose[@]}" build
    "${compose[@]}" up -d --wait --wait-timeout 60
    ;;
  *) echo 'Unknown command. Run relaydesk help.' >&2; exit 1 ;;
esac
