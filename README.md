# hetzner-dns-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/hetzner-dns-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/hetzner-dns-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hetzner-dns-mcp)](https://www.npmjs.com/package/hetzner-dns-mcp)
[![npm downloads](https://img.shields.io/npm/dm/hetzner-dns-mcp)](https://www.npmjs.com/package/hetzner-dns-mcp)
[![node](https://img.shields.io/node/v/hetzner-dns-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/hetzner-dns-mcp)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing DNS zones and records via the [Hetzner Cloud API](https://docs.hetzner.cloud/reference/cloud#zones).

Lets MCP clients like Claude Code, Claude Desktop or Codex manage your Hetzner DNS: list, create, update and delete zones and RRSets (record sets), import/export zone files, manage protection and TTLs, and track asynchronous zone actions.

> **Note:** This server targets the current DNS API that is part of the **Hetzner Cloud API** (`api.hetzner.cloud`). The legacy DNS API (`dns.hetzner.com`) was shut down in May 2026 and is not supported.

## Requirements

- Node.js ≥ 20
- A Hetzner Cloud API token for the project that holds your DNS zones — create one in the [Hetzner Cloud Console](https://console.hetzner.com) under _your project → Security → API tokens_. Use a **read & write** token for full functionality (a read-only token limits you to the read tools).

## Configuration

Configuration is provided via environment variables:

| Variable               | Required | Description                                                   |
| ---------------------- | -------- | ------------------------------------------------------------- |
| `HETZNER_API_TOKEN`    | yes      | Hetzner Cloud API token (project-scoped)                      |
| `HETZNER_API_BASE_URL` | no       | Base URL of the API (default: `https://api.hetzner.cloud/v1`) |

Without a token the server still starts and lists its tools (so registries and
inspectors can introspect it), but every tool call fails with setup
instructions instead of reaching the API.

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

```bash
docker build -t hetzner-dns-mcp .
docker run -i --rm -e HETZNER_API_TOKEN=your-token hetzner-dns-mcp
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
        "hetzner-dns-mcp"
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

| Tool                         | Description                                                              |
| ---------------------------- | ------------------------------------------------------------------------ |
| `list_zones`                 | List zones with status, mode, nameservers and record counts              |
| `get_zone`                   | Get the full details of a single zone                                    |
| `create_zone`                | Create a primary or secondary zone, optionally from a zone file          |
| `update_zone`                | Replace the labels of a zone                                             |
| `delete_zone`                | Permanently delete a zone — requires `confirm=true`                      |
| `export_zonefile`            | Export the zone as a BIND zone file                                      |
| `import_zonefile`            | Import a BIND zone file (replaces all records) — requires `confirm=true` |
| `change_zone_ttl`            | Change the default TTL of a zone                                         |
| `change_zone_protection`     | Enable/disable delete protection                                         |
| `change_primary_nameservers` | Replace the primaries of a secondary zone — requires `confirm=true`      |

### RRSets (record sets)

| Tool                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `list_rrsets`             | List the RRSets of a zone, filterable by name/type/labels             |
| `get_rrset`               | Get a single RRSet by name and type                                   |
| `create_rrset`            | Create a new RRSet with records                                       |
| `update_rrset`            | Replace the labels of an RRSet                                        |
| `delete_rrset`            | Permanently delete an RRSet — requires `confirm=true`                 |
| `set_records`             | Replace **all** records of an RRSet — requires `confirm=true`         |
| `add_records`             | Add records to an RRSet (creates it if missing)                       |
| `remove_records`          | Remove specific records from an RRSet — requires `confirm=true`       |
| `change_rrset_ttl`        | Change the TTL of an RRSet (or reset to the zone default with `null`) |
| `change_rrset_protection` | Enable/disable change protection                                      |

### Actions

| Tool                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `list_zone_actions` | List asynchronous zone operations (e.g. imports), filter by status |
| `get_zone_action`   | Get a single action by ID to check its status                      |

### Safety

- `delete_zone`, `delete_rrset`, `import_zonefile`, `set_records`, `remove_records` and `change_primary_nameservers` refuse to run without an explicit `confirm=true` parameter and report what would be affected, so an MCP client can ask the user for confirmation first. Note that the `confirm` guard is advisory: a model can set `confirm=true` on its own. The actual security boundary is the permission prompt of your MCP host — do not auto-approve destructive tools.
- Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can apply appropriate permission policies.
- `HETZNER_API_BASE_URL` must be an `https` URL (`http` is only accepted for localhost) and must not contain credentials; a warning is printed when a non-default host is configured, because the API token is sent there.
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
