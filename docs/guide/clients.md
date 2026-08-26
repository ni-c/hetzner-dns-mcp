# Connecting clients

Every snippet below sets one required variable, `HETZNER_API_TOKEN`. The
optional ones are in the [environment reference](/reference/environment).

## Claude Code

```bash
claude mcp add hetzner-dns -s user \
  -e HETZNER_API_TOKEN=your-token \
  -- npx -y hetzner-dns-mcp
```

`-s user` makes the server available in every project. Use `-s local` for the
current one only. Check it with `claude mcp list`.

## Claude Desktop

Add to `claude_desktop_config.json`:

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

The file lives in `~/Library/Application Support/Claude/` on macOS and
`%APPDATA%\Claude\` on Windows. Restart Claude Desktop afterwards.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.hetzner-dns]
command = "npx"
args = ["-y", "hetzner-dns-mcp"]
env = { HETZNER_API_TOKEN = "your-token" }
```

## MCP Inspector

Useful for looking at the tool schemas and calling tools by hand:

```bash
HETZNER_API_TOKEN=your-token \
  npx @modelcontextprotocol/inspector npx -y hetzner-dns-mcp
```

Add `HETZNER_READ_ONLY=true` while you are poking around and the write tools
will not even be registered.

## Docker

Multi-arch images (amd64 and arm64) are published to GHCR with an SBOM and
build provenance:

```bash
docker run -i --rm -e HETZNER_API_TOKEN=your-token ghcr.io/ni-c/hetzner-dns-mcp
```

The image speaks MCP over stdio, so it needs `-i` and exposes no port:

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

Passing `-e HETZNER_API_TOKEN` without a value tells Docker to forward the
variable from the `env` block, so the token never appears in the argument list —
where `ps` would show it.

Pin a version rather than tracking `latest` if you care about reproducibility:
`ghcr.io/ni-c/hetzner-dns-mcp:0.3.0`.

## Through mcp-hub

[mcp-hub](https://mcp-hub.ni-c.de) serves many stdio MCP servers from one
container behind a single HTTPS endpoint, so hetzner-dns-mcp can be reached from
clients that cannot spawn a local process — ChatGPT connectors, Claude on the
web, Cursor — without a container, a hostname and an OAuth stack of its own.

Its `/config/mcp.json` uses Claude Code's format, so the entry is the one you
already have:

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

`allowTools` and `denyTools` are the hub's **own** per-server filter and take
exact tool names or `list_*` prefixes — the same syntax as the two environment
variables above, so a list moves between them verbatim. What does **not** move
is `essential`: that preset is a hetzner-dns-mcp feature, so it belongs in `env`
as shown. `"allowTools": ["essential"]` would be a name the hub cannot resolve.

The two compose, and it is worth knowing which does what: the server registers
what its environment variables allow, and the hub exposes what its arrays allow.
Filtering in the server is the tighter of the two — the tool is never built.

Register `https://your-host/hetzner-dns/mcp` as a connector and you get this
server alone. Register the hub's `/hub` endpoint instead and you reach _every_
server behind it through six meta-tools, which is the answer worth having once
you run several of these at once.

## From source

```bash
git clone https://github.com/ni-c/hetzner-dns-mcp.git
cd hetzner-dns-mcp
npm install
npm run build
```

Then use `node /path/to/hetzner-dns-mcp/dist/index.js` as the command.

## Verifying what you install

The npm package is published from CI through
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers) and carries
provenance attestations:

```bash
npm view hetzner-dns-mcp dist.attestations
npm audit signatures
```

The container image carries an SBOM and max-mode build provenance, both
inspectable with `docker buildx imagetools inspect`.
