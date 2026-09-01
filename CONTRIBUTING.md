# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/hetzner-dns-mcp.git && cd hetzner-dns-mcp
npm install
npm test          # no credentials needed, fetch is stubbed
npm run build
```

A minimal dev environment:

```sh
# A Hetzner Cloud API token of a project that holds DNS zones.
# HETZNER_READ_ONLY keeps the write tools unregistered while you poke around.
export HETZNER_API_TOKEN=...
export HETZNER_READ_ONLY=true
npm run build && npx @modelcontextprotocol/inspector node dist/index.js
```

## Why there is no integration suite

Every other server in this family has a `test/integration/` that brings up its
backend in Docker, spawns the built server over stdio and calls every tool in
the catalogue against it — the one test a stubbed `fetch` cannot do, because a
stub can only agree with whatever its author believed about the API.

This server cannot have one. Hetzner's DNS API is a hosted service with no
self-hosted edition and no sandbox, and the thing it manages is public DNS: a
test that created zones would be creating them in the real world, on a real
account, and paying for it. There is nothing to put in a `compose.yml`.

**The gap is named rather than papered over.** A fake Hetzner would produce a
green suite proving what the unit tests already prove — that this server agrees
with itself — while looking like more. That is precisely how the apex-`@` bug
survived: the stub and the server shared the same wrong belief about how the
API spells the zone root, and only a real zone disagreed.

So the verification against the real API stays manual, and this is it:

1. A **throwaway zone**, on a domain nothing points at. Not a zone that serves
   anything: `delete_zone` is in the catalogue and there is no undo.
2. `HETZNER_READ_ONLY=true` first, through the MCP Inspector, for the read
   tools. Then `false` once, deliberately, for the writes.
3. Compare against the Hetzner console rather than against the tool's own read
   path — the two agreeing proves nothing if both are wrong in the same way.
4. The apex record is worth a pass of its own every time. Hetzner spells the
   zone root as the zone name, not as `@`, and a server that gets that wrong
   creates a record called literally `@` that resolves for nobody.

Anything found this way belongs in the tool's own description, where the next
model reading it will see it, and in a unit test that pins the shape.

## Expectations

- **Tests.** Behaviour changes come with a test that fails without the change.
  CI runs the test matrix on Node 22 and 24, oxlint, prettier, `npm audit`, CodeQL and a Trivy scan of the container image.
- **Comments** explain constraints the code cannot show — not what the next line does.
- **Security-sensitive areas** (config parsing, confirmation tokens, anything that
  builds a request URL): please describe the attack you are defending against, or the
  one your change might open, in the PR text.
- **No new runtime dependencies** without a very good reason; the small tree is a
  feature.
- Run `npm run lint` before pushing — it checks both oxlint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/hetzner-dns-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/hetzner-dns-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/hetzner-dns-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
