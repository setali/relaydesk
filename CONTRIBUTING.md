# Contributing

Use Node.js 24.12 or later. Run `npm run demo` for a disposable workspace and `npm run check` before opening a pull request. There are no package dependencies to install.

Keep changes focused. Include the user-facing problem, what changes, and how you checked it. Add tests at behavior boundaries: ownership, quota reservation, external effects, and recovery. Avoid tests that only reproduce implementation details.

Panel integrations belong in adapters. State the supported panel release and auth mechanism explicitly. Provide response fixtures stripped of real tokens, UUIDs, subscription URLs, addresses, and account data. Tests must never require a production panel.

Preserve existing remote client settings when implementing edits, especially protocol flow and authentication fields. Document partial failures and retain uncertain reservations. A new database schema requires a versioned migration and rollback/backup notes.

For UI changes, check keyboard navigation, empty/error states, narrow screens, and rendering of untrusted names. No external tracking or asset requests. Keep runtime dependencies at zero unless a concrete requirement justifies a change.

By contributing, you agree that your original contributions are licensed under the project's MIT license. Do not copy code from differently licensed projects without checking compatibility and preserving required notices.
