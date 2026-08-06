# mcp-hetzner-dns

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

## Installation

### Claude Code

```bash
claude mcp add hetzner-dns -s user \
  -e HETZNER_API_TOKEN=your-token \
  -- npx -y mcp-hetzner-dns
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hetzner-dns": {
      "command": "npx",
      "args": ["-y", "mcp-hetzner-dns"],
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
args = ["-y", "mcp-hetzner-dns"]
env = { HETZNER_API_TOKEN = "your-token" }
```

### From source

```bash
git clone https://github.com/ni-c/mcp-hetzner-dns.git
cd mcp-hetzner-dns
npm install
npm run build
# then use `node /path/to/mcp-hetzner-dns/dist/index.js` as the command
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
| `change_primary_nameservers` | Replace the primary nameservers of a secondary zone                      |

### RRSets (record sets)

| Tool                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `list_rrsets`             | List the RRSets of a zone, filterable by name/type/labels             |
| `get_rrset`               | Get a single RRSet by name and type                                   |
| `create_rrset`            | Create a new RRSet with records                                       |
| `update_rrset`            | Replace the labels of an RRSet                                        |
| `delete_rrset`            | Permanently delete an RRSet — requires `confirm=true`                 |
| `set_records`             | Replace **all** records of an RRSet                                   |
| `add_records`             | Add records to an RRSet (creates it if missing)                       |
| `remove_records`          | Remove specific records from an RRSet                                 |
| `change_rrset_ttl`        | Change the TTL of an RRSet (or reset to the zone default with `null`) |
| `change_rrset_protection` | Enable/disable change protection                                      |

### Actions

| Tool                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `list_zone_actions` | List asynchronous zone operations (e.g. imports), filter by status |
| `get_zone_action`   | Get a single action by ID to check its status                      |

### Safety

- `delete_zone`, `delete_rrset` and `import_zonefile` refuse to run without an explicit `confirm=true` parameter and report what would be affected, so an MCP client can ask the user for confirmation first.
- Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can apply appropriate permission policies.
- `set_records` and `remove_records` are marked destructive because they drop existing records without a confirmation guard — review their input carefully.
- Hetzner-side resource protection is honored: protected zones/RRSets return an error with a hint to the corresponding `change_*_protection` tool.

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest test suite
npm run lint      # eslint + prettier check
```

## License

[MIT](LICENSE)
