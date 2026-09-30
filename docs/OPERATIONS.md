# Operating Relaydesk

## Before a live connection

Use a disposable panel/inbound first. Confirm the installed version implements the v2 inbound API with bearer authentication. Create one low-quota client, fetch its subscription, send test traffic, sync, and compare upload/download and expiry with 3x-ui. Remove the client and verify it is absent from both systems. Repeat against every supported panel version before announcing compatibility.

Existing panel clients are never automatically imported or reassigned. Relaydesk only manages the UUIDs it creates. Choose dedicated approved inbounds where practical. Select Vision for VLESS templates that require that flow.

## HTTPS and proxying

Set `PUBLIC_ORIGIN=https://relay.example.com`. Proxy that hostname to `127.0.0.1:3210`, preserving the browser Origin header. Docker Compose publishes only on loopback. The application trusts the configured origin and does not trust forwarded IP headers. With a reverse proxy, application login throttling applies to the proxy's socket IP; configure additional per-client limits at the trusted edge.

Example Caddy configuration for a host-installed proxy:

```caddy
relay.example.com {
    reverse_proxy 127.0.0.1:3210
}
```

Do not include panel tokens or subscription URLs in access logs. Sessions expire after eight hours. Live cookies are HttpOnly, SameSite=Strict, and Secure. The `GET /healthz` probe establishes process availability only; it does not certify panel connectivity.

## Storage and backup

The database contains account password hashes, sessions, client identities, and ownership mappings. Protect the containing directory and backups. The app creates a new directory with mode 0700 and database file with mode 0600. The container runs as the unprivileged `node` user.

Back up `master.key` and `runtime.json` together with the SQLite database. Token ciphertext cannot be recovered without the original master key. The installer stores all three in its Docker volume. For legacy environment installs, back up the environment as well. Use SQLite's online backup mechanism, or stop the service before copying the database and any WAL/SHM companions. Do not copy only a live WAL-mode database file. Test restore before relying on a backup.

On upgrade, back up first, run the test suite, review compatibility changes, then restart a single instance. Do not run multiple replicas against the SQLite volume. Rollback requires both the previous application and a compatible database snapshot.

## Uncertain operations

If a create request is in review, click Sync. A matching remote UUID and email reconciles the client to active. If the client was never created, remove the review entry through the app; it verifies remote absence before freeing the allocation. If the server cannot be contacted or the inbound no longer exists, repair the configuration first. Do not delete SQLite rows to bypass capacity checks.

An API token may carry panel administrator authority. Settings stores it encrypted and never returns it to the browser. Limit network access to the panel API and rotate tokens if exposed. The MVP does not narrow upstream token privileges; ownership checks are enforced by Relaydesk.

## Credential recovery

`npm run reset-password -- account@example.com` prompts for a replacement password through stdin and invalidates that account's sessions. Stop the application before running it against its database and use the same DATABASE_PATH. This is a local operator command; there is no unauthenticated web recovery route.

## Limits of this release

No automatic synchronization, per-member template grants, client renewal, billing ledger, or production compatibility guarantee. The usage dashboard is a manual snapshot and its status labels describe enabled/expired/quota state, not real-time online presence. Docker build and browser behavior should be validated on your target platform before deployment.
