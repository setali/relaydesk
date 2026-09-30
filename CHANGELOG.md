# Changelog

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
