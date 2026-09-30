<p align="center"><img src="public/favicon.svg" width="64" alt="Relaydesk"></p>
<h1 align="center">Relaydesk</h1>
<p align="center">A small control room for your network and the people behind it.</p>
<p align="center">Self-hosted · Zero runtime dependencies · MIT licensed</p>

Relaydesk is an independent team workspace for **3x-ui**. An operator connects approved inbound templates; members create clients within their own allocation budget and see only their own connections and usage.

It runs as one Node.js process, serves its own interface, and stores ownership in SQLite. There is no frontend build, package install, or access to the 3x-ui database.

**Status: early MVP.** The demo and adapter contract are tested locally. Real-panel compatibility must be verified on a disposable inbound before production use. Relaydesk is not affiliated with 3x-ui or its maintainers.

## Try it in a minute

Requires **Node.js 24.12+**. Node's built-in SQLite API may print an experimental warning on this version.

```sh
npm run demo
```

Open **http://127.0.0.1:3210**. The terminal prints the demo email and a fresh random password. The demo uses an in-memory database with sample clients and consumption. Changes disappear on restart. It never connects to a real panel.

No `npm install` is needed. There are no third-party runtime or development packages.

## What works today

- Administrator and member accounts, with server-enforced ownership checks.
- Guided installer that creates an independent `admin` account with a secure random password.
- Account settings for changing your username/password; all old sessions are revoked.
- Admin server management: discover inbounds, test connections, rotate tokens, and remove unused servers.
- AES-256-GCM encryption for saved panel tokens, with a separate local master key.
- Create VLESS/VMess clients from operator-approved inbound templates.
- Per-account client slots and **allocated traffic budgets**.
- Consumption dashboard: upload, download, remaining allowance, expiry, and sync freshness.
- Multiple configured panels and templates, such as direct and tunneled connections.
- Manual traffic sync and reconciliation of uncertain creation attempts.
- Verified client removal before releasing allocated capacity.
- Subscription-link copying when the operator configures a subscription base URL.
- A recent activity log, responsive interface, and keyboard-accessible dialogs.
- Scrypt passwords, opaque server-side sessions, CSRF protection, and login throttling.

**Enabled is not online.** This version displays client eligibility, not live connection presence. Consumption is a panel snapshot, not real-time telemetry. The demo values are illustrative.

## Allocation, explained

A member with **500 GiB / 20 slots** can allocate, for example, ten 50 GiB clients. Creating a client reserves its full allowance, not just the bytes already used. Pending and uncertain operations also reserve capacity. Removing a client releases its allowance only after remote absence is confirmed.

This is an **allocation budget**, not a monthly billing ledger or lifetime consumption cap. Usage of deleted clients is not included in the dashboard. Traffic resets on the source panel are reflected in the next snapshot. Historic daily charts, billing, and pooled consumed-traffic enforcement require a separate durable usage ledger.

## Install a persistent workspace

On a Linux server, run one command (no Git or manual clone needed):

```sh
curl -fsSL https://raw.githubusercontent.com/setali/relaydesk/main/bootstrap.sh | sudo bash
```

Already root? Replace `sudo bash` with `bash`. Review the [bootstrap script](https://github.com/setali/relaydesk/blob/main/bootstrap.sh) before executing downloaded code with administrator privileges. It downloads a pinned v0.3.1 source revision, verifies SHA-256, installs under `/opt/relaydesk`, and opens the setup wizard. GitHub and Docker registries must be reachable.

Existing Docker installations are left unchanged. If Docker is missing on Ubuntu or Debian (amd64/arm64), with the required packages available in Docker’s official stable repository for that release, the installer offers an explicit opt-in installation from Docker's official apt repository. It refuses conflicting container runtimes and existing Relaydesk data. Use a public IPv4 or configure DNS for your domain first. The wizard offers automatic HTTPS on free ports 80/443; an existing reverse proxy is never modified. See [HTTPS setup](docs/HTTPS.md).

Alternatively, from a trusted source checkout with Docker and Compose already installed:

```sh
bash install.sh
```

The wizard asks for a public HTTPS origin and optionally a 3x-ui URL and token. It automatically creates the independent `admin` account and displays its random password once after setup succeeds. Save it securely; change your username/password in Settings later. The first server's internal ID is assigned automatically. The wizard verifies read access, lists supported inbounds, and lets you approve them. Token entry is hidden. Supply the full 3x-ui HTTPS URL, including any custom port and private base path.

The installer builds this checkout, stores data in a named Docker volume, starts an unprivileged container, and binds HTTP only to loopback. Choose managed HTTPS after setup, or configure your existing HTTPS reverse proxy to forward to the selected local port. It does not change your firewall or existing services. You need no hand-edited `.env` for this path.

With Node.js already installed, the native alternative is:

```sh
npm run setup
npm run start:configured
```

Open **Settings** to change your account or add/edit servers. For token-capable Sanaei releases, create a dedicated token under **Panel Settings → Authentication → API Token** (location may vary by release). Tokens are not Sanaei account passwords. Missing token support or incompatible APIs must be resolved before connecting; a read probe does not guarantee write compatibility.

See [installation and upgrades](docs/INSTALL.md) for lifecycle commands, backup, and HTTPS setup.

## Legacy environment configuration

Existing v0.1 deployments can still start from their environment:

1. Copy `.env.example` to `.env` and set a unique initial administrator password.
2. Set `PUBLIC_ORIGIN` to your exact HTTPS origin, with no trailing slash.
3. Configure `PANELS_JSON` with panel base paths, server-side bearer tokens, and approved inbounds.
4. Start behind an HTTPS reverse proxy. Keep port 3210 accessible only to that proxy.

Example configuration (all values below are placeholders):

```json
[
  {
    "id": "germany",
    "name": "Germany",
    "baseUrl": "https://panel.example.com/private-panel-path",
    "token": "REPLACE_WITH_SERVER_SIDE_TOKEN",
    "subscriptionBaseUrl": "https://subscriptions.example.com/sub",
    "inbounds": [
      { "id": 1, "name": "Germany · Direct" },
      { "id": 2, "name": "Iran → Germany · Tunnel" }
    ]
  }
]
```

Put the compact JSON array on the `PANELS_JSON` line in `.env`. On the first v0.2 start these panels are imported once into encrypted SQLite storage; subsequent changes belong in Settings. After verifying import, remove the plaintext tokens from the environment. The optional subscription base URL must point to the panel's actual subscription service. Admin and subscription base paths are independent.

```sh
node --env-file=.env src/server.js
# or
docker compose up --build -d
```

`ADMIN_EMAIL` and `ADMIN_PASSWORD` bootstrap the first account only. Changing the environment does not reset existing credentials. Demo and live mode refuse to share a database. In live mode the public origin and upstream panel connections must use HTTPS.

The adapter currently targets the **v2 inbound-scoped API**: `/panel/api/inbounds/list`, `/addClient`, and `/:inboundId/delClient/:uuid`. It requires a panel version accepting bearer-token authentication on those routes. Versions requiring cookie login, and the newer v3 `/clients` API, are not yet supported. The adapter preserves custom panel base paths, checks response envelopes, refuses redirects, and applies request timeouts.

Only VLESS and VMess are supported. For VLESS templates requiring `xtls-rprx-vision`, select Vision during setup or inbound discovery in Settings. The app does not create tunnels, listeners, or routing rules: those are configured by the operator in 3x-ui.

## Architecture

```text
Browser → Relaydesk HTTP API → ownership + allocation in SQLite
                           → version-specific adapter → 3x-ui → Xray
```

Relaydesk is outside the VPN traffic path. Existing VPN connections do not depend on its web interface remaining available. Management and metrics are unavailable while Relaydesk is down.

| Location          | Responsibility                                                     |
| ----------------- | ------------------------------------------------------------------ |
| `src/app.js`      | HTTP routes, authorization, allocation, operation lifecycle        |
| `src/security.js` | Password hashing, session helpers, validation                      |
| `src/db.js`       | Schema and audit persistence                                       |
| `src/panel.js`    | 3x-ui adapter and deterministic demo adapter                       |
| `src/config.js`   | Operator-only server and template configuration                    |
| `public/`         | Responsive, dependency-free browser application                    |
| `test/`           | HTTP security, isolation, failure handling, adapter contract tests |

`src/settings.js` handles authenticated settings; `src/panel-store.js` owns encrypted server storage; `src/setup.js` implements the testable setup wizard. See [architecture decisions](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md), and [security](SECURITY.md).

## Development

```sh
npm run check
npm run demo
```

Tests start loopback HTTP servers and in-memory databases. They cover cross-account access, forged ownership, origin/CSRF checks, simultaneous quota allocation, duplicate requests, uncertain remote writes, failed deletion, and stale statistics. Adapter tests use mocked panel responses; they are not a substitute for a live compatibility check.

## Deliberately next

- Renew, edit, suspend, and resume clients while preserving remote protocol fields.
- Per-member template grants, account suspension, web-based password recovery, and 2FA.
- A v3 adapter and published, reproducible compatibility matrix.
- Scheduled collection with a historical traffic ledger and quota-period accounting.
- Persian/RTL UI, subscription QR codes, and read-only end-user views.

There are no billing, payment, or provisioning agents in this release. Start with one instance and a small trusted deployment. See [the release checklist](docs/RELEASING.md) before publishing a production release.

## Contributing and license

Small, well-tested contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md). Relaydesk's original code is licensed under [MIT](LICENSE). Upstream 3x-ui is a separate project with its own license; no upstream source code is bundled here.
