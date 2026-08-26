# Environment variables

Five variables, all read once at startup. There is no config file.

## `HETZNER_API_TOKEN`

**Required.** Hetzner Cloud API token for the project that holds the zones.

Create it in the [Cloud Console](https://console.hetzner.com) under **your
project → Security → API tokens**. Choose **Read & Write** for the full tool
set, **Read** for the query tools only.

- Sent as `Authorization: Bearer …` on every request.
- Deleted from `process.env` once read.
- Never logged, never included in an error message or a tool result.

Without it the server still starts, completes the MCP handshake and lists all
tools — registries and sandbox inspectors need that — but every call fails with
setup instructions and nothing reaches the API.

::: danger
A token from the old DNS Console (`dns.hetzner.com`) does not work. That API
was shut down in May 2026.
:::

## `HETZNER_READ_ONLY`

**Optional**, default `false`. Accepts `true`, `1` or `yes`, case-insensitively.

When set, only these seven tools are registered:

`list_zones` · `get_zone` · `export_zonefile` · `list_rrsets` · `get_rrset` ·
`list_zone_actions` · `get_zone_action`

The write tools are not registered at all, so a client asking for `delete_zone`
gets a protocol-level "tool not found". This is not a call-time refusal — there
is no code path from a write request to the API.

## `HETZNER_API_BASE_URL`

**Optional**, default `https://api.hetzner.cloud/v1`. Trailing slashes are
stripped.

Intended for pointing at a local mock during development. Validated before
anything is sent, because the token goes to whatever this names:

| Rule                                                 | On violation |
| ---------------------------------------------------- | ------------ |
| Must parse as a URL                                  | exit         |
| Must be `https` (`http` only for loopback hosts)     | exit         |
| Must not contain credentials (`https://user:pass@…`) | exit         |
| Non-default host                                     | warning      |

Loopback hosts are `localhost`, `127.0.0.1` and `[::1]`.

The value is never printed back on a parse failure — a malformed URL can still
contain a `user:token@` part, and startup messages end up in client logs.

Also deleted from `process.env` once read.

## `HETZNER_ALLOW_TOOLS`

**Optional**, unset by default — then every tool the mode allows is registered.

A comma-separated list of entries. Each entry is either an exact tool name or a
prefix followed by a single trailing `*`:

| Value                   | Registers                                        |
| ----------------------- | ------------------------------------------------ |
| `essential`             | the curated preset of eight (below)              |
| `list_zones,get_zone`   | exactly those two                                |
| `list_*`                | `list_rrsets`, `list_zone_actions`, `list_zones` |
| `essential,update_zone` | the preset plus one more                         |
| `*`                     | everything — the same as leaving it unset        |

The preset is:

`list_zones` · `get_zone` · `list_rrsets` · `get_rrset` · `create_rrset` ·
`set_records` · `delete_rrset` · `export_zonefile`

Entries are trimmed and matched case-insensitively; empty entries are ignored,
and a value that is empty or only whitespace counts as unset — `HETZNER_ALLOW_TOOLS=`
in a compose file does not mean "allow nothing".

**An entry that matches no tool aborts startup**, naming the entry and listing
the valid names. So does a malformed pattern such as `*_zone` or `list_*_x`,
where the `*` is not the last character. The alternative — ignoring the entry —
leaves a tool missing from `tools/list` with nothing pointing at the cause.

Under `HETZNER_READ_ONLY`, an exact write-tool name here is an error naming the
read-only setting rather than "unknown tool"; a _pattern_ covering write tools
is accepted and merely contributes nothing, with a warning on stderr.

## `HETZNER_DENY_TOOLS`

**Optional**, unset by default. Same syntax as `HETZNER_ALLOW_TOOLS`, minus the
`essential` keyword.

Subtracted from whatever `HETZNER_ALLOW_TOOLS` selected — or from every tool, if
that one is unset. `HETZNER_DENY_TOOLS=delete_zone,import_zonefile` is the usual
shape: keep everything, drop the two that cannot be undone.

A deny entry that matches no tool aborts startup, on the same reasoning. It may
match tools that are already absent — denying a write tool while
`HETZNER_READ_ONLY` is set is how a defensive list is written, and is not an
error.

If both lists remove everything, the server refuses to start rather than
offering an empty tool list.

## Not configurable

For completeness, the constants you might otherwise look for:

| Behaviour                   | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| Request timeout             | 30 s                                                    |
| Redirect handling           | refused                                                 |
| Confirmation token TTL      | 5 minutes, single use                                   |
| Pending confirmation tokens | 100 max, oldest evicted                                 |
| Per-value truncation        | 4 000 characters                                        |
| Per-result truncation       | 200 000 characters                                      |
| Error body truncation       | 2 000 characters; HTML dropped                          |
| Redacted key pattern        | `tsig_key`, `token`, `secret`, `password`, `credential` |
