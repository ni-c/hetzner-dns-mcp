/**
 * The tools this server can register, declared rather than discovered.
 *
 * Declared, because the tool filter has to answer "is this a name you have?"
 * *before* anything is registered — and in read-only mode the write tools are
 * never registered at all. Deriving the catalogue from what actually reached
 * `registerTool` would make `HETZNER_ALLOW_TOOLS=delete_zone` report "unknown
 * tool" under `HETZNER_READ_ONLY=true`, which is the one answer that is wrong.
 *
 * `test/tool-filter.test.ts` asserts that these lists and the tools the server
 * really registers are the same set, so the duplication cannot drift.
 */

/** Registered always. Every one carries `readOnlyHint: true`. */
export const READ_TOOLS = [
  'export_zonefile',
  'get_rrset',
  'get_zone',
  'get_zone_action',
  'list_rrsets',
  'list_zone_actions',
  'list_zones',
] as const;

/** Registered unless `HETZNER_READ_ONLY` is set. */
export const WRITE_TOOLS = [
  'add_records',
  'change_primary_nameservers',
  'change_rrset_protection',
  'change_rrset_ttl',
  'change_zone_protection',
  'change_zone_ttl',
  'create_rrset',
  'create_zone',
  'delete_rrset',
  'delete_zone',
  'import_zonefile',
  'remove_records',
  'set_records',
  'update_rrset',
  'update_zone',
] as const;

/** Every tool, read-only mode aside. */
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS];

/**
 * What `HETZNER_ALLOW_TOOLS=essential` selects: read a zone, change a record.
 *
 * Eight of twenty-two, chosen for the two things people actually come here to
 * do. `set_records` subsumes `add_records`/`remove_records`; `export_zonefile`
 * answers "show me everything" in one call. Left out on purpose:
 * `create_zone`/`delete_zone`/`import_zonefile` (rare and catastrophic), the
 * TTL and protection tools, and the async action-polling pair.
 */
export const ESSENTIAL_TOOLS: readonly string[] = [
  'list_zones',
  'get_zone',
  'list_rrsets',
  'get_rrset',
  'create_rrset',
  'set_records',
  'delete_rrset',
  'export_zonefile',
];
