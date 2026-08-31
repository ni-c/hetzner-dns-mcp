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
