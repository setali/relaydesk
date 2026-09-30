# Relaydesk API

## HTTPS status (v0.3)

`GET /api/https` is administrator-only and reports TLS trust and certificate expiry at the configured public origin. It accepts no destination parameter, caches results for one minute, and never changes gateway configuration. Demo mode performs no network probe.

## Account and server settings (v0.2)

- `PATCH /api/account`: current user's `username`, `name`, `currentPassword`, optional `newPassword`. Verifies current credentials and revokes all sessions on success.
- `GET /api/panels`: admin-only connection metadata and `hasToken`, never stored plaintext.
- `POST /api/panels/probe`: admin-only read probe and supported inbound discovery. Returns no upstream client data or credentials.
- `POST /api/panels`: admin-only create/update by stable `id`, with `name`, HTTPS `baseUrl`, `token`, optional `subscriptionBaseUrl`, and selected `inbounds`. Blank token retains an existing secret. Every save probes again; success proves read compatibility only.
- `DELETE /api/panels/:id`: removes unused saved connections. Rejected when managed clients remain.

These routes use the same session, Origin and CSRF protections as other mutations. Login accepts `username`; legacy callers may send it in `email`. A user's original email is not an alternate login after changing their username.

The browser calls same-origin JSON endpoints. This is Relaydesk's API, not a passthrough for 3x-ui. Requests do not accept upstream URLs, panel tokens, arbitrary inbound settings, or free-form Xray configuration.

| Endpoint                  | Access                 | Behavior                                                                     |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `POST /api/login`         | Public, rate-limited   | Email/password; creates an HttpOnly session cookie and returns CSRF token    |
| `GET /api/me`             | Signed in              | Current account, CSRF token, demo indicator                                  |
| `POST /api/logout`        | Signed in              | Revokes the current session                                                  |
| `GET /api/workspace`      | Signed in              | Authorized clients/accounts, approved templates, recent audit entries        |
| `POST /api/resellers`     | Administrator          | Creates an account with `name`, `email`, `password`, `maxClients`, `quotaGB` |
| `POST /api/clients`       | Signed in              | Reserves capacity, then creates a remote client                              |
| `DELETE /api/clients/:id` | Owner or administrator | Removes the remote client and verifies absence before freeing capacity       |
| `POST /api/sync`          | Signed in              | Refreshes authorized clients; returns per-panel success/failure              |
| `GET /healthz`            | Public                 | Process availability                                                         |

Every mutation requires an exact `Origin` matching PUBLIC_ORIGIN. All mutations except login also require `X-CSRF-Token` from the current session. Requests are capped at 16 KiB. JSON error bodies have the shape `{ "error": "message" }`.

Client creation accepts:

```json
{
  "requestId": "f633e85f-5c48-4a9b-9870-5b642fe231dd",
  "name": "Travel phone",
  "panelId": "germany",
  "inboundId": 1,
  "quotaGB": 50,
  "days": 30
}
```

`quotaGB` is an integer GiB allowance (1 GiB = 1,073,741,824 bytes). `days` is 1–365. The server chooses all remote credentials. Only administrators may assign an `ownerId`; member requests are always bound to their authenticated owner.

Reuse `requestId` when retrying the same creation. A recorded request returns the original client state without another remote write. A lost remote response may return 502 while the client remains reserved in `review`; inspect workspace and sync instead of submitting fresh IDs repeatedly. A recorded ID cannot be reassigned to a different owner.

Subscription URLs are included only for active clients with an operator-configured subscription base URL. UUIDs, upstream emails, panel tokens, and password hashes are omitted from workspace responses. All API responses use `Cache-Control: no-store`.
