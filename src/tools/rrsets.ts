import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  RRSET_TYPES,
  confirmTokenParam,
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

import type { HetznerApi } from '../api.js';

import { fingerprint } from '../resource-key.js';
import { errorResult, jsonResult, run } from '../result.js';
import type { ToolContext } from './context.js';

/**
 * Describes the RRSet a destructive call is about to change, in numbers only.
 *
 * Record values and comments are written by whoever controls the zone, so they
 * must not appear in a confirmation message that a model reads and acts on.
 */
async function rrsetSummary(
  api: HetznerApi,
  zone: string,
  name: string,
  type: string
): Promise<string> {
  try {
    const response = (await api.get(
      `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}`
    )) as { rrset?: { records?: unknown[]; ttl?: number | null } };
    const count = response.rrset?.records?.length;
    if (typeof count !== 'number')
      return 'currently holds an unknown number of records';
    const ttl = response.rrset?.ttl;
    const ttlText = typeof ttl === 'number' ? `, TTL ${ttl}` : '';
    return `currently holds ${count} record(s)${ttlText}`;
  } catch {
    return 'currently holds an unknown number of records';
  }
}

export function registerRrsetTools(server: McpServer, ctx: ToolContext): void {
  const { api, approval, confirmations, readOnly } = ctx;

  server.registerTool(
    'list_rrsets',
    {
      title: 'List RRSets',
      description:
        'List the RRSets (DNS record sets) of a zone, including their records, TTLs and protection status.',
      inputSchema: z.object({
        zone,
        name: z
          .string()
          .optional()
          .describe(
            'Filter RRSets by name, e.g. "www" or "@" for the zone apex'
          ),
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
      }),
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
      inputSchema: z.object({ zone, name: rrsetName, type: rrsetType }),
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

  if (readOnly) return;

  server.registerTool(
    'create_rrset',
    {
      title: 'Create RRSet',
      description:
        'Create a new RRSet (DNS record set) in a zone, e.g. an A record for "www". Fails if an RRSet with the same name and type already exists — use set_records or add_records in that case.',
      inputSchema: z.object({
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
      }),
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
      inputSchema: z.object({ zone, name: rrsetName, type: rrsetType, labels }),
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
        'Permanently delete an RRSet (DNS record set) with all its records. This is irreversible. The first call returns a short-lived confirmation token; ask the user, then call again with confirm_token.',
      inputSchema: z.object({
        zone,
        name: rrsetName,
        type: rrsetType,
        confirm_token: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
    },
    ({ zone, name, type, confirm_token }, mcp) =>
      run(async () => {
        const resource = `delete_rrset:${zone}${rrsetPath(name, type)}`;
        const summary = await rrsetSummary(api, zone, name, type);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `delete RRSet "${name}/${type}" of zone "${zone}"`,
            consequence: `It ${summary}, and deleting is irreversible. Use get_rrset to review the contents.`,
            resourceKey: resource,
            token: confirm_token,
            toolName: 'delete_rrset',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        // A mismatched token is refused with the reason rather than answered with
        // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. delete_rrset did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;
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
        'Replace ALL records of an RRSet with the given records. Existing records not listed are removed. Use add_records to append instead. The first call returns a short-lived confirmation token bound to exactly this record list.',
      inputSchema: z.object({
        zone,
        name: rrsetName,
        type: rrsetType,
        records,
        confirm_token: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
    },
    ({ zone, name, type, records, confirm_token }, mcp) =>
      run(async () => {
        // Binding the token to the record list stops a confirmation obtained
        // for one set of values from writing a different one.
        const resource = `set_records:${zone}${rrsetPath(name, type)}:${fingerprint(records)}`;
        const summary = await rrsetSummary(api, zone, name, type);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `replace the records of RRSet "${name}/${type}" of zone "${zone}"`,
            consequence: `It ${summary}; all of them are replaced by the ${records.length} record(s) in this call. Use get_rrset to review the contents.`,
            resourceKey: resource,
            token: confirm_token,
            toolName: 'set_records',
            hint: 'Tick to go ahead, leave it to cancel.',
            fallbackNote: 'The token only works for exactly this record list.',
          }
        );
        // A mismatched token is refused with the reason rather than answered with
        // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. set_records did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;
        return jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/set_records`,
            { records }
          )
        );
      })
  );

  server.registerTool(
    'add_records',
    {
      title: 'Add records to an RRSet',
      description:
        'Add records to an RRSet. Existing records are kept. Creates the RRSet if it does not exist yet.',
      inputSchema: z.object({
        zone,
        name: rrsetName,
        type: rrsetType,
        records,
        ttl: ttl
          .optional()
          .describe(
            "Time To Live in seconds. If omitted, the zone's default TTL applies."
          ),
      }),
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
        'Remove specific records (matched by value) from an RRSet. Removing the last record deletes the RRSet. The first call returns a short-lived confirmation token bound to exactly this record list.',
      inputSchema: z.object({
        zone,
        name: rrsetName,
        type: rrsetType,
        records,
        confirm_token: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
    },
    ({ zone, name, type, records, confirm_token }, mcp) =>
      run(async () => {
        const resource = `remove_records:${zone}${rrsetPath(name, type)}:${fingerprint(records)}`;
        const summary = await rrsetSummary(api, zone, name, type);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `remove records from RRSet "${name}/${type}" of zone "${zone}"`,
            consequence: `It ${summary}; this call removes ${records.length} of them, and removing the last record deletes the RRSet. Use get_rrset to review the contents.`,
            resourceKey: resource,
            token: confirm_token,
            toolName: 'remove_records',
            hint: 'Tick to go ahead, leave it to cancel.',
            fallbackNote: 'The token only works for exactly this record list.',
          }
        );
        // A mismatched token is refused with the reason rather than answered with
        // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. remove_records did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;
        return jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/remove_records`,
            { records }
          )
        );
      })
  );

  server.registerTool(
    'change_rrset_ttl',
    {
      title: 'Change RRSet TTL',
      description:
        "Change the Time To Live (TTL) of an RRSet. Pass null to fall back to the zone's default TTL.",
      inputSchema: z.object({
        zone,
        name: rrsetName,
        type: rrsetType,
        ttl: ttl
          .nullable()
          .describe(
            "Time To Live in seconds, or null to use the zone's default TTL"
          ),
      }),
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
        'Enable or disable the change protection of an RRSet. Enabling is immediate; DISABLING removes the last safeguard against delete_rrset and set_records and therefore needs a confirm_token.',
      inputSchema: z.object({
        zone,
        name: rrsetName,
        type: rrsetType,
        change: z
          .boolean()
          .describe(
            'true to protect the RRSet from changes and deletion, false to unprotect'
          ),
        confirm_token: confirmTokenParam,
      }),
      annotations: { idempotentHint: true },
    },
    ({ zone, name, type, change, confirm_token }, mcp) =>
      run(async () => {
        if (!change) {
          const resource = `change_rrset_protection:${zone}${rrsetPath(name, type)}`;
          const outcome = await approval.requestApproval(
            server,
            mcp,
            confirmations,
            {
              what: `remove the change protection of RRSet "${name}/${type}" of zone "${zone}"`,
              consequence:
                'Doing so makes the RRSet editable and deletable again.',
              resourceKey: resource,
              token: confirm_token,
              toolName: 'change_rrset_protection',
              hint: 'Tick to go ahead, leave it to cancel.',
            }
          );
          // A mismatched token is refused with the reason rather than answered with
          // a fresh prompt; the sentence is the library's, so the fleet refuses alike.
          if (outcome.decision === 'rejected')
            return errorResult(outcome.reason);
          if (outcome.decision === 'declined') {
            return errorResult(
              `The user declined. change_rrset_protection did nothing.`
            );
          }
          if (outcome.decision === 'pending') return outcome.result;
        }
        return jsonResult(
          await api.post(
            `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/change_protection`,
            { change }
          )
        );
      })
  );
}
