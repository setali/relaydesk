#!/usr/bin/env bash
# Run only in the disposable, read-only Debian container documented in CI.
set -euo pipefail
[[ "${RELAYDESK_PACKAGE_FIXTURE:-}" == 1 && -f /.dockerenv ]] || { echo 'Disposable container fixture only.' >&2; exit 1; }
# shellcheck source=/dev/null
source /workspace/bootstrap.sh
workdir="$(mktemp -d)"
export workdir
apt-get() { printf '%s\n' "$*" >> "$workdir/packages.log"; }
download() { printf 'synthetic test key\n' > "$2"; }
dpkg-query() { return 1; }
confirm() { return 0; }

if (confirm() { return 1; }; install_docker); then echo 'Decline unexpectedly succeeded'; exit 1; fi
[[ ! -e "$workdir/packages.log" ]]
[[ ! -e /etc/apt/sources.list.d/relaydesk-docker.sources ]]

if (dpkg-query() { printf installed; }; install_docker); then echo 'Runtime conflict unexpectedly succeeded'; exit 1; fi
[[ ! -e "$workdir/packages.log" ]]

install_docker
[[ "$(wc -l < "$workdir/packages.log")" == 4 ]]
grep -q -- 'install -y --no-remove docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin' "$workdir/packages.log"
grep -q 'https://download.docker.com/linux/debian' /etc/apt/sources.list.d/relaydesk-docker.sources
grep -q 'Signed-By: /etc/apt/keyrings/relaydesk-docker.asc' /etc/apt/sources.list.d/relaydesk-docker.sources
[[ -f /etc/apt/keyrings/relaydesk-docker.asc ]]
if (install_docker); then echo 'Existing repository unexpectedly overwritten'; exit 1; fi
[[ "$(wc -l < "$workdir/packages.log")" == 4 ]]
printf 'Docker package-plan checks passed; package installation and key downloads were simulated.\n'
