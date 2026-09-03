import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  document,
  listOf,
  objectOf,
  untrustedFields,
} from '../output-schema.js';

import type { HetznerApi } from '../api.js';
import { READ_ONLY } from './annotations.js';

import { fingerprint } from '../resource-key.js';
import { errorResult, jsonResult, run } from '../result.js';
import {
  confirmTokenParam,
  labels,
  page,
  perPage,
  ttl,
  zone,
} from '../schema.js';
import type { ToolContext } from './context.js';

/**
 * The values a call is about to write, for the confirmation dialog.
 *
 * The caller's own arguments — not read back from the API, which is the
 * distinction this file is otherwise careful about. Without them the dialog is
 * byte-identical whether the zone is about to be transferred from the right
 * primaries or from somebody else's: "change the primary nameservers of zone X"
 * is true either way, and it is the only sentence the person sees.
 *
 * `tsig_key` is deliberately absent. It is a secret, the schema says so, and a
 * dialog is not the place to print one.
 */
function nameserverDetails(
  servers: readonly { address: string; port?: number | undefined }[]
): { label: string; value: string }[] {
  return servers.slice(0, 5).map((server, index) => ({
    label: `primary ${index + 1}`,
    value:
      server.port === undefined
        ? server.address
        : `${server.address} port ${server.port}`,
  }));
}

/**
 * A zone file is too big to show and too consequential to hide entirely.
 *
 * The lines that decide who answers — NS, MX, CNAME, CAA and the SOA — are the
 * ones worth reading before replacing a zone with them. Everything else is
 * summarised as a count.
 */
function zonefileDetails(zonefile: string): { label: string; value: string }[] {
  const lines = zonefile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(';'));
  const authority = lines.filter((line) =>
    /\b(SOA|NS|MX|CNAME|CAA)\b/i.test(line)
  );
  const details = authority.slice(0, 5).map((line, index) => ({
    label: `authority record ${index + 1}`,
    value: line,
  }));
  details.push({
    label: 'in total',
    value: `${lines.length} record line(s), ${authority.length} of them deciding who answers`,
  });
  return details;
}

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
  const { api, approval, confirmations, readOnly } = ctx;

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
      annotations: READ_ONLY,
      outputSchema: listOf('zones'),
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
      annotations: READ_ONLY,
      outputSchema: objectOf('zone'),
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
      annotations: READ_ONLY,
      outputSchema: z
        .object({
          ...untrustedFields,
          zonefile: z.string().describe('BIND format, as the API rendered it.'),
        })
        .catchall(z.unknown())
        .meta({ additionalProperties: true }),
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
      annotations: {
        // Additive. Two calls do not make two zones; Hetzner refuses a
        // duplicate name, but nothing is replaced either.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: objectOf('zone'),
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
      annotations: {
        // Replaces zone settings with the fields given.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: objectOf('zone'),
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
        'Permanently delete a DNS zone including all its records. This is irreversible. The first call returns a short-lived confirmation token; ask the user, then call again with confirm_token.',
      inputSchema: z.object({ zone, confirm_token: confirmTokenParam }),
      annotations: {
        // Idempotent by the specification's wording. It takes every record
        // in the zone with it.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z
        .object({ ...untrustedFields, action: document.optional() })
        .catchall(z.unknown())
        .meta({ additionalProperties: true }),
    },
    ({ zone, confirm_token }, mcp) =>
      run(async () => {
        const resource = `delete_zone:${zone}`;
        const count = await zoneRecordCount(api, zone);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `delete zone "${zone}"`,
            consequence: `It currently holds ${count}, and deleting removes all of them irreversibly.`,
            resourceKey: resource,
            token: confirm_token,
            toolName: 'delete_zone',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        // A mismatched token is refused with the reason rather than answered with
        // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. delete_zone did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;
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
        'Import a zone file (BIND format) into an existing primary zone. This REPLACES the current records of the zone. The first call returns a short-lived confirmation token bound to exactly this zone file; ask the user, then call again with confirm_token. Consider export_zonefile first as a backup.',
      inputSchema: z.object({
        zone,
        zonefile: z.string().min(1).describe('Zone file content to import'),
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Replaces the whole zone content with the file. Whatever was served
        // before is gone, and the same file imported twice leaves the same
        // zone.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: objectOf('zone'),
    },
    ({ zone, zonefile, confirm_token }, mcp) =>
      run(async () => {
        // The token is bound to the zone file too: a confirmation for one
        // import must not execute a different one.
        const resource = `import_zonefile:${zone}:${fingerprint(zonefile)}`;
        const count = await zoneRecordCount(api, zone);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `import a zone file into zone "${zone}"`,
            consequence: `The zone currently holds ${count}, all of which are replaced by the import.`,
            details: zonefileDetails(zonefile),
            resourceKey: resource,
            token: confirm_token,
            toolName: 'import_zonefile',
            hint: 'Tick to go ahead, leave it to cancel.',
            fallbackNote:
              'The token only works for exactly this zonefile content.',
          }
        );
        // A mismatched token is refused with the reason rather than answered with
        // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. import_zonefile did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;
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
      annotations: {
        // A default for the zone, not its content.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: objectOf('zone'),
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
        'Enable or disable the delete protection of a DNS zone. Enabling is immediate; DISABLING removes the last safeguard against delete_zone and therefore needs a confirm_token, exactly like a deletion.',
      inputSchema: z.object({
        zone,
        delete: z
          .boolean()
          .describe(
            'true to protect the zone from deletion, false to unprotect'
          ),
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // A state. Removing it is guarded because it is the rail in front of
        // delete_zone.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z
        .object({ ...untrustedFields, action: document.optional() })
        .catchall(z.unknown())
        .meta({ additionalProperties: true }),
    },
    ({ zone, delete: deleteProtection, confirm_token }, mcp) =>
      run(async () => {
        // Enabling protection is safe; removing it is the first half of a
        // deletion and gets the same gate.
        if (!deleteProtection) {
          const resource = `change_zone_protection:${zone}`;
          const outcome = await approval.requestApproval(
            server,
            mcp,
            confirmations,
            {
              what: `remove the delete protection of zone "${zone}"`,
              consequence: 'Doing so makes the zone deletable.',
              resourceKey: resource,
              token: confirm_token,
              toolName: 'change_zone_protection',
              hint: 'Tick to go ahead, leave it to cancel.',
            }
          );
          // A mismatched token is refused with the reason rather than answered with
          // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
          if (outcome.decision === 'rejected')
            return errorResult(outcome.reason);
          if (outcome.decision === 'declined') {
            return errorResult(
              `The user declined. change_zone_protection did nothing.`
            );
          }
          if (outcome.decision === 'pending') return outcome.result;
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
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Replaces the primaries the entire zone is transferred from, so what
        // is served today is replaced by what they hold.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z
        .object({ ...untrustedFields, action: document.optional() })
        .catchall(z.unknown())
        .meta({ additionalProperties: true }),
    },
    ({ zone, primary_nameservers, confirm_token }, mcp) =>
      run(async () => {
        const resource = `change_primary_nameservers:${zone}:${fingerprint(primary_nameservers)}`;
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `change the primary nameservers of zone "${zone}"`,
            consequence: `The entire zone content will be transferred from the ${primary_nameservers.length} new primaries, replacing what is served today. Use get_zone to review the current primaries.`,
            details: nameserverDetails(primary_nameservers),
            resourceKey: resource,
            token: confirm_token,
            toolName: 'change_primary_nameservers',
            hint: 'Tick to go ahead, leave it to cancel.',
            fallbackNote:
              'The token only works for exactly this nameserver list.',
          }
        );
        // A mismatched token is refused with the reason rather than answered with
        // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(
            `The user declined. change_primary_nameservers did nothing.`
          );
        }
        if (outcome.decision === 'pending') return outcome.result;
        return jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/actions/change_primary_nameservers`,
            { primary_nameservers }
          )
        );
      })
  );
}
