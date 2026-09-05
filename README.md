# hetzner-dns-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/hetzner-dns-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/hetzner-dns-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hetzner-dns-mcp)](https://www.npmjs.com/package/hetzner-dns-mcp)
[![npm downloads](https://img.shields.io/npm/dm/hetzner-dns-mcp)](https://www.npmjs.com/package/hetzner-dns-mcp)
[![node](https://img.shields.io/node/v/hetzner-dns-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/hetzner-dns-mcp)](LICENSE)
[![container](https://img.shields.io/badge/ghcr.io-ni--c%2Fhetzner--dns--mcp-blue)](https://github.com/ni-c/hetzner-dns-mcp/pkgs/container/hetzner-dns-mcp)
[![docs](https://img.shields.io/badge/docs-hetzner--dns--mcp.ni--c.de-informational)](https://hetzner-dns-mcp.ni-c.de)
[![HTTP • via mcp-hub](https://img.shields.io/badge/HTTP-via%20mcp--hub-6f42c1)](https://mcp-hub.ni-c.de)
[![Glama](https://glama.ai/mcp/servers/ni-c/hetzner-dns-mcp/badges/score.svg)](https://glama.ai/mcp/servers/ni-c/hetzner-dns-mcp)
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
    <img src="https://hetzner-dns-mcp.ni-c.de/architecture.svg" alt="An MCP client speaks stdio to hetzner-dns-mcp, which validates arguments, puts destructive calls to a person first, and calls the Hetzner Cloud API over HTTPS" width="800">
  </picture>
</p>

<!-- <picture> is resolved against the colour scheme of the page showing it, so GitHub
     picks the variant that matches its own theme toggle. npm strips <picture> and
     <source> when it sanitises the README and keeps the <img>, which is why that
     fallback brings its own dark card instead of relying on a media query. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://hetzner-dns-mcp.ni-c.de/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://hetzner-dns-mcp.ni-c.de/architecture-light.svg">
  <img src="https://hetzner-dns-mcp.ni-c.de/architecture.svg" alt="An MCP client talks to hetzner-dns-mcp over stdio; the server exposes read and write tools for zones and record sets, asks a person before a destructive call, and calls the Hetzner Cloud DNS API over HTTPS with an API token" width="800">
</picture>

## What makes it different

**Zones, record sets and the actions behind them.** Listing, creating, updating
and deleting zones and RRSets, importing and exporting BIND zone files, changing
TTLs and protection — and following the asynchronous zone actions Hetzner queues
behind a change, rather than reporting success and leaving you to guess.

**Nothing upstream is trusted.** Record values, comments and zone files come back
wrapped as untrusted data, secret-looking keys are redacted, oversized values are
truncated and HTML error pages are dropped instead of pasted into the context.

**Destructive calls ask a person.** Deleting a zone or replacing a record set
raises a real dialog through MCP elicitation. Where the client cannot show one,
the call is refused and carries a random single-use token that only ever appeared
in a previous tool result — so nothing hidden inside a DNS record can mint it.

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
| `ELICITATION`          | no       | `false` replaces the approval dialog with the two-call token. **Not prefixed**     |
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

### Through mcp-hub

A client that cannot spawn a local process — ChatGPT connectors, Claude on the web,
Cursor, LibreChat — reaches hetzner-dns-mcp through [mcp-hub](https://mcp-hub.ni-c.de): one
container serves many stdio MCP servers over Streamable HTTP, with an OAuth 2.1 login
behind a single password and long-lived tokens for the clients that cannot do OAuth. Its
`/hub` endpoint puts every server behind six meta-tools, so one connector reaches all of
them without N×tool schemas in the model's context, and it speaks both protocol revisions
— a question this server asks travels through it to the person at the far end.

Its `/config/mcp.json` uses Claude Code's format, so the entry is the one you already
have:

```json
{
  "mcpServers": {
    "hetzner-dns": {
      "command": "npx",
      "args": ["-y", "hetzner-dns-mcp"],
      "env": {
        "HETZNER_API_TOKEN": "your-token",
        "HETZNER_ALLOW_TOOLS": "essential"
      },
      "denyTools": ["delete_*"]
    }
  }
}
```

`allowTools` and `denyTools` there are the hub's **own** per-server filter, which is not
the same thing as `*_ALLOW_TOOLS` in `env` — the difference, and the mistake it invites,
are in the [client guide](https://hetzner-dns-mcp.ni-c.de/guide/clients#through-mcp-hub).

## Tools

Every tool declares an `outputSchema` and answers with `structuredContent`
alongside the text block, so a client can use the result without parsing prose.
The `<untrusted-data>` fence stays in the text — it is the readable presentation
of the same marker — and the structured half carries `untrusted: true` and
`source: "hetzner-cloud-api"` as fields. **Every** tool carries them: record
values, comments, labels and zone files are written by whoever controls the
zone, and no tool here answers with anything else.

The API documents are described as open objects with the top-level keys the
[spec](https://docs.hetzner.cloud/cloud.spec.json) guarantees. The API is not
this server's to promise, and the SDK validates each result against its schema
before it goes out — a strict shape would turn a field Hetzner adds into a tool
that fails outright.

An over-budget result is now an **error**. It used to be cut off mid-document
and say so, which is fine for a text block and impossible for
`structuredContent`: the two channels have to carry the same value, and a
document sliced mid-string does not parse.

### Zones

| Tool                            | Description                                                     |
| ------------------------------- | --------------------------------------------------------------- |
| `list_zones`                    | List zones with status, mode, nameservers and record counts     |
| `get_zone`                      | Get the full details of a single zone                           |
| `create_zone`                   | Create a primary or secondary zone, optionally from a zone file |
| `update_zone`                   | Replace the labels of a zone                                    |
| `delete_zone` 👤                | Permanently delete a zone                                       |
| `export_zonefile`               | Export the zone as a BIND zone file                             |
| `import_zonefile` 👤            | Import a BIND zone file (replaces all records)                  |
| `change_zone_ttl`               | Change the default TTL of a zone                                |
| `change_zone_protection` 👤     | Enable/disable delete protection — asks when _disabling_        |
| `change_primary_nameservers` 👤 | Replace the primaries of a secondary zone                       |

### RRSets (record sets)

| Tool                         | Description                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| `list_rrsets`                | List the RRSets of a zone, filterable by name/type/labels             |
| `get_rrset`                  | Get a single RRSet by name and type                                   |
| `create_rrset`               | Create a new RRSet with records                                       |
| `update_rrset`               | Replace the labels of an RRSet                                        |
| `delete_rrset` 👤            | Permanently delete an RRSet                                           |
| `set_records` 👤             | Replace **all** records of an RRSet                                   |
| `add_records`                | Add records to an RRSet (creates it if missing)                       |
| `remove_records` 👤          | Remove specific records from an RRSet                                 |
| `change_rrset_ttl`           | Change the TTL of an RRSet (or reset to the zone default with `null`) |
| `change_rrset_protection` 👤 | Enable/disable change protection — asks when _disabling_              |

👤 asks a person through MCP elicitation · falls back to a two-call
`confirm_token` where the client cannot show a dialog.

### Actions

| Tool                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `list_zone_actions` | List asynchronous zone operations (e.g. imports), filter by status |
| `get_zone_action`   | Get a single action by ID to check its status                      |

### Safety

**A person is asked, not just told.** Every irreversible tool — `delete_zone`,
`delete_rrset`, `import_zonefile`, `set_records`, `remove_records`,
`change_primary_nameservers`, and
`change_zone_protection`/`change_rrset_protection` when they _remove_ protection —
raises a real dialog through MCP elicitation where the client supports it. The model
cannot answer it on its behalf, and nothing happens until an answer comes back.

Where the client cannot show a dialog, the tool refuses its first call and returns a
random, single-use token valid for five minutes; the second call must repeat the
identical arguments and pass it:

```text
1. set_records(zone: "example.com", name: "www", type: "A", records: [{value: "198.51.100.1"}])
   → error: Refusing to replace the records … confirm_token: "3f9c…"
2. set_records(…same arguments…, confirm_token: "3f9c…")
   → executed
```

Deliberately not a boolean the model can set on its own: the token exists only in a
_previous_ tool result, so an instruction hidden in a TXT record or a zone-file
comment cannot manufacture one. But it proves the call was made twice with the same
arguments and nothing more, and the fallback text says so rather than implying
somebody approved.

Either way the approval is bound to what it is about. For `set_records`,
`remove_records` and `import_zonefile` that is a hash of the exact payload: an
approval for `["198.51.100.1"]` will not write `["198.51.100.66"]`.

`ELICITATION=false` takes the fallback path deliberately, for a scheduled job or a
test harness. It never removes the guard. See
[Asking a person](https://hetzner-dns-mcp.ni-c.de/guide/approval).

The dialog is a guard rail, not a security boundary — the boundary is the permission
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

## Not exposed, on purpose

**Only the Hetzner Cloud DNS API.** The standalone `dns.hetzner.com` API was shut
down in May 2026 and is not implemented — scripts still using it are broken for
reasons that have nothing to do with this server.

**`HETZNER_API_BASE_URL` is not a provider switch.** It exists to point at a local
mock during development, and is validated (HTTPS only, no credentials in the URL,
a warning on a non-default host) precisely because your token is sent there. The
request shapes are Hetzner's.

## Safety

- DNS records are edited by whoever holds the token, so upstream values,
  comments and zone files are marked as untrusted data — to be reported, never
  followed. Keys matching `tsig_key`, `token` or `secret` are redacted, values
  over 4 000 characters are truncated, and an HTML error page is dropped rather
  than pasted into the context.
- Deleting a zone or replacing a record set asks a person: a real dialog through
  MCP elicitation, bound to the exact target. Where the client cannot show one,
  the call is refused and carries a random single-use token that only ever
  appeared in a previous tool result.
- `HETZNER_READ_ONLY=true` registers the seven read tools and nothing else — a
  write tool is then absent from `tools/list`, not refused when called.
- Requests are hardened rather than trusted: zone identifiers are pattern-matched
  so a path cannot escape, redirects are refused so the `Authorization` header
  never follows one, every request times out after 30 seconds, request bodies are
  assembled from named fields only, and the base URL is validated (HTTPS, no
  credentials) before the token is ever sent to it.

## Documentation

The full guide, tool reference and security notes live at
**[hetzner-dns-mcp.ni-c.de](https://hetzner-dns-mcp.ni-c.de)** (source in [`docs/`](docs/)).

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest test suite
npm run lint      # oxlint + prettier check
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

## Releasing

Releases are tag-driven. Bump `package.json`, move the `[Unreleased]` notes in
`CHANGELOG.md` under the new version, commit, then:

```sh
git tag -s vX.Y.Z -m "vX.Y.Z"
git push origin main vX.Y.Z
```

The release workflow publishes to npm via Trusted Publishing (OIDC, with
provenance), pushes the multi-arch container image to GHCR, creates the GitHub
release from the CHANGELOG section, and updates the entry in the official MCP
registry.

## Contributing

Issues, discussions and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md). For vulnerabilities please use
[private reporting](https://github.com/ni-c/hetzner-dns-mcp/security/advisories/new)
rather than a public issue; the policy is in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Willi Thiel
