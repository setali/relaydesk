# Security

Relaydesk is an early MVP, not a security-audited product. The v0.2.x and v0.3.x series is in scope for fixes.

If the repository has private vulnerability reporting enabled, use the Security tab to report a vulnerability privately. Do not put working credentials or another user's information in a public issue. Before public release, the maintainer must enable private reporting and publish a monitored contact.

## Implemented boundaries

- Server-side tenant ownership on reads and writes; opaque sessions stored as SHA-256 hashes.
- Scrypt password hashing with random salts and constant-time comparison.
- Origin and per-session CSRF checks for authenticated mutations.
- HttpOnly / SameSite cookies; Secure cookies and HSTS in live mode.
- Bounded JSON requests, fixed panel destinations, TLS verification, no upstream redirects.
- Strict browser CSP and escaped dynamic display text.
- Reserved capacity for ambiguous remote operations and verified deletion.
- AES-256-GCM panel-token encryption with per-record nonces and server ID binding; separate mode-0600 master key.
- Credential changes require the current password, are rate-limited, and invalidate all sessions.
- Admin-only connection probes and server changes; servers with clients cannot be retargeted or removed.

## Operator responsibilities

Use HTTPS, isolated credentials, tested backups, and a restricted panel API. Protect the environment and SQLite files. Keep Node and container images patched. Configure edge rate limiting in addition to the application's basic per-socket-IP login limiter. Run one app process per database.

The administrator and host operator are trusted. Administrators can configure HTTPS destinations, including private addresses, so restrict administrator access. Token encryption protects a database copied without its key; a compromised host with both files can decrypt tokens. Panel tokens can have broad privileges and are not a tenant isolation boundary. The app has no MFA or public password recovery yet. Subscription URLs grant VPN access and must be handled like credentials.
