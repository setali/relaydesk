# Architecture decisions

## One process, one database, no build step

The initial deployment target is a small VPS. Node.js supplies HTTP, crypto, fetch, testing, and SQLite; browser modules supply the interface. This avoids a framework toolchain and extra network services while leaving the panel adapter independent. The intended topology is one Relaydesk process per database. Horizontal replication is not supported.

The built-in SQLite API is synchronous. The database performs short indexed queries; remote HTTP requests and scrypt hashing are asynchronous. WAL mode and a busy timeout support backups and inspection. Schema v2 migrates v1 transactionally using `PRAGMA user_version`, adds usernames and encrypted panel storage, and refuses databases from newer versions.

## Trust and ownership

The browser is untrusted. Member ownership is derived from the authenticated session, never from a submitted owner ID. Admins can assign clients to any account. Queries and mutation lookups independently enforce ownership. The browser receives neither panel tokens nor password hashes.

Panel credentials and base URLs come from administrators, never from member input. Server management validates HTTPS, probes the inbound API, and persists tokens using AES-256-GCM. API responses never return stored tokens or password hashes. All configured templates are available to all members; per-account template grants are future work.

The interface escapes dynamic text before creating HTML. A same-origin content security policy disallows inline scripts and framing. No third-party fonts, analytics, or assets are fetched.

## Remote operations are not transactions

SQLite and 3x-ui cannot share an atomic transaction. Client creation therefore reserves local capacity before calling the panel, using a request ID as an idempotency key. The reservation is synchronous with the capacity check within the single process. A retry returns the recorded operation rather than creating a new remote identity.

The lifecycle is `pending → active` after confirmation, or `pending → review` after an ambiguous error. Interrupted operations become `review` on restart. UUID and remote email are fixed before the request. Sync can recognize that same identity and reconcile it to active. An absent remote client stays in review until removal is explicitly requested and absence verified. This favors conservative capacity accounting over automatic cleanup.

Deletion checks the remote inbound and identity, requests removal if present, then reads the panel again to prove absence before marking the local row deleted. A failure reserves capacity and marks review. The activity log and local tombstone remain.

Per-client locks prevent concurrent writes within the single process. A per-user sync lock prevents duplicate refreshes. Usage collection skips a client with an in-flight write. Historical consumption across deletion/reset is deliberately not inferred from snapshots.

## Integration boundary

`ThreeXUI` implements three operations: snapshot, create, and remove. The v2 adapter uses inbound-scoped routes and VLESS/VMess UUID identity. Unsupported protocol shapes fail before creation. HTTP calls use HTTPS in live configuration, a 10-second deadline, bearer auth, and no redirects. TLS verification remains enabled.

The demo implements the same contract in memory. Contract tests check routing, units, response validation, and auth headers. No production panel is accessed in automated tests. A second adapter should implement its own tests against the intended version, not silently try multiple write endpoints.

## Failure behavior

- Lost panel response: review state, reserved quota, no automatic duplicate write.
- Panel outage: retain previous consumption; expose unsuccessful sync.
- Source client removed externally: review state; do not recreate it automatically.
- Template removed from configuration: reject new allocation; require operator repair for removal.
- Relaydesk outage: existing Xray traffic continues; management waits for recovery.
- Database loss: ownership is lost even if remote clients exist. Restore from backup; do not infer ownership from display names.
