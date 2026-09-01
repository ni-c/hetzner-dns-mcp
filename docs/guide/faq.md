# FAQ & troubleshooting

## Every call comes back `HTTP 401`

Almost always the wrong kind of token. This server talks to the **Hetzner Cloud
API** (`api.hetzner.cloud`); tokens created in the old DNS Console
(`dns.hetzner.com`) do not work there, and that API was shut down in May 2026.

Create a fresh token in the [Cloud Console](https://console.hetzner.com) under
**your project → Security → API tokens**. If the token is recent and still
fails, check that it belongs to the project that actually holds the zones — a
token is scoped to one project and sees no zones outside it.

## A write comes back `HTTP 403`

The token is read-only. Generate a **Read & Write** token, or keep the
read-only one and set `HETZNER_READ_ONLY=true` so the write tools stop being
offered at all.

## A call comes back `HTTP 423`

The resource is protected on Hetzner's side. Remove the protection with
`change_zone_protection` or `change_rrset_protection` — which itself needs a
confirmation token, because removing protection is treated as destructive — and
then retry.

## A dialog appeared before my deletion

That is the [approval flow](/guide/approval) working. Where your client supports
MCP elicitation, anything irreversible raises a question the model cannot answer
on its behalf, and nothing happens until you answer it.

## The server keeps refusing my deletion, with a `confirm_token`

That is the **fallback**, for a client that cannot show a dialog. It was once the
only path; it is not any more. The first call returns a `confirm_token`, and the
second must repeat the **identical arguments** and include it.

If your client _can_ show dialogs and you are still seeing tokens, check whether
`ELICITATION` is set to `false` somewhere in the environment — it deliberately
carries no `HETZNER_` prefix, so it may have been meant for a different server.
The startup log of this one says so when it is off.

If the second call is refused too, one of these is true:

- More than five minutes passed. Tokens expire; call again for a fresh one.
- The arguments changed. For `set_records`, `remove_records`,
  `import_zonefile` and `change_primary_nameservers` the token is bound to a
  hash of the payload — even a reordered record list is a different payload.
- The token was already used. They are single-use.
- The server restarted. Tokens live in memory only.

## `missing required environment variable HETZNER_API_TOKEN`

The variable never reached the process. Client configurations set it in
different places:

- Claude Code — `-e HETZNER_API_TOKEN=…` on `claude mcp add`
- Claude Desktop / Codex — the `env` block of the server entry
- Docker — `-e HETZNER_API_TOKEN` **and** the variable present in the client's
  `env` block

Note that the server intentionally still starts and lists all its tools without
a token, so "the tools are there" is not evidence that the token arrived.

## The tools do not show up at all

The client could not start the command. Check its MCP log. Common causes: no
Node ≥ 22 on `PATH`, `npx` blocked by a corporate proxy, or a typo in the
command. Try running the same command by hand — it should print a line to
stderr and then wait silently for JSON-RPC on stdin.

## One tool I expected is missing

Something narrowed the list. In order of likelihood:

- `HETZNER_READ_ONLY` is set, and it is a write tool. `tools/list` returns seven.
- `HETZNER_ALLOW_TOOLS` is set and does not name it — remember that it is an
  allow list, so anything not named is out.
- `HETZNER_DENY_TOOLS` names it, possibly through a prefix such as `delete_*`.

A filtered tool is not registered at all, so it is missing from `tools/list` and
answers `tools/call` with "tool not found" — the same as a write tool under
read-only. There is no state where it is hidden but still callable.

What it is _not_ is a typo in one of those variables: an entry that matches no
tool stops the server at startup and says which entry it was. See
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).

## Can I stop it from changing anything?

Yes, two independent ways, best used together:

```json
"env": {
  "HETZNER_API_TOKEN": "a-read-only-token",
  "HETZNER_READ_ONLY": "true"
}
```

Read-only mode never registers the write tools, and a read-only token means the
API would refuse them anyway. See [Configuration](/guide/configuration#read-only-mode).

To cut further than "no writes" — say, five tools rather than seven — add
`HETZNER_ALLOW_TOOLS`; the two combine.

## Why is a result wrapped in `<untrusted-data>`?

Because record values, comments, labels and zone files are written by whoever
controls the zone, which is not necessarily you — think of a secondary zone
transferred from an external primary. The envelope tells the model to treat
that content as data to report, not instructions to follow. See
[Security](/guide/security#untrusted-upstream-data).

## A result says it was truncated

Single values are capped at 4 000 characters and a whole result at 200 000, so
one large zone cannot fill the context window. Narrow the query instead of
retrying: `per_page` and `page` on the list tools, or `get_rrset` for a single
record set. For a full zone dump, `export_zonefile` returns the zone file, but
very large zones will still be cut.

## Does it support the old DNS API?

No, and it will not. `dns.hetzner.com` was shut down in May 2026. If you have
scripts still using it, they are already broken for reasons unrelated to this
server.

## Can I run it against something other than Hetzner?

`HETZNER_API_BASE_URL` exists for pointing at a local mock during development.
It is validated (https only, no credentials in the URL, warning on a non-default
host) precisely because your token gets sent there. It is not a way to use this
against a different DNS provider — the request shapes are Hetzner's.

## Where do I report a bug?

[Issues](https://github.com/ni-c/hetzner-dns-mcp/issues) for reproducible
problems, [Discussions](https://github.com/ni-c/hetzner-dns-mcp/discussions) for
questions, and
[private reporting](https://github.com/ni-c/hetzner-dns-mcp/security/advisories/new)
for anything security-related. Please redact tokens, real zone names and
records — issues are public.
