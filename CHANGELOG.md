# Changelog

## Unreleased

- Add an interactive management menu, short account recovery commands, sanitized panel information, restart and private offline data backups with service-state restoration.

- Reduce installation to one initial confirmation, the panel address, and one HTTPS confirmation; normal install/HTTPS prompts default to yes while EOF cancels safely.
- Use local HTTP port 3210 without prompting; allow an explicit `RELAYDESK_HTTP_PORT` override. Upgrade and stop confirmations remain default-no.

## 0.4.0

- Move all 3x-ui connection configuration to Settings, with first-server onboarding and automatic internal IDs.
- Add per-member multi-server assignment on creation and editing, enforced for client operations, templates and usage sync.
- Preserve existing member access during the schema v3 upgrade; new servers and members require explicit grants. Revocation does not change running VPN connections.

- Create the initial admin account with a random password automatically, assign the first server ID internally, and clarify the API token location and full panel URL prompt.

- Detect public IPv4 during setup and use it as the panel address when Enter is pressed; allow manual overrides and fall back to manual input if detection fails.

- Combine application/prerequisite consent, retry blank or invalid panel addresses, and support public IPv4 HTTPS with short-lived ACME certificates.
- Recover interrupted first-time setup into a new source directory only after checking existing data is empty (`--resume`).

- Detect Ubuntu/Debian release codenames dynamically, including Ubuntu 26.04; require the exact release/architecture's official Docker package index before changing system packages.

- Optional managed HTTPS gateway with automatic certificate renewal, occupied-port checks and persistent certificate storage.
- Server management menu and read-only HTTPS certificate status/expiry in Settings.

- One-command Linux bootstrap with pinned-source SHA-256 verification and interactive setup; no Git clone required.
- Opt-in Docker installation on clean supported Ubuntu/Debian servers; existing runtimes, installations and data are preserved.
- Bootstrap tests for checksum rejection, cancellation, recovery, and existing-runtime/data safeguards.

## 0.2.0 — Installer and settings

- Guided Docker/native setup, hidden credential entry, and generated-password support.
- Independent usernames and self-service account changes with current-password verification and session invalidation.
- Admin server discovery, read-access tests, approved inbounds, token rotation and guarded removal.
- Authenticated token encryption, separate master key, one-time legacy environment import.
- Transactional schema v1→v2 migration preserving accounts, clients and history.
- Per-template VLESS Vision flow for new clients.
- Installer, migration, persistence and authorization tests.

Limits: the adapter requires bearer-authenticated v2 inbound routes. Read probes do not prove write compatibility. HTTPS proxy setup is operator-managed. Automated tests do not access production panels.

## 0.1.0 — Initial MVP

- Admin/member accounts, allocation budgets, client creation/removal, consumption snapshots and audit log.
- Responsive UI, disposable demo, Docker packaging and isolated API tests.
