# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [Unreleased]

### Added

- `HETZNER_ALLOW_TOOLS` and `HETZNER_DENY_TOOLS` choose which of the 22 tools are
  registered. Both take comma-separated tool names or a prefix with a trailing
  `*` (`list_*`), the allow list decides what is in and the deny list is
  subtracted from it, and `HETZNER_ALLOW_TOOLS=essential` selects a curated eight
  — `list_zones`, `get_zone`, `list_rrsets`, `get_rrset`, `create_rrset`,
  `set_records`, `delete_rrset`, `export_zonefile`. A model picks the right tool
  far more reliably from eight than from twenty-two, and every visible tool costs
  context on every request. Nothing changes for an installation that sets
  neither: all 22 are still registered.

  A filtered tool is not registered at all, so it is absent from `tools/list`
  and answers `tools/call` with "tool not found" — the same cut
  `HETZNER_READ_ONLY` already makes, not a second, weaker one.

  An entry that matches no tool **stops the server at startup**, naming the entry
  and listing the real names, rather than being ignored: an ignored typo leaves a
  tool missing from `tools/list` with nothing pointing at the cause. The same
  applies to a malformed pattern such as `*_zone`. Under `HETZNER_READ_ONLY`, an
  exact write-tool name in the allow list is refused with a message naming the
  read-only setting instead of calling the tool unknown, while a pattern covering
  write tools is accepted and simply contributes nothing.

### Fixed

- The container image no longer ships OpenSSL 3.5.7-r0, which carries
  **CVE-2026-14456** (denial of service via unbounded memory growth). The pinned
  `node:24-alpine` digest is already the newest one; Alpine's fixed 3.5.8-r0 has
  simply not been rebuilt into it yet, so the runtime stage now upgrades
  `libcrypto3` and `libssl3` by name. Upgrading those two rather than running a
  blanket `apk upgrade` keeps the rest of the image exactly as the digest pins
  it. The step can go once the base image ships the fix.

## [0.3.3] - 2026-08-26

### Changed

- Whether `HETZNER_API_BASE_URL` counts as local — which decides both whether
  plain `http` is allowed at all and whether a host other than
  `api.hetzner.cloud` is accepted — is now decided by the same host classifier
  the other MCP servers in this family use, in `src/hosts.ts`, instead of a list
  of three exact spellings. `127.0.0.2`, `sub.localhost`, `localhost.` and
  `http://[::ffff:127.0.0.1]` are just as local as the three that were listed,
  and the API token stays on the machine in every one of those cases. The token
  is still refused over plain `http` to anything that is not.

## [0.3.2] - 2026-08-24

### Fixed

- The zone apex was unreachable. Eight of the RRSet tools put the name into the
  URL path — `get_rrset`, `update_rrset`, `delete_rrset`, `set_records`,
  `add_records`, `remove_records`, `change_rrset_ttl` and
  `change_rrset_protection` — and every one of them ran it through
  `encodeURIComponent`, which turns the apex name `@` into `%40`. The Hetzner
  Cloud API does not decode that: `GET /zones/example.com/rrsets/%40/A` answers
  404 `not_found` while the RRSet exists and `list_rrsets` returns it. The A,
  AAAA, MX and TXT records of the domain itself could therefore be listed but
  neither read nor changed, and `add_records` failed with a 422 about invalid
  syntax. RFC 3986 permits `@` in a path segment, so the name now goes into the
  path verbatim. Wildcard names were never affected — `encodeURIComponent`
  leaves `*` alone.

### Changed

- `rrsetPath()` validates the segments it is handed instead of escaping them.
  The character set — `[A-Za-z0-9@*._-]`, no slash, no percent sign, no bare `.`
  or `..` — was always what kept a request inside the intended endpoint;
  `encodeURIComponent` had nothing left to escape on top of it except the one
  character it broke. That guard used to live only at the tool boundary and is
  now re-checked where the path is built, so a future call site cannot skip it.
- `list_rrsets` now documents that its `name` filter accepts `@` for the zone
  apex. The filter always worked — it is a query parameter, not a path segment —
  but nothing said so.

## [0.3.1] - 2026-08-18

### Fixed

- The architecture diagram no longer depends on the reader's operating system.
  It carried a `prefers-color-scheme` block, which resolves against the OS rather
  than the theme toggle of GitHub or npm — so dark-mode readers on a light OS got
  the light artwork on a dark page. The README now uses `<picture>`, which is
  resolved against the page, and the `<img>` that npm falls back to brings its own
  card instead of a media query.
- `docs/.vitepress/config.ts` pointed `og:image` at `/og.png`, which did not exist —
  the documentation site had no link preview at all. The file is generated now.

### Changed

- The diagram is generated from a single source, `docs/assets/architecture.source.svg`,
  by `npm run assets`. The four rendered copies had already drifted apart; CI now
  fails if one of them is edited by hand.
- `docs/public/og.png` is generated at exactly 1280x640, GitHub's recommended size
  for a social preview, instead of being drawn by hand.

## [0.3.0] - 2026-08-16

### Added

- `Dockerfile` (multi-stage, non-root, stdio entrypoint) and `.dockerignore`,
  so registries that build and introspect the server in a container no longer
  have to guess a build.
- Multi-arch container images (amd64/arm64) at
  `ghcr.io/ni-c/hetzner-dns-mcp`, published from CI with an SBOM and
  max-mode build provenance and scanned with Trivy on every push and pull
  request. `server.json` lists the image as an OCI package, so the MCP
  registry offers it alongside the npm package.
- `HETZNER_READ_ONLY=true` registers only the seven read-only tools. The write
  tools are not registered at all rather than rejected when called, so there is
  no code path from a write request to the API.
- Documentation site at [hetzner-dns-mcp.ni-c.de](https://hetzner-dns-mcp.ni-c.de)
  with a guide, the full tool reference and the security model.

### Changed

- A missing `HETZNER_API_TOKEN` no longer exits at startup. The server
  completes the MCP handshake and lists its tools without credentials; the
  token is required when a tool actually calls the API, which then fails with
  the same setup instructions as before. Base URL validation still exits,
  since a bad base URL can leak the token.
- **Breaking:** the `confirm` boolean is gone. Destructive tools now take an
  optional `confirmToken` instead — see below. Callers that passed
  `confirm: true` will be refused and handed a token to call again with.
- `engines.node` raised to `>=22`; Node 20 is end-of-life and is no longer in
  the CI matrix. The container has been on Node 24 all along.
- Published source maps embed their sources, since only `dist/` is shipped and
  the maps previously pointed at a `src/` that is not in the tarball.

### Security

- **Destructive tools require a server-issued confirmation token.** Every
  irreversible tool refuses its first call and returns a random, single-use
  token with a five-minute lifetime; a second call must repeat the identical
  arguments and pass it. For `set_records`, `remove_records`,
  `import_zonefile` and `change_primary_nameservers` the token is bound to a
  SHA-256 fingerprint of the payload, so a confirmation for one record list
  cannot write a different one.

  The previous `confirm` boolean was a value the model set itself, while the
  refusal messages pasted the current RRSet contents back as raw API JSON.
  Together that was a self-approving loop: an instruction hidden in a TXT
  record value or a zone-file comment arrived verbatim in the very message
  asking for confirmation. A token cannot be produced that way, because it
  only ever exists in a previous result from this server.

- Removing protection now counts as destructive. `change_zone_protection` and
  `change_rrset_protection` had no guard at all, so unprotecting a zone and
  deleting it was two uninterrupted calls; disabling protection is now gated
  exactly like the deletion it enables, while enabling it stays immediate.
- Confirmation messages no longer quote anything read back from the API. They
  report record counts and TTLs only.
- API responses are wrapped in an `<untrusted-data>` envelope, keys matching
  `tsig_key`, `token`, `secret`, `password` or `credential` are redacted,
  single values are truncated at 4 000 characters and whole results at
  200 000.
- Upstream error bodies are truncated at 2 000 characters and HTML error pages
  — a reverse proxy or WAF in front of the API — are dropped entirely instead
  of being pasted into the model's context.
- `HETZNER_API_TOKEN` and `HETZNER_API_BASE_URL` are deleted from the
  environment once read, so a later crash report or diagnostic dump cannot
  expose them. An unparseable base URL is no longer echoed back, since it can
  contain a `user:token@` part.
- `mcp-publisher` is pinned to a release and verified against its SHA-256
  before it runs. It was fetched from `/releases/latest` unverified, in a job
  holding `id-token: write`.
- The runtime image no longer ships npm, npx or corepack; they are never
  invoked there, but their vendored dependencies kept appearing in scans.
- CI additionally runs CodeQL and a Trivy scan of the image for both
  architectures.

## [0.2.3] - 2026-08-13

### Changed

- zod updated to v4 (the MCP SDK supports `^3.25 || ^4.0`); `z.record()`
  now uses the explicit two-argument form.
- Dev dependencies updated: TypeScript 6 (`@types/node` is listed explicitly
  in the tsconfig `types` field, as TS 6 no longer auto-includes `@types`
  packages), `@eslint/js` 10 (matching ESLint 10).

## [0.2.2] - 2026-08-11

### Added

- Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io)
  as `io.github.ni-c/hetzner-dns-mcp`; the release workflow publishes registry
  updates automatically via GitHub OIDC (`server.json`, `mcpName` field).

### Changed

- Dev dependencies updated: vitest 4 (+ matching `@vitest/coverage-v8`),
  ESLint 10, `@types/node` 26; GitHub Actions pins bumped to current
  major versions. Coverage thresholds rebased to vitest 4's stricter
  AST-based measurement.

## [0.2.1] - 2026-08-11

### Added

- Release workflow: pushing a `vX.Y.Z` tag runs the tests, publishes to npm
  via Trusted Publishing (OIDC, with provenance) and creates a GitHub release
  with the notes from this changelog.
- CI: test matrix extended to Node 24, coverage report (thresholds enforced,
  uploaded as artifact), weekly `npm audit` job, Dependabot for npm packages
  and pinned GitHub Actions.

## [0.2.0] - 2026-08-11

### Changed

- Renamed the package from `mcp-hetzner-dns` to `hetzner-dns-mcp`.
- `set_records`, `remove_records` and `change_primary_nameservers` now require
  `confirm=true` (like the other destructive tools) and report the current
  state when refusing; `change_primary_nameservers` is annotated as
  destructive.

### Security

- `HETZNER_API_BASE_URL` is validated: https only (http allowed for
  localhost), URLs with embedded credentials are rejected, and a warning is
  printed for non-default hosts, since the API token is sent there.
- `zone` and RRSet `name` parameters are restricted to a safe character set
  and `.`/`..` are rejected, preventing URL path traversal out of the
  intended API endpoints.
- API requests no longer follow redirects and time out after 30 seconds.
- Fatal errors log only the error message instead of the full stack trace.
- CI: workflow token restricted to `contents: read`, actions pinned to
  commit SHAs.

## [0.1.0] - 2026-08-06

### Added

- Initial release targeting the DNS endpoints of the Hetzner Cloud API
  (`api.hetzner.cloud/v1`, Bearer token authentication). The legacy DNS API
  (`dns.hetzner.com`) is not supported.
- Zone tools: `list_zones`, `get_zone`, `create_zone`, `update_zone`,
  `delete_zone` (guarded by a `confirm` parameter), `export_zonefile`,
  `import_zonefile` (guarded by a `confirm` parameter), `change_zone_ttl`,
  `change_zone_protection`, `change_primary_nameservers`.
- RRSet tools: `list_rrsets`, `get_rrset`, `create_rrset`, `update_rrset`,
  `delete_rrset` (guarded by a `confirm` parameter), `set_records`,
  `add_records`, `remove_records`, `change_rrset_ttl`,
  `change_rrset_protection`.
- Action tools: `list_zone_actions`, `get_zone_action`.
- Configuration via `HETZNER_API_TOKEN`, optional `HETZNER_API_BASE_URL`.

<!-- #endregion changelog -->
