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

## Choosing the tools that load

Read-only mode is one cut, along a line this server drew for you. The other two
variables let you draw your own:

```bash
HETZNER_ALLOW_TOOLS=essential
HETZNER_ALLOW_TOOLS=list_*,get_zone,set_records
HETZNER_DENY_TOOLS=delete_zone,import_zonefile
```

Why bother, when all twenty-two work: a model chooses the right tool far more
reliably from a handful than from a long list, and every tool it can see costs
context on every single request. If this is the only MCP server in a session,
twenty-two is fine. If it is one of six, it is not.

**The syntax.** Comma-separated entries. An entry is either an exact tool name
or a prefix with a trailing `*` — `list_*` matches every tool whose name starts
with `list_`. Entries are trimmed and case-insensitive, empty ones are ignored,
and an empty value counts as unset. Nothing else is a pattern: `*_zone` and
`list_*_x` are rejected rather than silently matching nothing.

**`essential`** is a curated preset of eight, covering the two things people
actually come here to do — read a zone, change a record:

`list_zones` · `get_zone` · `list_rrsets` · `get_rrset` · `create_rrset` ·
`set_records` · `delete_rrset` · `export_zonefile`

`set_records` subsumes `add_records` and `remove_records`, and `export_zonefile`
answers "show me everything" in one call. Left out on purpose: creating and
deleting whole zones, importing a zone file, the TTL and protection tools, and
the asynchronous action polling. It composes — `essential,update_zone` adds one
back, and `HETZNER_DENY_TOOLS` takes one away.

**Both together.** `HETZNER_ALLOW_TOOLS` decides what is in;
`HETZNER_DENY_TOOLS` is then subtracted from the result. With only a deny list,
everything else stays.

**A name that matches nothing stops the server**, with the offending entry and
the list of real names. That is deliberate: the alternative is a tool quietly
missing from `tools/list`, and nobody traces an absence back to an environment
variable. The same applies to a pattern that matches no tool, which is what
catches `delet_*`.

**With read-only mode**, the write tools are not registered at all, so naming
one explicitly in `HETZNER_ALLOW_TOOLS` is an error that says so — rather than
calling a tool unknown when it plainly exists. A _pattern_ that covers write
tools is fine and simply contributes nothing, which is what makes
`get_*,create_*` a usable template for both kinds of deployment; and
`HETZNER_ALLOW_TOOLS=essential` narrows to the read half of the preset.

::: tip It is the same cut, not a second one
A filtered tool is never registered, so it is absent from `tools/list` and
unknown to `tools/call` alike — exactly what `HETZNER_READ_ONLY` does to a write
tool. There is no "hidden but callable" state to reason about.
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
