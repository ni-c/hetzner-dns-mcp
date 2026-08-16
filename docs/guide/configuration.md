# Configuration

Everything is configured through environment variables. There is no config
file, and nothing is read from disk.

| Variable               | Required | Default                        | Description                             |
| ---------------------- | -------- | ------------------------------ | --------------------------------------- |
| `HETZNER_API_TOKEN`    | yes      | —                              | Hetzner Cloud API token, project-scoped |
| `HETZNER_READ_ONLY`    | no       | `false`                        | `true` registers only the read tools    |
| `HETZNER_API_BASE_URL` | no       | `https://api.hetzner.cloud/v1` | Override the API base URL               |

The full descriptions are in the [environment reference](/reference/environment).

## `HETZNER_API_TOKEN`

A Hetzner Cloud API token from **Security → API tokens** in the project that
holds your zones. It is sent as a `Bearer` header on every request.

Pass it through your MCP client's `env` block. Not on a command line, where
`ps` shows it to every user on the machine, and not in a file you might commit.

The server reads it once at startup and then **deletes it from
`process.env`**, so a later crash report, a Node diagnostic report or a
dependency that dumps the environment finds nothing there.

## Read-only mode

```bash
HETZNER_READ_ONLY=true
```

Accepted as `true`, `1` or `yes`, case-insensitively.

This does not reject write calls — it never registers the write tools in the
first place. `tools/list` returns seven tools, and a client asking for
`delete_zone` gets "tool not found" from the protocol layer. There is no code
path from a write request to the API.

Pair it with a read-only Hetzner token for defence in depth: the token stops
the API from accepting a write, and read-only mode stops the model from ever
seeing a tool that could attempt one.

```json
{
  "mcpServers": {
    "hetzner-dns": {
      "command": "npx",
      "args": ["-y", "hetzner-dns-mcp"],
      "env": {
        "HETZNER_API_TOKEN": "your-read-only-token",
        "HETZNER_READ_ONLY": "true"
      }
    }
  }
}
```

::: tip Two servers, two roles
Nothing stops you registering the same package twice — once read-only for
everyday questions, once with write access under a different name for the
sessions where you actually intend to change something.
:::

## `HETZNER_API_BASE_URL`

Only useful for testing against a local mock. It is validated before anything
is sent:

- must parse as a URL, and be `https` — `http` is accepted only for
  `localhost`, `127.0.0.1` and `[::1]`
- must not contain credentials (`https://user:pass@…` is rejected)
- a non-default host produces a warning on stderr, because your token is about
  to be sent there

A value that fails these checks exits the process rather than starting a server
that would leak the token on its first call. The value itself is never printed
back, since a malformed one can carry a `user:token@` part.

## Timeouts and limits

These are not configurable, and are listed so you know what to expect:

| Behaviour                | Value                                       |
| ------------------------ | ------------------------------------------- |
| Request timeout          | 30 seconds                                  |
| Redirects                | refused (`redirect: 'error'`)               |
| Confirmation token TTL   | 5 minutes, single use                       |
| Pending tokens kept      | 100, oldest evicted                         |
| Single value in a result | truncated at 4 000 characters               |
| Whole result             | truncated at 200 000 characters             |
| Upstream error body      | truncated at 2 000 characters; HTML dropped |

If a list tool truncates, narrow it with `per_page` and `page` rather than
retrying — the caps exist because a large zone would otherwise fill the context
window in a single call.
