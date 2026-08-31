import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HetznerApi } from '../api.js';
import { fingerprint } from '../confirm.js';
import { errorResult, jsonResult, run } from '../result.js';
import { confirmToken, labels, page, perPage, ttl, zone } from '../schema.js';
import type { ToolContext } from './context.js';

const primaryNameservers = z
  .array(
    z.object({
      address: z
        .string()
        .min(1)
        .describe('Public IPv4 or IPv6 address of the primary nameserver'),
      port: z.number().int().min(1).max(65535).optional().describe('Port'),
      tsig_key: z
        .string()
        .optional()
        .describe(
          'TSIG key to use for the zone transfer. Treat as a secret — it becomes part of the conversation context.'
        ),
      tsig_algorithm: z
        .enum(['hmac-md5', 'hmac-sha1', 'hmac-sha256'])
        .optional()
        .describe('TSIG algorithm'),
    })
  )
  .min(1)
  .describe('Primary nameservers to transfer the zone from (secondary zones)');

/**
 * Counts what a destructive call is about to affect, for the confirmation text.
 *
 * Only the number is used. Names, labels and record values from the API are
 * attacker-controlled — putting them into the very message that asks the model
 * to confirm would hand an injected instruction the last word.
 */
async function zoneRecordCount(
  api: HetznerApi,
  idOrName: string
): Promise<string> {
  try {
    const response = (await api.get(
      `/zones/${encodeURIComponent(idOrName)}`
    )) as { zone?: { record_count?: number } };
    const count = response.zone?.record_count;
    return typeof count === 'number'
      ? `${count} records`
      : 'an unknown number of records';
  } catch {
    return 'an unknown number of records';
  }
}

export function registerZoneTools(server: McpServer, ctx: ToolContext): void {
  const { api, confirmations, readOnly } = ctx;

  server.registerTool(
    'list_zones',
    {
      title: 'List DNS zones',
      description:
        'List the DNS zones of the Hetzner Cloud project, including status, mode, default TTL, assigned nameservers and record counts.',
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe('Filter zones by name (exact match)'),
        mode: z
          .enum(['primary', 'secondary'])
          .optional()
          .describe('Filter zones by mode'),
        label_selector: z
          .string()
          .optional()
          .describe('Filter zones by label selector, e.g. "env=prod"'),
        page,
        per_page: perPage,
      }),
      annotations: { readOnlyHint: true },
    },
    ({ name, mode, label_selector, page, per_page }) =>
      run(async () =>
        jsonResult(
          await api.get('/zones', {
            name,
            mode,
            label_selector,
            page,
            per_page,
          })
        )
      )
  );

  server.registerTool(
    'get_zone',
    {
      title: 'Get DNS zone',
      description: 'Get the full details of a single DNS zone.',
      inputSchema: z.object({ zone }),
      annotations: { readOnlyHint: true },
    },
    ({ zone }) =>
      run(async () =>
        jsonResult(await api.get(`/zones/${encodeURIComponent(zone)}`))
      )
  );

  server.registerTool(
    'export_zonefile',
    {
      title: 'Export zone file',
      description:
        'Export the full contents of a DNS zone as a zone file (BIND format).',
      inputSchema: z.object({ zone }),
      annotations: { readOnlyHint: true },
    },
    ({ zone }) =>
      run(async () => {
        const response = (await api.get(
          `/zones/${encodeURIComponent(zone)}/zonefile`
        )) as { zonefile?: string };
        return jsonResult(response);
      })
  );

  if (readOnly) return;

  server.registerTool(
    'create_zone',
    {
      title: 'Create DNS zone',
      description:
        'Create a new DNS zone. Use mode "primary" for zones managed at Hetzner, or "secondary" with primary_nameservers to transfer the zone from external primaries. A primary zone can optionally be initialized from a zone file.',
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe(
            'Name of the zone, e.g. "example.com" (without trailing dot)'
          ),
        mode: z.enum(['primary', 'secondary']).describe('Mode of the zone'),
        ttl: ttl
          .optional()
          .describe('Default Time To Live in seconds (60 to 2147483647)'),
        labels: labels.optional(),
        primary_nameservers: primaryNameservers.optional(),
        zonefile: z
          .string()
          .optional()
          .describe(
            'Zone file (BIND format) to initialize a primary zone with. Ignored for secondary zones.'
          ),
      }),
      annotations: {},
    },
    ({ name, mode, ttl, labels, primary_nameservers, zonefile }) =>
      run(async () =>
        jsonResult(
          await api.post('/zones', {
            name,
            mode,
            ...(ttl !== undefined && { ttl }),
            ...(labels !== undefined && { labels }),
            ...(primary_nameservers !== undefined && { primary_nameservers }),
            ...(zonefile !== undefined && { zonefile }),
          })
        )
      )
  );

  server.registerTool(
    'update_zone',
    {
      title: 'Update DNS zone labels',
      description:
        'Update the labels of a DNS zone. The given set replaces all existing labels. (Other zone properties are changed via the dedicated change_zone_* tools.)',
      inputSchema: z.object({ zone, labels }),
      annotations: { idempotentHint: true },
    },
    ({ zone, labels }) =>
      run(async () =>
        jsonResult(
          await api.put(`/zones/${encodeURIComponent(zone)}`, { labels })
        )
      )
  );

  server.registerTool(
    'delete_zone',
    {
      title: 'Delete DNS zone',
      description:
        'Permanently delete a DNS zone including all its records. This is irreversible. The first call returns a short-lived confirmation token; ask the user, then call again with confirmToken.',
      inputSchema: z.object({ zone, confirmToken }),
      annotations: { destructiveHint: true },
    },
    ({ zone, confirmToken }) =>
      run(async () => {
        const resource = `delete_zone:${zone}`;
        if (!confirmations.consume(resource, confirmToken)) {
          const count = await zoneRecordCount(api, zone);
          const token = confirmations.issue(resource);
          return errorResult(
            `Refusing to delete zone "${zone}" without confirmation. It currently holds ${count}, and deleting removes all of them irreversibly. ` +
              `Confirm with the user, then call delete_zone again within ${confirmations.ttlMinutes} minutes with confirmToken: "${token}".`
          );
        }
        return jsonResult(
          await api.delete(`/zones/${encodeURIComponent(zone)}`)
        );
      })
  );

  server.registerTool(
    'import_zonefile',
    {
      title: 'Import zone file',
      description:
        'Import a zone file (BIND format) into an existing primary zone. This REPLACES the current records of the zone. The first call returns a short-lived confirmation token bound to exactly this zone file; ask the user, then call again with confirmToken. Consider export_zonefile first as a backup.',
      inputSchema: z.object({
        zone,
        zonefile: z.string().min(1).describe('Zone file content to import'),
        confirmToken,
      }),
      annotations: { destructiveHint: true },
    },
    ({ zone, zonefile, confirmToken }) =>
      run(async () => {
        // The token is bound to the zone file too: a confirmation for one
        // import must not execute a different one.
        const resource = `import_zonefile:${zone}:${fingerprint(zonefile)}`;
        if (!confirmations.consume(resource, confirmToken)) {
          const count = await zoneRecordCount(api, zone);
          const token = confirmations.issue(resource);
          return errorResult(
            `Refusing to import a zone file into zone "${zone}" without confirmation. The zone currently holds ${count}, all of which are replaced by the import. ` +
              `Confirm with the user, then call import_zonefile again within ${confirmations.ttlMinutes} minutes with confirmToken: "${token}" and the identical zonefile — the token only works for exactly this content.`
          );
        }
        return jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/actions/import_zonefile`,
            { zonefile }
          )
        );
      })
  );

  server.registerTool(
    'change_zone_ttl',
    {
      title: 'Change zone default TTL',
      description:
        'Change the default Time To Live (TTL) of a DNS zone. Applies to RRSets without an explicit TTL.',
      inputSchema: z.object({ zone, ttl }),
      annotations: { idempotentHint: true },
    },
    ({ zone, ttl }) =>
      run(async () =>
        jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/actions/change_ttl`,
            { ttl }
          )
        )
      )
  );

  server.registerTool(
    'change_zone_protection',
    {
      title: 'Change zone protection',
      description:
        'Enable or disable the delete protection of a DNS zone. Enabling is immediate; DISABLING removes the last safeguard against delete_zone and therefore needs a confirmToken, exactly like a deletion.',
      inputSchema: z.object({
        zone,
        delete: z
          .boolean()
          .describe(
            'true to protect the zone from deletion, false to unprotect'
          ),
        confirmToken,
      }),
      annotations: { idempotentHint: true },
    },
    ({ zone, delete: deleteProtection, confirmToken }) =>
      run(async () => {
        // Enabling protection is safe; removing it is the first half of a
        // deletion and gets the same gate.
        if (!deleteProtection) {
          const resource = `change_zone_protection:${zone}`;
          if (!confirmations.consume(resource, confirmToken)) {
            const token = confirmations.issue(resource);
            return errorResult(
              `Refusing to remove the delete protection of zone "${zone}" without confirmation. Doing so makes the zone deletable. ` +
                `Confirm with the user, then call change_zone_protection again within ${confirmations.ttlMinutes} minutes with confirmToken: "${token}".`
            );
          }
        }
        return jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/actions/change_protection`,
            { delete: deleteProtection }
          )
        );
      })
  );

  server.registerTool(
    'change_primary_nameservers',
    {
      title: 'Change primary nameservers',
      description:
        'Replace the primary nameservers of a secondary zone (the servers Hetzner transfers the zone from). The ENTIRE zone content will be taken from the new primaries on the next transfer. Only applicable to zones in secondary mode. The first call returns a short-lived confirmation token bound to exactly this nameserver list.',
      inputSchema: z.object({
        zone,
        primary_nameservers: primaryNameservers,
        confirmToken,
      }),
      annotations: { destructiveHint: true },
    },
    ({ zone, primary_nameservers, confirmToken }) =>
      run(async () => {
        const resource = `change_primary_nameservers:${zone}:${fingerprint(primary_nameservers)}`;
        if (!confirmations.consume(resource, confirmToken)) {
          const token = confirmations.issue(resource);
          return errorResult(
            `Refusing to change the primary nameservers of zone "${zone}" without confirmation. The entire zone content will be transferred from the ${primary_nameservers.length} new primaries, replacing what is served today. Use get_zone to review the current primaries. ` +
              `Confirm with the user, then call change_primary_nameservers again within ${confirmations.ttlMinutes} minutes with confirmToken: "${token}" and the identical nameserver list.`
          );
        }
        return jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/actions/change_primary_nameservers`,
            { primary_nameservers }
          )
        );
      })
  );
}
