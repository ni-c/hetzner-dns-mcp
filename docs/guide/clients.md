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
