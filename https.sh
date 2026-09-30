#!/usr/bin/env bash
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }
https_terminal() {
  [[ "$(uname -s)" == Linux ]] || fail 'Managed HTTPS requires a Linux host.'
  [[ -t 0 ]] || fail 'Run HTTPS setup in an interactive terminal.'
}
https_main() {
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ -f .install.env ]] || fail 'Run the setup wizard first.'
app=(docker compose -p relaydesk -f compose.install.yaml --env-file .install.env)
gateway=(docker compose -p relaydesk-https -f compose.https.yaml --env-file .install.env --env-file .https.env)
command_name="${1:-status}"
case "$command_name" in
  enable)
    https_terminal
    [[ ! -e .https.env && ! -L .https.env ]] || fail 'HTTPS configuration exists. Use start, status or logs; it was not overwritten.'
    command -v ss >/dev/null || fail 'Install iproute2 (ss) to check port ownership first.'
    listeners="$(ss -H -ltn '( sport = :80 or sport = :443 )')" || fail 'Could not check listener ports.'
    [[ -z "$listeners" ]] || fail 'Ports 80/443 are occupied. No services were stopped. Use your existing proxy; see docs/HTTPS.md.'
    published="$(docker ps --format '{{.Ports}}')" || fail 'Could not inspect published Docker ports.'
    if printf '%s\n' "$published" | grep -Eq ':(80|443)->'; then fail 'Docker already publishes port 80/443. Use your existing proxy; see docs/HTTPS.md.'; fi
    existing="$(docker ps -aq --filter label=com.docker.compose.project=relaydesk-https)" || fail 'Could not inspect existing gateway containers.'
    [[ -z "$existing" ]] || fail 'A gateway project already exists. Recover its configuration; do not overwrite it.'
    volumes="$(docker volume ls -q --filter label=com.docker.compose.project=relaydesk-https)" || fail 'Could not inspect gateway storage.'
    [[ -z "$volumes" ]] || fail 'Gateway certificate storage already exists. Recover .https.env; certificates were not changed.'
    domain="$("${app[@]}" run --rm -T --no-deps relaydesk node src/https-cli.js domain)"
    [[ "$domain" =~ ^[a-z0-9.-]+$ ]] || fail 'Invalid configured domain.'
    caddyfile=Caddyfile
    if [[ "$domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      caddyfile=Caddyfile.ip
      printf '\nPublic IPv4 mode: this IP must route directly to this server. Short-lived IP certificates require continuous automatic renewal.\n'
    else
      command -v getent >/dev/null || fail 'getent is required for DNS verification.'
      getent ahosts "$domain" || fail 'Domain does not resolve. Set DNS first.'
    fi
    printf '\nEnable HTTPS for https://%s using a dedicated Caddy container.\nThe address must reach this server; inbound TCP 80/443 must be reachable.\nThis exposes Relaydesk publicly and requests a certificate for the address.\nNo firewall rules, existing proxy configuration or DNS records will be changed.\nCertificates renew automatically while this gateway stays running.\n' "$domain"
    read -r -p 'Address and firewall ready; enable this gateway? [Y/n]: ' answer || return 1
    answer="${answer:-y}"
    [[ "$answer" == y || "$answer" == Y ]] || exit 0
    # Atomic no-clobber creation; retain config and certificate data on failures.
    (set -o noclobber; umask 077; printf 'RELAYDESK_DOMAIN=%s\nRELAYDESK_CADDYFILE=%s\n' "$domain" "$caddyfile" > .https.env)
    "${gateway[@]}" run --rm --no-deps gateway caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    "${gateway[@]}" up -d
    printf '\nGateway started; certificate issuance may still be pending.\nRun: bash install.sh https status (checks TLS trust and expiry).\nFor errors: bash install.sh https logs\n'
    ;;
  start)
    [[ -f .https.env ]] || fail 'Enable HTTPS first.'
    "${gateway[@]}" up -d
    ;;
  status)
    if [[ -f .https.env ]]; then "${gateway[@]}" ps; fi
    "${app[@]}" run --rm -T --no-deps relaydesk node src/https-cli.js status
    ;;
  logs)
    [[ -f .https.env ]] || fail 'No managed gateway. Check your existing proxy logs.'
    "${gateway[@]}" logs --tail=100
    ;;
  disable)
    [[ -f .https.env ]] || fail 'No managed gateway to stop.'
    read -r -p 'Stop managed HTTPS? Remote panel access will stop; certificates are retained. [y/N]: ' answer
    [[ "$answer" == y || "$answer" == Y ]] || exit 0
    "${gateway[@]}" stop
    ;;
  *) fail 'Usage: bash install.sh https [enable|start|status|logs|disable]' ;;
esac
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then https_main "$@"; fi
