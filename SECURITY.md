# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/hetzner-dns-mcp/security/advisories/new). Do not open a public issue for an unpatched vulnerability and do not include real API tokens, zone names or DNS records in a report.

Only the latest release and the current `main` branch receive security fixes.

## Supported versions

Only the latest release and the current `main` branch receive security fixes.

## Trust model

hetzner-dns-mcp is a stdio MCP server that manages real DNS zones. The `HETZNER_API_TOKEN` grants full access to every zone in its Hetzner Cloud project and is sent as a Bearer header to `HETZNER_API_BASE_URL` (https is enforced; plain http is only accepted for localhost, and URLs containing credentials are rejected). Anything that can read the server's process environment can read the token.

The token's shape is checked at startup and again before every request, and it is never printed: not on the startup line, not in an error. That check exists because the HTTP layer is less careful — a token with a line break in it, which is what a paste wrapped by a terminal looks like, makes undici raise `Headers.append: "Bearer <the whole token>" is an invalid header value`, and a server that passes such a message on has put its credential in the model's context.

### Which tools ask a person

The MCP client decides which tools get called. These **ask a person** through MCP elicitation — a dialog raised by the server and shown by the client, which the model cannot answer on its behalf, and which nothing proceeds without:

| Tool                                                | When                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `delete_zone`, `delete_rrset`                       | always                                                                                                                                      |
| `import_zonefile`, `set_records`, `remove_records`  | always                                                                                                                                      |
| `change_primary_nameservers`                        | always                                                                                                                                      |
| `change_zone_protection`, `change_rrset_protection` | when they _remove_ protection                                                                                                               |
| `create_zone`                                       | when the call carries `primary_nameservers` or a `zonefile`                                                                                 |
| `create_rrset`, `add_records`                       | for a name or type that decides who answers — `NS`, `DS`, `MX`, `CNAME`, `CAA`, `TLSA`, `SVCB`, `HTTPS`, `SRV`, the apex `@`, or a wildcard |

The dialog is bound to every field the call will write, not only to the one that triggered it: the confirmation for an `add_records` is spent on that record list _and_ that TTL, and a token issued for one cannot redeem the other.

Two of these are worth spelling out because they are judgement calls rather than defaults:

- **`create_zone` is guarded by its payload, not by itself.** Creating an empty zone is additive and asks nobody. Creating one with primary nameservers or a zone file is not: those two arguments carry the whole content of the zone, and if the name is already delegated to Hetzner's nameservers that content is what the internet is served. They are the same payloads `change_primary_nameservers` and `import_zonefile` are guarded for.
- **Adding an `A` or `AAAA` record does not ask.** An address added beside an existing one takes a share of the traffic without anything being removed, so this is a real gap. It is left open deliberately: an address record is the most common thing anybody does here, and a dialog in front of every one of them teaches people to tick without reading. The destructive direction — `set_records`, `remove_records`, `delete_rrset` — is guarded whatever the type. Defend the additive direction with RRSet protection (`change_rrset_protection`) and with monitoring, not with this server's dialog.

Adding a `_acme-challenge` TXT does not ask either, for the same kind of reason: DNS-01 renewal runs unattended, the dialog cannot tell a real ACME client from a forged one, and what defends that name is CAA (which _is_ guarded) plus Certificate Transparency monitoring.

### What the tool filter can and cannot promise

`HETZNER_ALLOW_TOOLS` / `HETZNER_DENY_TOOLS` remove tools from the listing entirely. They cannot remove a _capability_ that another tool also has, and three pairs here overlap:

- `add_records` creates the RRSet if it does not exist, so denying `create_rrset` does not remove the ability to create one.
- `remove_records` deletes the RRSet when the last record goes, so denying `delete_rrset` does not remove the ability to delete one.
- `set_records` does what `add_records` and `remove_records` do together.

In each pair the _guard_ is the same on both sides, so the safety property holds; it is the operator's inventory that would be wrong. To take a capability away rather than a name, use `HETZNER_READ_ONLY=true`, or a Hetzner API token without write permission.

### The fallback, and what it proves

Where the client cannot show a dialog, the guarded tools fall back to a server-issued token — the first call is refused and returns a random single-use token with a five-minute lifetime, and only a second call repeating the identical arguments executes. Because that token only ever appears in a previous tool result, content coming back from the API — record values, comments, zone files — cannot talk the model into producing one. It does, however, prove only that the call was made twice with the same arguments, and the fallback text says so rather than implying somebody approved.

On protocol revision `2026-07-28` the dialog's answer travels back through the client as a sealed `requestState`. mcp-approval 0.8.1 and later spend that state on its first answer, accepted or declined, so the same sealed answer cannot be replayed inside its lifetime. That record is per process: restarting the server forgets both it and every pending confirmation token.

`ELICITATION=false` moves a capable client onto the two-call fallback deliberately, for deployments where a dialog is the wrong shape. It does not remove the guard, and the server prints one line at startup saying it is off.

That is a guard rail against prompt injection and accidental calls, not an authorization boundary. A client that faithfully performs both steps can still destroy zones, so only connect the server to clients you trust with your DNS, and do not auto-approve the destructive tools in your MCP host.

### What comes back from the API

Data returned by the API is marked as untrusted in both channels, and the fence around it cannot be closed by the data inside it. Keys that name a credential are redacted by the suffix of the normalised key — `password`, `secret`, `token`, `apikey`, `privatekey`, `passphrase`, `tsigkey` and their `-`/`_`-separated spellings — rather than by an exact list, so `git-password` is caught as readily as `password`. In the DNS part of the Hetzner Cloud API the only such field is `tsig_key`; the suffix rule is there for the field that gets added later.

Response bodies are read under a ceiling and the HTTP status is decided before the body, so a proxy answering `401` with a large login page still surfaces as a credential problem rather than as a size complaint. Error bodies are cleaned of control characters and cut; HTML error pages are dropped instead of being pasted into the model's context. Every response is shape-checked at the boundary rather than cast, so an empty body, a proxy's JSON or a missing key produces a readable answer rather than a schema violation with no cause.

## Deployment recommendations

- Use a token from a dedicated Hetzner Cloud project that contains only the DNS zones this server should manage.
- Prefer a read-only token if you only need query tools, and set `HETZNER_READ_ONLY=true` so the write tools are never even registered.
- Treat `HETZNER_API_TOKEN` as a secret: pass it via the MCP client's `env` block, never on the command line or in files checked into version control.
- Leave `HETZNER_API_BASE_URL` unset unless you are testing against a local mock; the server warns when the token would be sent to a non-default host.
