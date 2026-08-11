import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HetznerApi } from '../api.js';
import { errorResult, jsonResult, run } from '../result.js';
import { labels, page, perPage, ttl, zone } from '../schema.js';

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

async function zoneName(api: HetznerApi, idOrName: string): Promise<string> {
  const response = (await api.get(
    `/zones/${encodeURIComponent(idOrName)}`
  )) as { zone?: { name?: string } };
  return response.zone?.name ?? 'unknown';
}

export function registerZoneTools(server: McpServer, api: HetznerApi): void {
  server.registerTool(
    'list_zones',
    {
      title: 'List DNS zones',
      description:
        'List the DNS zones of the Hetzner Cloud project, including status, mode, default TTL, assigned nameservers and record counts.',
      inputSchema: {
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
      },
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
      inputSchema: { zone },
      annotations: { readOnlyHint: true },
    },
    ({ zone }) =>
      run(async () =>
        jsonResult(await api.get(`/zones/${encodeURIComponent(zone)}`))
      )
  );

  server.registerTool(
    'create_zone',
    {
      title: 'Create DNS zone',
      description:
        'Create a new DNS zone. Use mode "primary" for zones managed at Hetzner, or "secondary" with primary_nameservers to transfer the zone from external primaries. A primary zone can optionally be initialized from a zone file.',
      inputSchema: {
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
      },
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
      inputSchema: { zone, labels },
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
        'Permanently delete a DNS zone including all its records. This is irreversible. Requires confirm=true.',
      inputSchema: {
        zone,
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Must be true to actually delete the zone. Ask the user for confirmation first.'
          ),
      },
      annotations: { destructiveHint: true },
    },
    ({ zone, confirm }) =>
      run(async () => {
        const name = await zoneName(api, zone);
        if (!confirm) {
          return errorResult(
            `Refusing to delete zone "${name}" without confirmation. ` +
              'Deleting a zone removes all its DNS records irreversibly. ' +
              'Call delete_zone again with confirm=true after the user confirmed.'
          );
        }
        return jsonResult(
          await api.delete(`/zones/${encodeURIComponent(zone)}`)
        );
      })
  );

  server.registerTool(
    'export_zonefile',
    {
      title: 'Export zone file',
      description:
        'Export the full contents of a DNS zone as a zone file (BIND format).',
      inputSchema: { zone },
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

  server.registerTool(
    'import_zonefile',
    {
      title: 'Import zone file',
      description:
        'Import a zone file (BIND format) into an existing primary zone. This REPLACES the current records of the zone. Requires confirm=true. Consider export_zonefile first as a backup.',
      inputSchema: {
        zone,
        zonefile: z.string().min(1).describe('Zone file content to import'),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Must be true to actually import. Ask the user for confirmation first.'
          ),
      },
      annotations: { destructiveHint: true },
    },
    ({ zone, zonefile, confirm }) =>
      run(async () => {
        const name = await zoneName(api, zone);
        if (!confirm) {
          return errorResult(
            `Refusing to import a zone file into zone "${name}" without confirmation. ` +
              'Importing replaces the current records of the zone. ' +
              'Call import_zonefile again with confirm=true after the user confirmed.'
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
      inputSchema: { zone, ttl },
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
        'Enable or disable the delete protection of a DNS zone. A protected zone cannot be deleted until the protection is removed.',
      inputSchema: {
        zone,
        delete: z
          .boolean()
          .describe(
            'true to protect the zone from deletion, false to unprotect'
          ),
      },
      annotations: { idempotentHint: true },
    },
    ({ zone, delete: deleteProtection }) =>
      run(async () =>
        jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/actions/change_protection`,
            { delete: deleteProtection }
          )
        )
      )
  );

  server.registerTool(
    'change_primary_nameservers',
    {
      title: 'Change primary nameservers',
      description:
        'Replace the primary nameservers of a secondary zone (the servers Hetzner transfers the zone from). The ENTIRE zone content will be taken from the new primaries on the next transfer. Only applicable to zones in secondary mode. Requires confirm=true.',
      inputSchema: {
        zone,
        primary_nameservers: primaryNameservers,
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Must be true to actually change the primary nameservers. Ask the user for confirmation first.'
          ),
      },
      annotations: { destructiveHint: true },
    },
    ({ zone, primary_nameservers, confirm }) =>
      run(async () => {
        if (!confirm) {
          const response = (await api.get(
            `/zones/${encodeURIComponent(zone)}`
          )) as {
            zone?: {
              name?: string;
              primary_nameservers?: { address?: string; port?: number }[];
            };
          };
          const current = (response.zone?.primary_nameservers ?? [])
            .map((ns) => `${ns.address ?? '?'}:${ns.port ?? 53}`)
            .join(', ');
          return errorResult(
            `Refusing to change the primary nameservers of zone "${response.zone?.name ?? zone}" without confirmation. ` +
              'The entire zone content will be transferred from the new primaries. ' +
              `Current primary nameservers: ${current || '(none)'}. ` +
              'Call change_primary_nameservers again with confirm=true after the user confirmed.'
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
