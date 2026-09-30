# Install and upgrade

## Guided Docker installation

Download or clone a trusted Relaydesk release, review it, then run from that directory:

```sh
bash install.sh
```

Requires Bash, Docker Engine, Compose with `up --wait`, and permission to use Docker. The installer builds the checked-out source; it does not install Docker or execute remote shell scripts.

The wizard asks for a local HTTP port, public HTTPS origin, independent Relaydesk username/email/password, and optionally the first 3x-ui connection. For that connection, supply the full panel URL, API token, optional subscription URL, and approved inbound IDs. Select Vision only when required by a VLESS inbound. Password and token input are hidden. Leaving the password blank generates one and displays it once.

Failed panel verification stops before creating an installation. Existing databases are never overwritten. You can skip the panel and add it in Settings later. No hand-edited `.env` is required.

The Compose project is `relaydesk`; its named `relaydesk_relaydesk-data` volume holds `runtime.json`, `relaydesk.sqlite`, and `master.key`. Do not take over an unrelated Compose project with that name. `.install.env` stores only the selected local port. Keep the checkout for lifecycle commands:

```sh
bash install.sh status
bash install.sh logs
bash install.sh stop
bash install.sh start
```

If setup succeeded but startup failed, fix the conflict (such as a busy port) and run `start`. If setup was interrupted after creating its database, preserve the data and recover configuration rather than deleting the volume. Initial setup will refuse to erase it.

## HTTPS

The container listens on host loopback only. Point your domain at the server and configure an HTTPS proxy to the chosen port. For a host-installed Caddy instance:

```caddy
relay.example.com {
    reverse_proxy 127.0.0.1:3210
}
```

Replace the hostname and port. Add this to your existing proxy configuration as appropriate; do not overwrite unrelated services. The browser origin must exactly match the setup origin. Certificates, DNS and proxy routing are operator-managed. A process health check does not verify them.

## Getting a token

In token-capable Sanaei releases, open **Panel Settings → API Tokens** and create a dedicated credential. A login password is not an API token. UI placement varies by release; consult the [official 3x-ui project](https://github.com/MHSanaei/3x-ui).

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

For local operator password recovery, stop the service and run:

```sh
docker compose --project-name relaydesk --file compose.install.yaml --env-file .install.env run --rm --no-deps relaydesk node src/reset-password.js YOUR_USERNAME
bash install.sh start
```

The recovery command prompts privately and revokes existing sessions. There is no unauthenticated web recovery route.
