# Install and upgrade

## Guided Docker installation

For a Linux server, run:

```sh
curl -fsSL https://raw.githubusercontent.com/setali/relaydesk/main/bootstrap.sh | sudo bash
```

Use `bash` instead of `sudo bash` if already logged in as root. This is an interactive installer; it reads prompts from your terminal even when piped. No Git, Node.js, GitHub token, or manual clone is required. Bash, curl, tar and sha256sum must be present. It installs under `/opt/relaydesk` and downloads the reviewed v0.3.1 application revision `c4104e07e0782f30414955c62e568a7dd670d5a7`, not a moving branch archive. SHA-256 verification happens before extraction or execution. A checksum mismatch stops installation.

**Trust boundary:** the entry script is fetched from this repository's `main` branch. Its pinned archive checksum detects changed or incomplete downloads; it is not an independent signature against a compromised repository. Review the script before running it with root privileges. To inspect it first:

```sh
curl -fSL https://raw.githubusercontent.com/setali/relaydesk/main/bootstrap.sh -o relaydesk-bootstrap.sh
less relaydesk-bootstrap.sh
sudo bash relaydesk-bootstrap.sh
```

The server must reach GitHub, Docker Hub and (only for optional Docker installation) Docker's apt repository and OS package mirrors. Failed downloads stop safely; do not disable TLS verification or use an untrusted mirror.

Existing Docker is reused, never upgraded, restarted or reconfigured by the bootstrap. If it lacks Compose or is unhealthy, fix that yourself and rerun. If Docker is absent, Ubuntu and Debian on amd64/arm64 with the required packages in Docker’s official stable repository can opt in to adding Docker's official apt repository and installing Docker Engine, Compose, Buildx and containerd. This changes system packages and Docker networking/firewall rules, and starts the daemon. The initial installation confirmation covers these disclosed prerequisites; there is no second Docker confirmation. Existing/conflicting runtimes, runtime data, or a Docker apt repository require manual installation; nothing is uninstalled. No users are added to the docker group. Other Linux distributions require Docker preinstalled. Package changes are not automatically rolled back if a later step fails.

The package-installation procedure follows the official [Ubuntu](https://docs.docker.com/engine/install/ubuntu/) and [Debian](https://docs.docker.com/engine/install/debian/) instructions. On shared hosts, review their firewall guidance before opting in. Relaydesk itself publishes HTTP on loopback only.

Existing `/opt/relaydesk` paths (including symlinks), Compose projects named `relaydesk`, and the `relaydesk_relaydesk-data` volume are refused. This entry point is for first-time installation, not upgrades. If the wizard fails after source extraction, files remain for recovery: run `sudo bash /opt/relaydesk/install.sh` to retry initial setup only when it has not yet created data. Never delete a database or volume to get past a setup refusal.

To manage a successful one-command installation from any directory:

```sh
sudo bash /opt/relaydesk/install.sh status
sudo bash /opt/relaydesk/install.sh logs
sudo bash /opt/relaydesk/install.sh stop
sudo bash /opt/relaydesk/install.sh start
```

For a manually downloaded or cloned trusted checkout, run from that directory:

```sh
bash install.sh
```

The local `install.sh` requires Bash, Docker Engine, Compose with `up --wait-timeout`, and permission to use Docker. It builds the downloaded source and runs the wizard; dependency installation belongs to `bootstrap.sh` only.

The wizard asks for a local HTTP port, panel domain/public IPv4 (HTTPS is added automatically), and optionally the first 3x-ui connection. It checks `https://api.ipify.org` once during setup (three-second timeout) and shows the detected public IPv4 as the address default: press Enter to accept it or enter a different IP/domain. If detection fails, enter the address manually. Behind NAT, verify the detected outbound IP actually reaches this server.

Setup automatically creates the independent `admin` account with a cryptographically random password, displayed once after successful setup. Save it securely. The initial contact is `admin@relaydesk.local`; no mailbox is required. You can change your username/password in Settings. Existing accounts are never reset by setup.

For the optional 3x-ui connection, supply a display name, full HTTPS panel URL (including any custom port and private path, for example `https://panel.example.com:2053/your-path/`), API token, optional subscription URL, and approved inbound IDs. Its internal server ID is assigned automatically; it is not a value from 3x-ui. Select Vision only when required by a VLESS inbound. Token input is hidden.

Failed panel verification stops before creating an installation. Existing databases are never overwritten. You can skip the panel and add it in Settings later. No hand-edited `.env` is required.

The Compose project is `relaydesk`; its named `relaydesk_relaydesk-data` volume holds `runtime.json`, `relaydesk.sqlite`, and `master.key`. Do not take over an unrelated Compose project with that name. `.install.env` stores only the selected local port. Keep the checkout for lifecycle commands:

```sh
bash install.sh status
bash install.sh logs
bash install.sh stop
bash install.sh start
```

If setup succeeded but startup failed, fix the conflict (such as a busy port) and run `start`. If setup was interrupted after creating its database, preserve the data and recover configuration rather than deleting the volume. Initial setup will refuse to erase it.

## Interrupted first setup

If initial setup exited before saving an account (for example after a blank address), do not delete the volume. Use:

```sh
curl -fsSL https://raw.githubusercontent.com/setali/relaydesk/main/bootstrap.sh | sudo bash -s -- --resume
```

This keeps the old source directory and downloads the verified revision into `/opt/relaydesk-<revision>`. It refuses existing app containers and checks the existing data volume read-only: only an entirely empty volume can be reused. A populated or unreadable volume is never overwritten. This is not an upgrade or credential-reset command. On subsequent interruption, use the exact `install.sh` path printed by that run. Root users can omit `sudo`.

## HTTPS

Choose automatic HTTPS at the end of setup, or run `sudo relaydesk https enable`. See [HTTPS and the management menu](HTTPS.md) for automatic renewal, shared-server safeguards and recovery.

For an existing proxy, the container listens on host loopback only. Point your domain at the server and configure an HTTPS proxy to the chosen port. For a host-installed Caddy instance:

```caddy
relay.example.com {
    reverse_proxy 127.0.0.1:3210
}
```

Replace the hostname and port. Add this to your existing proxy configuration as appropriate; do not overwrite unrelated services. The browser origin must exactly match the setup origin. DNS and existing proxy routing are operator-managed; the optional dedicated gateway manages its own certificates. A process health check does not verify them.

## Getting a token

In token-capable Sanaei releases, open **Panel Settings → Authentication → API Token** and create a dedicated credential. A login password is not an API token. UI placement varies by release; consult the [official 3x-ui project](https://github.com/MHSanaei/3x-ui).

This release requires bearer authentication on v2 inbound-scoped routes. Cookie-only or v3-only APIs need another adapter. The installer probes read access and response shape, not all write endpoints. Test creation, consumption sync and removal on a disposable client before production. Relaydesk never upgrades 3x-ui automatically.

## Settings

Sign in using the independent Relaydesk account. Settings lets every user change their display name, username and password after verifying the current password. Saving invalidates all that user's sessions, including the current one.

Admins can connect servers, discover and approve inbounds, test existing connections, rotate tokens and remove unused servers. Blank token on edit keeps the old token; the backend never returns stored plaintext. Servers with managed clients cannot be removed or retargeted, and in-use inbounds cannot be unapproved. All members currently share the approved template set.

## Native installation

With Node.js 24.12+ installed:

```sh
npm run setup
npm run start:configured
```

There are no npm dependencies to install. Default storage is `./data`. Set `RELAYDESK_CONFIG` for another runtime-file location. Use the same non-root OS account for setup and service execution; configure your own supervisor. Docker supplies the managed restart and health-check path.

## Upgrade from v0.1

Stop the old service and back up its data/environment. Keep its original database volume and deployment method; do not run initial setup over it. Startup migrates v1 to v2 transactionally, preserves accounts and clients, and initializes usernames from existing email logins.

`PANELS_JSON` is imported once into encrypted storage. Subsequent settings edits are authoritative and are not overwritten on restart. After verifying import, remove plaintext panel tokens from the legacy environment and back up the new master key.

## Later upgrades, backup and recovery

Stop the service and back up the complete data volume: SQLite and any WAL/SHM companions, `runtime.json`, and **master.key**. Losing the key makes stored tokens unrecoverable. Protect backups and test restoration.

Review and check out a trusted release, then run `bash install.sh upgrade`. It asks you to confirm a backup, builds the checked-out source, and restarts with existing data; it does not download code. To roll back a schema migration, restore the previous release with its matching pre-upgrade data snapshot.

Bootstrap installations are source archives, not Git checkouts. For upgrades, back up data first, download and verify the next trusted source revision into a separate directory, and retain `.install.env` and `.https.env` (if enabled) from the old installation. Run the new directory's `install.sh upgrade` against the same Compose project/volume. Keep the old source and matching data backup for rollback. Rerunning `bootstrap.sh` will not overwrite an existing installation.

For local operator password recovery, stop the service and run:

```sh
docker compose --project-name relaydesk --file compose.install.yaml --env-file .install.env run --rm --no-deps relaydesk node src/reset-password.js YOUR_USERNAME
bash install.sh start
```

The recovery command prompts privately and revokes existing sessions. There is no unauthenticated web recovery route.
