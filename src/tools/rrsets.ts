import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HetznerApi } from '../api.js';
import { errorResult, jsonResult, run } from '../result.js';
import {
  RRSET_TYPES,
  labels,
  page,
  perPage,
  records,
  rrsetName,
  rrsetPath,
  rrsetType,
  ttl,
  zone,
} from '../schema.js';

export function registerRrsetTools(server: McpServer, api: HetznerApi): void {
  server.registerTool(
    'list_rrsets',
    {
      title: 'List RRSets',
      description:
        'List the RRSets (DNS record sets) of a zone, including their records, TTLs and protection status.',
      inputSchema: {
        zone,
        name: z
          .string()
          .optional()
          .describe('Filter RRSets by name, e.g. "www"'),
        type: z
          .array(z.enum(RRSET_TYPES))
          .optional()
          .describe('Filter RRSets by type(s), e.g. ["A", "AAAA"]'),
        label_selector: z
          .string()
          .optional()
          .describe('Filter RRSets by label selector'),
        page,
        per_page: perPage,
      },
      annotations: { readOnlyHint: true },
    },
    ({ zone, name, type, label_selector, page, per_page }) =>
      run(async () =>
        jsonResult(
          await api.get(`/zones/${encodeURIComponent(zone)}/rrsets`, {
            name,
            type,
            label_selector,
            page,
            per_page,
          })
        )
      )
  );

  server.registerTool(
    'get_rrset',
    {
      title: 'Get RRSet',
      description:
        'Get a single RRSet (DNS record set) of a zone by name and type.',
      inputSchema: { zone, name: rrsetName, type: rrsetType },
      annotations: { readOnlyHint: true },
    },
    ({ zone, name, type }) =>
      run(async () =>
        jsonResult(
          await api.get(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}`
          )
        )
      )
  );

  server.registerTool(
    'create_rrset',
    {
      title: 'Create RRSet',
      description:
        'Create a new RRSet (DNS record set) in a zone, e.g. an A record for "www". Fails if an RRSet with the same name and type already exists — use set_records or add_records in that case.',
      inputSchema: {
        zone,
        name: rrsetName,
        type: rrsetType,
        records,
        ttl: ttl
          .optional()
          .describe(
            "Time To Live in seconds. If omitted, the zone's default TTL applies."
          ),
        labels: labels.optional(),
      },
      annotations: {},
    },
    ({ zone, name, type, records, ttl, labels }) =>
      run(async () =>
        jsonResult(
          await api.post(`/zones/${encodeURIComponent(zone)}/rrsets`, {
            name,
            type,
            records,
            ...(ttl !== undefined && { ttl }),
            ...(labels !== undefined && { labels }),
          })
        )
      )
  );

  server.registerTool(
    'update_rrset',
    {
      title: 'Update RRSet labels',
      description:
        'Update the labels of an RRSet. The given set replaces all existing labels. (Records and TTL are changed via set_records/add_records/remove_records and change_rrset_ttl.)',
      inputSchema: { zone, name: rrsetName, type: rrsetType, labels },
      annotations: { idempotentHint: true },
    },
    ({ zone, name, type, labels }) =>
      run(async () =>
        jsonResult(
          await api.put(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}`,
            { labels }
          )
        )
      )
  );

  server.registerTool(
    'delete_rrset',
    {
      title: 'Delete RRSet',
      description:
        'Permanently delete an RRSet (DNS record set) with all its records. This is irreversible. Requires confirm=true.',
      inputSchema: {
        zone,
        name: rrsetName,
        type: rrsetType,
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Must be true to actually delete the RRSet. Ask the user for confirmation first.'
          ),
      },
      annotations: { destructiveHint: true },
    },
    ({ zone, name, type, confirm }) =>
      run(async () => {
        if (!confirm) {
          const current = await api.get(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}`
          );
          return errorResult(
            `Refusing to delete RRSet "${name}/${type}" of zone "${zone}" without confirmation. ` +
              'Deleting is irreversible. Call delete_rrset again with confirm=true after the user confirmed.\n' +
              `Current contents:\n${JSON.stringify(current, null, 2)}`
          );
        }
        return jsonResult(
          await api.delete(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}`
          )
        );
      })
  );

  server.registerTool(
    'set_records',
    {
      title: 'Set records of an RRSet',
      description:
        'Replace ALL records of an RRSet with the given records. Existing records not listed are removed. Use add_records to append instead.',
      inputSchema: { zone, name: rrsetName, type: rrsetType, records },
      annotations: { destructiveHint: true },
    },
    ({ zone, name, type, records }) =>
      run(async () =>
        jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/set_records`,
            { records }
          )
        )
      )
  );

  server.registerTool(
    'add_records',
    {
      title: 'Add records to an RRSet',
      description:
        'Add records to an RRSet. Existing records are kept. Creates the RRSet if it does not exist yet.',
      inputSchema: {
        zone,
        name: rrsetName,
        type: rrsetType,
        records,
        ttl: ttl
          .optional()
          .describe(
            "Time To Live in seconds. If omitted, the zone's default TTL applies."
          ),
      },
      annotations: {},
    },
    ({ zone, name, type, records, ttl }) =>
      run(async () =>
        jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/add_records`,
            { records, ...(ttl !== undefined && { ttl }) }
          )
        )
      )
  );

  server.registerTool(
    'remove_records',
    {
      title: 'Remove records from an RRSet',
      description:
        'Remove specific records (matched by value) from an RRSet. Removing the last record deletes the RRSet.',
      inputSchema: { zone, name: rrsetName, type: rrsetType, records },
      annotations: { destructiveHint: true },
    },
    ({ zone, name, type, records }) =>
      run(async () =>
        jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/remove_records`,
            { records }
          )
        )
      )
  );

  server.registerTool(
    'change_rrset_ttl',
    {
      title: 'Change RRSet TTL',
      description:
        "Change the Time To Live (TTL) of an RRSet. Pass null to fall back to the zone's default TTL.",
      inputSchema: {
        zone,
        name: rrsetName,
        type: rrsetType,
        ttl: ttl
          .nullable()
          .describe(
            "Time To Live in seconds, or null to use the zone's default TTL"
          ),
      },
      annotations: { idempotentHint: true },
    },
    ({ zone, name, type, ttl }) =>
      run(async () =>
        jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/change_ttl`,
            { ttl }
          )
        )
      )
  );

  server.registerTool(
    'change_rrset_protection',
    {
      title: 'Change RRSet protection',
      description:
        'Enable or disable the change protection of an RRSet. A protected RRSet cannot be changed or deleted until the protection is removed.',
      inputSchema: {
        zone,
        name: rrsetName,
        type: rrsetType,
        change: z
          .boolean()
          .describe(
            'true to protect the RRSet from changes and deletion, false to unprotect'
          ),
      },
      annotations: { idempotentHint: true },
    },
    ({ zone, name, type, change }) =>
      run(async () =>
        jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/change_protection`,
            { change }
          )
        )
      )
  );
}
