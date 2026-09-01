# Getting started

## Requirements

- **Node.js ≥ 22** (or Docker, if you prefer the container)
- A **Hetzner Cloud API token** for the project that holds your DNS zones

## 1. Create the API token

1. Open the [Hetzner Cloud Console](https://console.hetzner.com) and pick the
   project whose zones you want to manage.
2. Go to **Security → API tokens → Generate API token**.
3. Choose **Read & Write** for the full tool set, or **Read** if you only want
   the query tools.
4. Copy the token — the console shows it exactly once.

::: danger Not a DNS Console token
Tokens from the old DNS Console at `dns.hetzner.com` do **not** work. That API
was shut down in May 2026. The token you need starts life in the Cloud Console
under a project, not in the DNS Console.
:::

::: tip Give it its own project
The token can reach everything in its project, and this server has no way to
narrow that. A project containing only the zones you want managed is the
cheapest way to limit the blast radius.
:::

## 2. Connect it

The shortest path, for Claude Code:

```bash
claude mcp add hetzner-dns -s user \
  -e HETZNER_API_TOKEN=your-token \
  -- npx -y hetzner-dns-mcp
```

For Claude Desktop, Codex, the MCP Inspector or Docker, see
[Connecting clients](/guide/clients).

## 3. Check that it works

Ask the assistant to list your zones. It should call `list_zones` and come back
with names, modes and record counts. If it comes back with an error instead:

| Symptom                                                   | Cause                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `missing required environment variable HETZNER_API_TOKEN` | The `env` block did not reach the process                  |
| `HTTP 401`                                                | Wrong token, or a token from the old DNS Console           |
| `HTTP 403` on a write                                     | Read-only token                                            |
| Tools do not appear at all                                | The client could not start the command — check its MCP log |

The [FAQ](/guide/faq) goes through each of these in more detail.

## 4. Try a change

Ask for something harmless but real, like adding a TXT record. The first call
comes back refused, with a token:

```text
Refusing to replace the records of RRSet "@/TXT" of zone "example.com" without
confirmation. It currently holds 1 record(s), TTL 3600; all of them are replaced
by the 2 record(s) in this call. Use get_rrset to review the contents. Confirm
with the user, then call set_records again within 5 minutes with confirm_token:
"9f3c1a…" and the identical records — the token only works for exactly this list.
```

That is the intended flow, not a failure: the assistant should now ask you, and
only then call again with the token. If you would rather it never got that far,
see [read-only mode](/guide/configuration#read-only-mode).

## Running without credentials

The server starts, completes the MCP handshake and lists all its tools even
with no token set — registries and sandbox inspectors need that. The calls
themselves then fail with setup instructions. Nothing reaches the API.
