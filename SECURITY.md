# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/hetzner-dns-mcp/security/advisories/new). Do not open a public issue for an unpatched vulnerability and do not include real API tokens, zone names or DNS records in a report.

Only the latest release and the current `main` branch receive security fixes.

## Trust model

hetzner-dns-mcp is a stdio MCP server that manages real DNS zones. The `HETZNER_API_TOKEN` grants full access to every zone in its Hetzner Cloud project and is sent as a Bearer header to `HETZNER_API_BASE_URL` (https is enforced; plain http is only accepted for localhost, and URLs containing credentials are rejected). Anything that can read the server's process environment can read the token.

The MCP client decides which tools get called. Irreversible operations (`delete_zone`, `delete_rrset`, `import_zonefile`, `set_records`, `remove_records`, `change_primary_nameservers`, and the two `change_*_protection` tools when they remove protection) **ask a person** through MCP elicitation: a dialog raised by the server and shown by the client, which the model cannot answer on its behalf, and which nothing proceeds without.

Where the client cannot show a dialog, they fall back to a server-issued token — the first call is refused and returns a random single-use token with a five-minute lifetime, and only a second call repeating the identical arguments executes. Because that token only ever appears in a previous tool result, content coming back from the API — record values, comments, zone files — cannot talk the model into producing one. It does, however, prove only that the call was made twice with the same arguments, and the fallback text says so rather than implying somebody approved.

`ELICITATION=false` moves a capable client onto that fallback deliberately, for deployments where a dialog is the wrong shape. It does not remove the guard, and the server prints one line at startup saying it is off.

That is a guard rail against prompt injection and accidental calls, not an authorization boundary. A client that faithfully performs both steps can still destroy zones, so only connect the server to clients you trust with your DNS, and do not auto-approve the destructive tools in your MCP host.

Data returned by the API is marked as untrusted, secret-looking keys are redacted, oversized values and error bodies are truncated, and HTML error pages are dropped instead of being pasted into the model's context.

## Deployment recommendations

- Use a token from a dedicated Hetzner Cloud project that contains only the DNS zones this server should manage.
- Prefer a read-only token if you only need query tools, and set `HETZNER_READ_ONLY=true` so the write tools are never even registered.
- Treat `HETZNER_API_TOKEN` as a secret: pass it via the MCP client's `env` block, never on the command line or in files checked into version control.
- Leave `HETZNER_API_BASE_URL` unset unless you are testing against a local mock; the server warns when the token would be sent to a non-default host.
