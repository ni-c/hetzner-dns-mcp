# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/hetzner-dns-mcp/security/advisories/new). Do not open a public issue for an unpatched vulnerability and do not include real API tokens, zone names or DNS records in a report.

Only the latest release and the current `main` branch receive security fixes.

## Trust model

hetzner-dns-mcp is a stdio MCP server that manages real DNS zones. The `HETZNER_API_TOKEN` grants full access to every zone in its Hetzner Cloud project and is sent as a Bearer header to `HETZNER_API_BASE_URL` (https is enforced; plain http is only accepted for localhost, and URLs containing credentials are rejected). Anything that can read the server's process environment can read the token.

The MCP client decides which tools get called. Destructive operations (`delete_zone`, `delete_rrset`, `import_zonefile`, `set_records`, `remove_records`, `change_primary_nameservers`) additionally require an explicit `confirm` parameter, but a client that sets it can still destroy zones. Only connect the server to clients you trust with your DNS.

## Deployment recommendations

- Use a token from a dedicated Hetzner Cloud project that contains only the DNS zones this server should manage.
- Prefer a read-only token if you only need query tools.
- Treat `HETZNER_API_TOKEN` as a secret: pass it via the MCP client's `env` block, never on the command line or in files checked into version control.
- Leave `HETZNER_API_BASE_URL` unset unless you are testing against a local mock; the server warns when the token would be sent to a non-default host.
