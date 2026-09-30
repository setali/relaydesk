# Release checklist

This repository is prepared for an initial public source release, not an assertion of production readiness.

- Set the final project name, owner, repository URL, and security contact.
- Confirm the chosen MIT license and preserve dependency/upstream attribution.
- Run `npm run check` and build the Docker image on the release platform.
- Run the live acceptance procedure in OPERATIONS.md against a disposable inbound; record exact 3x-ui and Xray versions.
- Check administrator and member flows in desktop and mobile browsers.
- Verify restore from a SQLite backup and uncertain-operation recovery after restart.
- Enable GitHub private vulnerability reporting and branch protection.
- Scan tracked files for secrets; never include `.env`, real panel data, local databases, or terminal demo credentials.
- Add a screenshot of synthetic demo data and a factual compatibility table.
- Tag a pre-1.0 release and list the known limitations explicitly.

Suggested portfolio description after verification: “Built a dependency-free, self-hosted team workspace with tenant isolation, quota reservation, recoverable remote operations, and a tested 3x-ui API integration boundary.” Do not claim real-panel compatibility or security audit results that have not been demonstrated.
