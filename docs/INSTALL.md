# Install and upgrade

## Guided Docker installation

For a Linux server, run:

```sh
curl -fsSL https://raw.githubusercontent.com/setali/relaydesk/main/bootstrap.sh | sudo bash
```

Use `bash` instead of `sudo bash` if already logged in as root. This is an interactive installer; it reads prompts from your terminal even when piped. No Git, Node.js, GitHub token, or manual clone is required. Bash, curl, tar and sha256sum must be present. It installs under `/opt/relaydesk` and downloads the reviewed v0.4.1 application revision `2d05e0a615ef92db4a7412b478f7ad9b0519134b`, not a moving branch archive. SHA-256 verification happens before extraction or execution. A checksum mismatch stops installation.

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

The normal flow has three prompts: confirm installation, choose Relaydesk's address, and confirm HTTPS. Installation and HTTPS default to yes; type `n` to decline. Ending input cancels rather than accepting. Stop/upgrade confirmations remain default-no. The local HTTP port is 3210 without a question; advanced installations may set `RELAYDESK_HTTP_PORT` in the installer's environment before setup.

The address prompt checks `https://api.ipify.org` once during setup (three-second timeout) and shows the detected public IPv4 as the default: press Enter to accept it or enter a different IP/domain. HTTPS is added automatically. If detection fails, enter the address manually. Behind NAT, verify the detected outbound IP actually reaches this server.

Setup automatically creates the independent `admin` account with a cryptographically random password, displayed once after successful setup. Save it securely. The initial contact is `admin@relaydesk.local`; no mailbox is required. You can change your username/password in Settings. Existing accounts are never reset by setup.

After signing in, use **Settings → Connect server** for each 3x-ui panel. Supply a display name, full HTTPS panel URL (including any custom port and private path, for example `https://panel.example.com:2053/your-path/`), API token and optional subscription URL. Test the connection, select approved inbounds, then save. The internal server ID is generated automatically. Select Vision only when required by a VLESS inbound. Token input is hidden.

Failed panel verification shows an error in the browser without affecting the Relaydesk installation. Existing databases are never overwritten. No hand-edited `.env` is required.

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

This release requires bearer authentication on v2 inbound-scoped routes. Cookie-only or v3-only APIs need another adapter. The Settings connection test probes read access and response shape, not all write endpoints. Test creation, consumption sync and removal on a disposable client before production. Relaydesk never upgrades 3x-ui automatically.

## Settings

Sign in using the independent Relaydesk account. Settings lets every user change their display name, username and password after verifying the current password. Saving invalidates all that user's sessions, including the current one.

Admins can connect multiple servers, discover and approve inbounds, test connections, rotate tokens and remove unused servers. Blank token on edit keeps the old token; the backend never returns stored plaintext. Servers with managed clients cannot be removed or retargeted, and in-use inbounds cannot be unapproved.

Select **Allowed servers** when creating a member; edit them with **Manage server access**. An empty selection grants nothing. Access checks protect template discovery, client reads/creation/deletion, request replay and usage sync. New servers require explicit assignment. Revoking access does not delete or disable existing VPN clients and does not release their allocation. Administrators can still manage them. Access edits wait for that member's in-flight operations.

## Native installation

With Node.js 24.12+ installed:

```sh
npm run setup
npm run start:configured
```

There are no npm dependencies to install. Default storage is `./data`. Set `RELAYDESK_CONFIG` for another runtime-file location. Use the same non-root OS account for setup and service execution; configure your own supervisor. Docker supplies the managed restart and health-check path.

## Upgrade from v0.1

Stop the old service and back up its data/environment. Keep its original database volume and deployment method; do not run initial setup over it. Startup upgrades the schema to v3, preserving accounts, clients and history. The v1 upgrade initializes usernames from existing email logins. The v3 upgrade grants existing members access to currently configured servers once, preserving previous behavior; review these grants after upgrading. Later servers are not granted automatically, and removed grants stay removed across restarts. Older releases reject a v3 database: rollback requires the previous release and its matching pre-upgrade data snapshot. Do not run old and new versions against the same database.

`PANELS_JSON` is imported once into encrypted storage. Subsequent settings edits are authoritative and are not overwritten on restart. After verifying import, remove plaintext panel tokens from the legacy environment and back up the new master key.

## Later upgrades, backup and recovery

Stop the service and back up the complete data volume: SQLite and any WAL/SHM companions, `runtime.json`, and **master.key**. Losing the key makes stored tokens unrecoverable. Protect backups and test restoration.

Review and check out a trusted release, then run `bash install.sh upgrade`. It asks you to confirm a backup, builds the checked-out source, and restarts with existing data; it does not download code. To roll back a schema migration, restore the previous release with its matching pre-upgrade data snapshot.

Bootstrap installations are source archives, not Git checkouts. For upgrades, back up data first, download and verify the next trusted source revision into a separate directory, and retain `.install.env` and `.https.env` (if enabled) from the old installation. Run the new directory's `install.sh upgrade` against the same Compose project/volume. Keep the old source and matching data backup for rollback. Rerunning `bootstrap.sh` will not overwrite an existing installation.

For local operator password recovery, run:

```sh
relaydesk reset-password
```

Choose an account (the single administrator is the default). Enter and confirm a custom password, or press Enter to generate one. Confirm the change; a generated password is shown once after saving. Existing sessions for that account are revoked. Passwords are never command-line arguments. The command briefly stops the application and restores its previous running state after success, failure or cancellation. An already-stopped application stays stopped. There is no unauthenticated web recovery route.

Run `relaydesk` for the interactive menu, or use:

| Command                                                  | Action                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `relaydesk info`                                         | Version, public URL and account names; never passwords or API tokens              |
| `relaydesk status`                                       | Application container state                                                       |
| `relaydesk start` / `stop` / `restart`                   | Control the application; start also starts a configured gateway                   |
| `relaydesk logs`                                         | Latest 100 application log lines, then return                                     |
| `relaydesk reset-password`                               | Custom or generated password recovery                                             |
| `relaydesk change-username`                              | Rename an account and revoke its sessions                                         |
| `relaydesk backup`                                       | Private offline data backup; restore previous service state                       |
| `relaydesk https enable` / `status` / `logs` / `disable` | Manage the dedicated HTTPS gateway                                                |
| `relaydesk upgrade`                                      | Build a reviewed source checkout after backup confirmation; no automatic download |
| `relaydesk help`                                         | Commands, without needing Docker to be running                                    |

In a manual checkout without the launcher, replace `relaydesk` with `bash install.sh`. Backups are saved under the installation's private `backups/backup-*` directory. They include the complete application data archive (database, runtime settings and encryption key), local port/gateway settings and package version. Treat them as credentials. Gateway certificate volumes and the full source release are not included; retain the matching source release and back up gateway storage separately. A failed backup directory is incomplete and must not be restored. Restoration is not automated: stop the service and follow a reviewed recovery procedure with the matching release and data snapshot.
