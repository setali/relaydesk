#!/usr/bin/env bash
# Public entry point. Downloads a reviewed source revision, never a moving archive.
set -euo pipefail

RELAYDESK_REVISION='c4104e07e0782f30414955c62e568a7dd670d5a7'
RELAYDESK_SHA256='80380bdf8ba51f5224c51c8b6c6725fc37199a96b358504dbef8c6cb00592fd0'
RELAYDESK_DIRECTORY='/opt/relaydesk'
resume_install=false

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
download() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --tlsv1.2 --connect-timeout 20 --max-time 300 --retry 2 "$1" -o "$2"
}
confirm() {
  local answer
  read -r -p "$1 [y/N]: " answer
  [[ "$answer" == y || "$answer" == Y ]]
}
verify_archive() {
  local checksum
  checksum="$(sha256sum "$1")"
  [[ "${checksum%% *}" == "$RELAYDESK_SHA256" ]] || die 'Source checksum mismatch. Nothing will be installed.'
}
check_destination() {
  [[ ! -e "$RELAYDESK_DIRECTORY" && ! -L "$RELAYDESK_DIRECTORY" ]] || \
    die "An installation path already exists at $RELAYDESK_DIRECTORY. It was not modified. See docs/INSTALL.md for recovery or upgrades."
}
check_docker() {
  local existing
  docker info >/dev/null 2>&1 || die 'Docker is unavailable. Start or repair it yourself; no daemon settings were changed.'
  docker compose version >/dev/null 2>&1 || die 'Install the Docker Compose plugin first; the existing Docker installation was not modified.'
  docker compose up --help | grep -q -- '--wait-timeout' || die 'Docker Compose is too old; upgrade it manually to support --wait-timeout.'
  existing="$(docker ps -aq --filter label=com.docker.compose.project=relaydesk)" || die 'Unable to inspect existing containers.'
  [[ -z "$existing" ]] || \
    die 'A relaydesk Compose project already exists. Refusing to take it over.'
  existing="$(docker volume ls -q --filter name='^relaydesk_relaydesk-data$')" || die 'Unable to inspect existing data volumes.'
  if [[ -n "$existing" ]]; then
    [[ "$resume_install" == true ]] || die 'An existing Relaydesk data volume was found. Preserve it and follow the recovery guide.'
    docker run --rm --read-only --network none --cap-drop=ALL --security-opt=no-new-privileges:true \
      --mount type=volume,source=relaydesk_relaydesk-data,target=/check,readonly \
      node:24.12.0-alpine@sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8 \
      node -e 'if(require("node:fs").readdirSync("/check").length) process.exit(1)' || \
      die 'The existing data volume is not empty (or could not be checked). Nothing was replaced; use the recovery guide.'
  fi
}
docker_repository() {
  local distro="$1" codename="$2" architecture="$3" package
  case "$distro" in ubuntu|debian) ;; *) die 'Automatic Docker setup supports Ubuntu and Debian. Install Docker manually on other distributions.' ;; esac
  [[ "$codename" =~ ^[a-z][a-z0-9-]*$ ]] || die 'Missing or invalid distribution codename; refusing to guess another release.'
  case "$architecture" in amd64|arm64) ;; *) die 'Automatic setup supports amd64 and arm64 only.' ;; esac
  download "https://download.docker.com/linux/$distro/dists/$codename/stable/binary-$architecture/Packages.gz" "$workdir/docker-packages.gz" || \
    die "Cannot fetch Docker's official stable packages for $distro/$codename/$architecture. Check network access or install Docker manually. No packages were changed."
  gzip -dc "$workdir/docker-packages.gz" > "$workdir/docker-packages" || die 'Invalid Docker package index. No packages were changed.'
  for package in docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; do
    grep -Fxq "Package: $package" "$workdir/docker-packages" || die "Docker's repository lacks $package for $distro/$codename/$architecture. No packages were changed."
  done
}
docker_notice() {
  printf '\nMissing prerequisites: Docker Engine, Compose, Buildx and containerd.\nInstalling them adds Docker\047s official apt repository and starts Docker.\nDocker creates networking/firewall rules; review this on shared servers.\nExisting runtimes and user permissions will not be replaced.\n'
}
install_docker() {
  # Never remove conflicting runtimes or overwrite an existing package repository.
  local ID='' VERSION_CODENAME='' architecture package status
  [[ -r /etc/os-release ]] || die 'Install Docker manually on this distribution.'
  # shellcheck source=/dev/null
  . /etc/os-release
  case "$ID" in
    ubuntu|debian) ;;
    *) die 'Automatic Docker setup supports Ubuntu and Debian. Install Docker manually on other distributions.' ;;
  esac
  for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc docker-ce docker-ce-cli containerd.io; do
    status="$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)"
    [[ "$status" != installed ]] || die "Existing package $package requires manual Docker setup. No packages were removed."
  done
  [[ ! -e /var/lib/docker && ! -e /var/lib/containerd && ! -e /etc/docker ]] || \
    die 'Existing container runtime data/configuration found. Install Docker manually to preserve it.'
  [[ ! -e /etc/apt/keyrings/relaydesk-docker.asc && ! -L /etc/apt/keyrings/relaydesk-docker.asc ]] || die 'Docker repository key path already exists.'
  [[ ! -e /etc/apt/sources.list.d/relaydesk-docker.sources && ! -L /etc/apt/sources.list.d/relaydesk-docker.sources ]] || die 'Docker repository path already exists.'
  if grep -rsq 'download.docker.com' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
    die 'A Docker package repository already exists. Complete Docker installation manually.'
  fi
  architecture="$(dpkg --print-architecture)"
  case "$architecture" in amd64|arm64) ;; *) die 'Automatic setup supports amd64 and arm64 only.' ;; esac
  if [[ "${1:-}" != approved ]]; then
    docker_notice
    confirm 'Install these system packages now?' || die 'Docker installation declined. No system packages were changed.'
  fi
  docker_repository "$ID" "$VERSION_CODENAME" "$architecture"
  apt-get update
  apt-get install -y --no-remove ca-certificates curl
  download "https://download.docker.com/linux/$ID/gpg" "$workdir/docker.asc"
  install -d -m 0755 /etc/apt/keyrings
  install -m 0644 "$workdir/docker.asc" /etc/apt/keyrings/relaydesk-docker.asc
  (umask 022; printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/relaydesk-docker.asc\n' \
    "$ID" "$VERSION_CODENAME" "$architecture" > /etc/apt/sources.list.d/relaydesk-docker.sources)
  apt-get update
  apt-get install -y --no-remove docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  printf 'Docker packages installed. If later steps fail, they remain installed; no automatic rollback is attempted.\n'
}
require_terminal() {
  [[ "$(uname -s)" == Linux ]] || die 'This installer targets Linux servers. For local demos use npm run demo.'
  [[ $EUID == 0 ]] || die 'Run with sudo bash (or as root).'
  # Reopen the terminal when the script arrives through a pipe. Secrets stay interactive.
  if [[ ! -t 0 ]]; then exec </dev/tty || die 'An interactive terminal is required.'; fi
  [[ -t 0 ]] || die 'An interactive terminal is required.'
}
main() {
  [[ "${1:-}" != --help ]] || { printf 'Relaydesk first-time installer: sudo bash bootstrap.sh\nInstalls reviewed source under /opt/relaydesk. Requires a terminal and HTTPS reverse proxy.\n'; return; }
  if [[ "${1:-}" == --resume ]]; then
    resume_install=true
    RELAYDESK_DIRECTORY="/opt/relaydesk-${RELAYDESK_REVISION:0:12}"
    shift
  fi
  [[ $# == 0 ]] || die 'Usage: sudo bash bootstrap.sh [--help|--resume]'
  require_terminal
  for tool in curl tar gzip sha256sum mktemp install grep; do
    command -v "$tool" >/dev/null || die "Missing prerequisite: $tool"
  done
  check_destination
  printf '\nRelaydesk · guided installation\nSource: https://github.com/setali/relaydesk\nRevision: %s\nDirectory: %s\n\nThis installs the management workspace only. It does not configure 3x-ui,\nVPN routing, DNS or existing proxies. HTTP binds to loopback.\nThe wizard can set up a dedicated HTTPS gateway with your confirmation.\n' "$RELAYDESK_REVISION" "$RELAYDESK_DIRECTORY"
  if ! command -v docker >/dev/null 2>&1; then docker_notice; fi
  confirm 'Install Relaydesk and any missing prerequisites described above?' || die 'Installation cancelled.'
  workdir="$(mktemp -d -t relaydesk-install.XXXXXXXX)"
  # Remove only the private, newly-created download directory. Never remove installation data.
  trap 'rm -rf -- "$workdir"' EXIT
  download "https://codeload.github.com/setali/relaydesk/tar.gz/$RELAYDESK_REVISION" "$workdir/source.tar.gz"
  verify_archive "$workdir/source.tar.gz"
  if command -v docker >/dev/null 2>&1; then
    check_docker
  else
    install_docker approved
    check_docker
  fi
  install -d -m 0700 "$workdir/source"
  tar -xzf "$workdir/source.tar.gz" --strip-components=1 -C "$workdir/source" --no-same-owner --no-same-permissions
  [[ -f "$workdir/source/install.sh" && -f "$workdir/source/compose.install.yaml" ]] || die 'Invalid source archive.'
  check_destination
  # mkdir refuses concurrent installs. Leave files in place on failure for recovery.
  mkdir -m 0755 "$RELAYDESK_DIRECTORY"
  cp -R "$workdir/source/." "$RELAYDESK_DIRECTORY/"
  chmod 0755 "$RELAYDESK_DIRECTORY"
  printf '\nSource verified. Starting the setup wizard.\nIf interrupted, use: sudo bash %s/install.sh\n' "$RELAYDESK_DIRECTORY"
  bash "$RELAYDESK_DIRECTORY/install.sh"
  if [[ -f "$RELAYDESK_DIRECTORY/relaydesk" && ! -e /usr/local/bin/relaydesk && ! -L /usr/local/bin/relaydesk ]]; then
    install -d -m 0755 /usr/local/bin
    chmod 0755 "$RELAYDESK_DIRECTORY/relaydesk"
    ln -s "$RELAYDESK_DIRECTORY/relaydesk" /usr/local/bin/relaydesk
  fi
  printf '\nManagement menu: sudo bash %s/install.sh menu\nHTTPS setup: sudo bash %s/install.sh https enable\nSee %s/docs/HTTPS.md for certificate guidance.\n' "$RELAYDESK_DIRECTORY" "$RELAYDESK_DIRECTORY" "$RELAYDESK_DIRECTORY"
}

# Keep execution at the end so an incomplete streamed download cannot start installation.
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
