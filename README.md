# hetzner-dns-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/hetzner-dns-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/hetzner-dns-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hetzner-dns-mcp)](https://www.npmjs.com/package/hetzner-dns-mcp)
[![npm downloads](https://img.shields.io/npm/dm/hetzner-dns-mcp)](https://www.npmjs.com/package/hetzner-dns-mcp)
[![node](https://img.shields.io/node/v/hetzner-dns-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/hetzner-dns-mcp)](LICENSE)
[![container](https://img.shields.io/badge/ghcr.io-ni--c%2Fhetzner--dns--mcp-blue)](https://github.com/ni-c/hetzner-dns-mcp/pkgs/container/hetzner-dns-mcp)
[![docs](https://img.shields.io/badge/docs-hetzner--dns--mcp.ni--c.de-informational)](https://hetzner-dns-mcp.ni-c.de)
[![sponsor](https://img.shields.io/badge/sponsor-ni--c-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ni-c)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing DNS zones and records via the [Hetzner Cloud API](https://docs.hetzner.cloud/reference/cloud#zones).

Lets MCP clients like Claude Code, Claude Desktop or Codex manage your Hetzner DNS: list, create, update and delete zones and RRSets (record sets), import/export zone files, manage protection and TTLs, and track asynchronous zone actions.

Twenty-two tools is the ceiling, not the floor: `HETZNER_ALLOW_TOOLS=essential`
registers a curated eight instead, and a model picks the right tool far more
reliably from eight than from twenty-two — see
[choosing which tools load](#choosing-which-tools-load).

> **Note:** This server targets the current DNS API that is part of the **Hetzner Cloud API** (`api.hetzner.cloud`). The legacy DNS API (`dns.hetzner.com`) was shut down in May 2026 and is not supported.

![Demo: listing the tools, a refused set_records call, and the same call succeeding with the confirmation token it returned](https://hetzner-dns-mcp.ni-c.de/demo.gif)

<!-- <picture> is resolved against the colour scheme of the page showing it, so GitHub
     picks the variant that matches its own theme toggle. npm strips <picture> and
     <source> when it sanitises the README and keeps the <img>, which is why that
     fallback brings its own dark card instead of relying on a media query. -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://hetzner-dns-mcp.ni-c.de/architecture-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://hetzner-dns-mcp.ni-c.de/architecture-light.svg">
    <img src="https://hetzner-dns-mcp.ni-c.de/architecture.svg" alt="An MCP client speaks stdio to hetzner-dns-mcp, which validates arguments, gates destructive calls behind a confirmation token, and calls the Hetzner Cloud API over HTTPS" width="800">
  </picture>
</p>

## Requirements

- Node.js ≥ 22
- A Hetzner Cloud API token for the project that holds your DNS zones — create one in the [Hetzner Cloud Console](https://console.hetzner.com) under _your project → Security → API tokens_. Use a **read & write** token for full functionality (a read-only token limits you to the read tools).

## Configuration

Configuration is provided via environment variables:

| Variable               | Required | Description                                                                        |
| ---------------------- | -------- | ---------------------------------------------------------------------------------- |
| `HETZNER_API_TOKEN`    | yes      | Hetzner Cloud API token (project-scoped)                                           |
| `HETZNER_READ_ONLY`    | no       | `true` registers only the read tools; the write tools do not exist at all          |
| `HETZNER_ALLOW_TOOLS`  | no       | Comma-separated tool names, `list_*` prefixes, or `essential` for a curated preset |
| `HETZNER_DENY_TOOLS`   | no       | Same syntax; removed from whatever `HETZNER_ALLOW_TOOLS` left                      |
| `HETZNER_API_BASE_URL` | no       | Base URL of the API (default: `https://api.hetzner.cloud/v1`)                      |

Without a token the server still starts and lists its tools (so registries and
inspectors can introspect it), but every tool call fails with setup
instructions instead of reaching the API.

`HETZNER_API_TOKEN` and `HETZNER_API_BASE_URL` are deleted from the process
environment once they have been read, so a later crash report or diagnostic
dump cannot expose the token.

### Choosing which tools load

`HETZNER_ALLOW_TOOLS` and `HETZNER_DENY_TOOLS` take comma-separated tool names;
a trailing `*` matches a whole family. `essential` is a curated preset —
`list_zones`, `get_zone`, `list_rrsets`, `get_rrset`, `create_rrset`,
`set_records`, `delete_rrset` and `export_zonefile` — which covers reading a
zone and changing a record without the rare, catastrophic tools.

```sh
HETZNER_ALLOW_TOOLS=essential
HETZNER_ALLOW_TOOLS=list_*,get_zone,set_records
HETZNER_DENY_TOOLS=delete_zone,import_zonefile
```

An entry that matches no tool aborts startup and names it, so a typo cannot
silently hide a tool — an absent tool is not something anyone traces back to an
environment variable. A filtered tool is never registered, so it is absent from
`tools/list` and unknown to `tools/call` alike, exactly like a write tool under
`HETZNER_READ_ONLY`.

If you run several of these servers at once, [mcp-hub](https://mcp-hub.ni-c.de)
is the other answer — its `/hub` endpoint replaces every server's tools with six
meta-tools.

## Installation

### Claude Code

```bash
claude mcp add hetzner-dns -s user \
  -e HETZNER_API_TOKEN=your-token \
  -- npx -y hetzner-dns-mcp
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hetzner-dns": {
      "command": "npx",
      "args": ["-y", "hetzner-dns-mcp"],
      "env": {
        "HETZNER_API_TOKEN": "your-token"
      }
    }
  }
}
```

### Codex

Add to your `~/.codex/config.toml`:

```toml
[mcp_servers.hetzner-dns]
command = "npx"
args = ["-y", "hetzner-dns-mcp"]
env = { HETZNER_API_TOKEN = "your-token" }
```

### From source

```bash
git clone https://github.com/ni-c/hetzner-dns-mcp.git
cd hetzner-dns-mcp
npm install
npm run build
# then use `node /path/to/hetzner-dns-mcp/dist/index.js` as the command
```

### Docker

Multi-arch images (amd64/arm64) are published to GHCR with an SBOM and build
provenance:

```bash
docker run -i --rm -e HETZNER_API_TOKEN=your-token ghcr.io/ni-c/hetzner-dns-mcp
```

The image talks MCP over stdio, so clients need `docker run -i` (no port is
exposed):

```json
{
  "mcpServers": {
    "hetzner-dns": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "HETZNER_API_TOKEN",
        "ghcr.io/ni-c/hetzner-dns-mcp"
      ],
      "env": {
        "HETZNER_API_TOKEN": "your-token"
      }
    }
  }
}
```

## Tools

### Zones

| Tool                         | Description                                                             |
| ---------------------------- | ----------------------------------------------------------------------- |
| `list_zones`                 | List zones with status, mode, nameservers and record counts             |
| `get_zone`                   | Get the full details of a single zone                                   |
| `create_zone`                | Create a primary or secondary zone, optionally from a zone file         |
| `update_zone`                | Replace the labels of a zone                                            |
| `delete_zone`                | Permanently delete a zone — needs a `confirmToken`                      |
| `export_zonefile`            | Export the zone as a BIND zone file                                     |
| `import_zonefile`            | Import a BIND zone file (replaces all records) — needs a `confirmToken` |
| `change_zone_ttl`            | Change the default TTL of a zone                                        |
| `change_zone_protection`     | Enable/disable delete protection — disabling needs a `confirmToken`     |
| `change_primary_nameservers` | Replace the primaries of a secondary zone — needs a `confirmToken`      |

### RRSets (record sets)

| Tool                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `list_rrsets`             | List the RRSets of a zone, filterable by name/type/labels             |
| `get_rrset`               | Get a single RRSet by name and type                                   |
| `create_rrset`            | Create a new RRSet with records                                       |
| `update_rrset`            | Replace the labels of an RRSet                                        |
| `delete_rrset`            | Permanently delete an RRSet — needs a `confirmToken`                  |
| `set_records`             | Replace **all** records of an RRSet — needs a `confirmToken`          |
| `add_records`             | Add records to an RRSet (creates it if missing)                       |
| `remove_records`          | Remove specific records from an RRSet — needs a `confirmToken`        |
| `change_rrset_ttl`        | Change the TTL of an RRSet (or reset to the zone default with `null`) |
| `change_rrset_protection` | Enable/disable change protection — disabling needs a `confirmToken`   |

### Actions

| Tool                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `list_zone_actions` | List asynchronous zone operations (e.g. imports), filter by status |
| `get_zone_action`   | Get a single action by ID to check its status                      |

### Safety

**Confirmation tokens.** Every irreversible tool — `delete_zone`, `delete_rrset`,
`import_zonefile`, `set_records`, `remove_records`, `change_primary_nameservers`, and
`change_zone_protection`/`change_rrset_protection` when they _remove_ protection —
refuses its first call and returns a random, single-use token that is valid for five
minutes. The second call must repeat the identical arguments and pass that token:

```text
1. set_records(zone: "example.com", name: "www", type: "A", records: [{value: "198.51.100.1"}])
   → error: Refusing to replace the records … confirmToken: "3f9c…"
2. set_records(…same arguments…, confirmToken: "3f9c…")
   → executed
```

This is deliberately not a boolean the model can set on its own. The token exists only
in a _previous_ tool result, so an instruction hidden in a TXT record or a zone-file
comment cannot manufacture one. Tokens for `set_records`, `remove_records` and
`import_zonefile` are bound to a hash of the exact payload: a confirmation for
`["198.51.100.1"]` will not write `["198.51.100.66"]`.

The token is a guard rail, not a security boundary — the boundary is the permission
prompt of your MCP host. Do not auto-approve these tools.

**Untrusted upstream data.** Everything the API returns is wrapped in an
`<untrusted-data>` envelope, because record values, comments, labels and zone files are
written by whoever controls the zone. Confirmation messages never quote that content;
they report counts and TTLs only. Keys that look like secrets (`tsig_key`, `token`,
`secret`, `password`) are redacted from results, oversized values are truncated, and
HTML error pages from an intermediate proxy are dropped rather than pasted into the
model's context.

**Least privilege.** Set `HETZNER_READ_ONLY=true` to register only the seven read
tools — the write tools then do not exist on the protocol at all, rather than failing
at call time. Combine it with a read-only Hetzner token for a genuinely read-only
setup.

**Other guarantees.**

- Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can apply appropriate permission policies.
- `HETZNER_API_BASE_URL` must be an `https` URL (`http` is only accepted for localhost) and must not contain credentials; a warning is printed when a non-default host is configured, because the API token is sent there.
- Zone identifiers and RRSet names are validated against a strict character set — no slashes, no percent signs, no bare `.` or `..` — so a request cannot escape the intended API path; requests never follow redirects, so the Bearer header cannot be replayed elsewhere.
- TSIG keys passed to `create_zone`/`change_primary_nameservers` become part of the conversation context and client transcripts — treat them as secrets and rotate them if in doubt.
- Hetzner-side resource protection is honored: protected zones/RRSets return an error with a hint to the corresponding `change_*_protection` tool.

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest test suite
npm run lint      # eslint + prettier check
```

### Releasing

1. Bump the version in `package.json` (`npm version X.Y.Z --no-git-tag-version`).
2. Rename the `[Unreleased]` section in `CHANGELOG.md` to the new version.
3. Commit, then tag and push: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`.

The release workflow then runs the tests, publishes to npm via
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (with
provenance), creates a GitHub release with the notes from the CHANGELOG and
updates the entry in the official
[MCP Registry](https://registry.modelcontextprotocol.io)
(`io.github.ni-c/hetzner-dns-mcp`, via GitHub OIDC).

## License

[MIT](LICENSE)
