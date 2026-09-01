# Tools

22 tools, in three groups. Tools marked **read-only** are the ones that survive
`HETZNER_READ_ONLY=true`; tools marked **needs `confirm_token`** refuse their
first call and return a token (see [Security](/guide/security#confirmation-tokens)).

All 22 are registered unless you say otherwise. `HETZNER_ALLOW_TOOLS` and
`HETZNER_DENY_TOOLS` narrow the list to the ones you want, and `essential`
selects a curated eight — see
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).

Shared argument types:

| Argument           | Type                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `zone`             | Zone ID or name, `[A-Za-z0-9._-]+`, e.g. `example.com`                                                            |
| `name`             | RRSet name relative to the zone, `[A-Za-z0-9@*._-]+`, e.g. `www` or `@` for the apex                              |
| `type`             | `A`, `AAAA`, `CAA`, `CNAME`, `DS`, `HINFO`, `HTTPS`, `MX`, `NS`, `PTR`, `RP`, `SOA`, `SRV`, `SVCB`, `TLSA`, `TXT` |
| `records`          | Array of `{ value, comment? }`, at least one; `value` is zone-file syntax                                         |
| `ttl`              | Integer seconds, 60 – 2147483647                                                                                  |
| `labels`           | Object of string key/value pairs                                                                                  |
| `page`, `per_page` | Pagination; `per_page` 1 – 100, default 25                                                                        |

## Zones

### `list_zones` <Badge type="tip" text="read-only" />

List the zones of the project with status, mode, default TTL, assigned
nameservers and record counts.

**Arguments:** `name?` (exact match), `mode?` (`primary` | `secondary`),
`label_selector?` (e.g. `env=prod`), `page?`, `per_page?`

### `get_zone` <Badge type="tip" text="read-only" />

Full details of a single zone.

**Arguments:** `zone`

### `create_zone`

Create a zone. `primary` for zones managed at Hetzner, `secondary` with
`primary_nameservers` to transfer from external primaries. A primary zone can be
initialized from a zone file in the same call.

**Arguments:** `name`, `mode`, `ttl?`, `labels?`, `primary_nameservers?`,
`zonefile?`

::: warning
A `tsig_key` inside `primary_nameservers` becomes part of the conversation
context and the client transcript. Treat it as disclosed and rotate if in doubt.
:::

### `update_zone`

Replace the labels of a zone. The given set replaces **all** existing labels;
other properties have their own `change_zone_*` tools.

**Arguments:** `zone`, `labels`

### `delete_zone` <Badge type="danger" text="needs confirm_token" />

Permanently delete a zone and every record in it. The refusal reports how many
records the zone holds.

**Arguments:** `zone`, `confirm_token?`

### `export_zonefile` <Badge type="tip" text="read-only" />

Export the zone as a BIND zone file. Worth calling before any bulk change — it
is the only backup you get.

**Arguments:** `zone`

### `import_zonefile` <Badge type="danger" text="needs confirm_token" />

Import a BIND zone file into an existing primary zone, **replacing** its current
records. The token is bound to a hash of the zone file, so a confirmation for
one import cannot execute a different one. Returns an action to poll.

**Arguments:** `zone`, `zonefile`, `confirm_token?`

### `change_zone_ttl`

Change the zone's default TTL, which applies to RRSets without an explicit one.

**Arguments:** `zone`, `ttl`

### `change_zone_protection` <Badge type="danger" text="needs confirm_token to disable" />

Enable or disable delete protection. Enabling is immediate; disabling removes
the last safeguard in front of `delete_zone` and is gated like a deletion.

**Arguments:** `zone`, `delete` (boolean), `confirm_token?`

### `change_primary_nameservers` <Badge type="danger" text="needs confirm_token" />

Replace the primary nameservers of a secondary zone. The entire zone content is
taken from the new primaries on the next transfer. The token is bound to the
nameserver list.

**Arguments:** `zone`, `primary_nameservers`, `confirm_token?`

Each entry: `{ address, port?, tsig_key?, tsig_algorithm? }` with
`tsig_algorithm` one of `hmac-md5`, `hmac-sha1`, `hmac-sha256`.

## RRSets (record sets)

An RRSet is all records of one name and type — for example every `A` record for
`www`. Hetzner's API works in RRSets, not individual records, which is why
replacing one value means passing the whole set.

### `list_rrsets` <Badge type="tip" text="read-only" />

List the RRSets of a zone with records, TTLs and protection status.

**Arguments:** `zone`, `name?`, `type?` (array, e.g. `["A", "AAAA"]`),
`label_selector?`, `page?`, `per_page?`

### `get_rrset` <Badge type="tip" text="read-only" />

A single RRSet by name and type.

**Arguments:** `zone`, `name`, `type`

### `create_rrset`

Create a new RRSet. Fails if one with the same name and type exists — use
`set_records` or `add_records` then.

**Arguments:** `zone`, `name`, `type`, `records`, `ttl?`, `labels?`

### `update_rrset`

Replace the labels of an RRSet. Records and TTL have their own tools.

**Arguments:** `zone`, `name`, `type`, `labels`

### `delete_rrset` <Badge type="danger" text="needs confirm_token" />

Permanently delete an RRSet with all its records.

**Arguments:** `zone`, `name`, `type`, `confirm_token?`

### `set_records` <Badge type="danger" text="needs confirm_token" />

Replace **all** records of an RRSet. Anything not listed is removed. The token
is bound to a hash of the record list.

**Arguments:** `zone`, `name`, `type`, `records`, `confirm_token?`

### `add_records`

Append records to an RRSet, keeping the existing ones. Creates the RRSet if it
does not exist. Not gated — it adds rather than replaces.

**Arguments:** `zone`, `name`, `type`, `records`, `ttl?`

### `remove_records` <Badge type="danger" text="needs confirm_token" />

Remove specific records, matched by value. Removing the last one deletes the
RRSet. The token is bound to a hash of the record list.

**Arguments:** `zone`, `name`, `type`, `records`, `confirm_token?`

### `change_rrset_ttl`

Change an RRSet's TTL, or pass `null` to fall back to the zone default.

**Arguments:** `zone`, `name`, `type`, `ttl` (nullable)

### `change_rrset_protection` <Badge type="danger" text="needs confirm_token to disable" />

Enable or disable change protection. A protected RRSet cannot be changed or
deleted. Disabling is gated.

**Arguments:** `zone`, `name`, `type`, `change` (boolean), `confirm_token?`

## Actions

Slow operations — zone file imports above all — return an action instead of a
result. These two tools follow them.

### `list_zone_actions` <Badge type="tip" text="read-only" />

List actions of all zones, or of one zone if given.

**Arguments:** `zone?`, `status?` (array of `running` | `success` | `error`),
`page?`, `per_page?`

### `get_zone_action` <Badge type="tip" text="read-only" />

A single action by ID, to check its status and result.

**Arguments:** `action_id` (positive integer)

## Annotations

Every tool carries MCP annotations so a host can apply a permission policy
without hard-coding names:

| Annotation        | Tools                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `readOnlyHint`    | the seven read tools                                                                                            |
| `destructiveHint` | `delete_zone`, `delete_rrset`, `import_zonefile`, `set_records`, `remove_records`, `change_primary_nameservers` |
| `idempotentHint`  | `update_zone`, `update_rrset`, `change_zone_ttl`, `change_rrset_ttl`, both `change_*_protection`                |
