import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  actionResult,
  document,
  listOf,
  objectOf,
  untrustedFields,
} from '../output-schema.js';
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
import { READ_ONLY } from './annotations.js';

import { fingerprint } from '../resource-key.js';
import { errorResult, jsonResult, run } from '../result.js';
import type { ToolContext } from './context.js';

/**
 * Record types that move authority rather than add an answer.
 *
 * The gate on this server was drawn around loss — "eight of the 22 tools can
 * take a name off the internet, and DNS has no undo". That is the right
 * question for a file and the wrong one for a zone. The dangerous act in DNS is
 * not withdrawing a claim, it is *making* one, and every case below leaves
 * every existing record exactly where it was:
 *
 * - an MX at preference 0 next to the real one wins all mail, because senders
 *   try ascending preference (RFC 5321 §5.1)
 * - an NS on a subname creates a zone cut, and the parent starts issuing
 *   referrals for everything beneath it
 * - a CAA changes which authority may issue certificates at all
 * - CNAME, DS, TLSA, SVCB, HTTPS and SRV each redirect or re-key a name
 *
 * `@` is here because the apex is where SPF, DMARC and the zone's own NS set
 * live, and `*` because a wildcard answers every name that does not exist yet.
 *
 * Deliberately **not** here: `_acme-challenge` TXT. Adding one is how DNS-01
 * renewal works, its whole purpose is to run unattended, and a dialog on every
 * certificate renewal is a cost with no matching benefit — the confirmation
 * cannot tell a real ACME client from a forged token, and both look identical.
 * What does defend that name is CAA (now gated) plus Certificate Transparency
 * monitoring, and SECURITY.md says so.
 */
const AUTHORITY_TYPES = new Set([
  'NS',
  'DS',
  'MX',
  'CNAME',
  'CAA',
  'TLSA',
  'SVCB',
  'HTTPS',
  'SRV',
]);

/** Whether adding this name/type decides who answers for something. */
export function shiftsAuthority(name: string, type: string): boolean {
  return AUTHORITY_TYPES.has(type) || name === '@' || name.includes('*');
}

/**
 * The values a call is about to write, for the confirmation dialog.
 *
 * These are the caller's own arguments, not anything read back from the API —
 * the distinction the rest of this file is careful about. Without them the
 * dialog is byte-identical whether the record points at the right address or
 * the attacker's, which makes the question unanswerable: "replace the records
 * of www/A" is true either way. `renderDetails` collapses whitespace and caps
 * each value, and prints them under "supplied by the caller, not by this
 * server".
 */
function recordDetails(
  values: readonly { value: string }[]
): { label: string; value: string }[] {
  const shown = values.slice(0, 5);
  const details = shown.map((record, index) => ({
    label: `record ${index + 1}`,
    value: record.value,
  }));
  if (values.length > shown.length) {
    details.push({
      label: 'and',
      value: `${values.length - shown.length} more not shown`,
    });
  }
  return details;
}

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
      annotations: READ_ONLY,
      outputSchema: listOf('rrsets'),
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
      annotations: READ_ONLY,
      outputSchema: objectOf('rrset'),
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
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Additive in storage: Hetzner refuses a name that already exists, so
        // this cannot overwrite what set_records guards. Not additive in
        // effect — see shiftsAuthority — which is why the types that decide
        // who answers for a name are confirmed.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: objectOf('rrset'),
    },
    ({ zone, name, type, records, ttl, labels, confirm_token }, mcp) =>
      run(async () => {
        const write = async (): Promise<ReturnType<typeof jsonResult>> =>
          jsonResult(
            await api.post(`/zones/${encodeURIComponent(zone)}/rrsets`, {
              name,
              type,
              records,
              ...(ttl !== undefined && { ttl }),
              ...(labels !== undefined && { labels }),
            })
          );
        if (!shiftsAuthority(name, type)) return write();

        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `create the RRSet "${name}/${type}" in zone "${zone}"`,
            consequence:
              `A ${type} record decides who answers for a name rather than ` +
              'adding an answer to it, and nothing existing has to be removed ' +
              'for it to take effect. Check the values below against what you ' +
              'meant.',
            details: recordDetails(records),
            resourceKey: `create_rrset:${zone}${rrsetPath(name, type)}:${fingerprint(records)}`,
            token: confirm_token,
            toolName: 'create_rrset',
            hint: 'Tick to go ahead, leave it to cancel.',
            fallbackNote: 'The token only works for exactly this record list.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult('The user declined. create_rrset did nothing.');
        }
        if (outcome.decision === 'pending') return outcome.result;
        return write();
      })
  );

  server.registerTool(
    'update_rrset',
    {
      title: 'Update RRSet labels',
      description:
        'Update the labels of an RRSet. The given set replaces all existing labels. (Records and TTL are changed via set_records/add_records/remove_records and change_rrset_ttl.)',
      inputSchema: z.object({ zone, name: rrsetName, type: rrsetType, labels }),
      annotations: {
        // Replaces the labels of an RRSet — not its records. The comment here
        // used to say "exactly like set_records", which is what put this tool
        // on a list of things that ought to be guarded: it is not, because no
        // name goes off the internet. Labels are metadata somebody set, they
        // are replaced wholesale and Hetzner keeps no history of them, so the
        // annotation stays destructive; the dialog does not follow, because
        // the dialog is for what cannot be shrugged off.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: actionResult,
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
      annotations: {
        // Idempotent by the specification's wording — the second call fails,
        // but the world is the same either way.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z
        .object({ ...untrustedFields, action: document.optional() })
        .catchall(z.unknown()),
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
      annotations: {
        // Replaces every record of the RRSet with the ones given.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: actionResult,
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
            details: recordDetails(records),
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
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Additive, and an RRSet is a set — adding a record it already holds
        // changes nothing. That says nothing about the effect: an MX at
        // preference 0 added beside the real one wins all mail without
        // touching it. See shiftsAuthority.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: actionResult,
    },
    ({ zone, name, type, records, ttl, confirm_token }, mcp) =>
      run(async () => {
        const write = async (): Promise<ReturnType<typeof jsonResult>> =>
          jsonResult(
            await api.post(
              `/zones/${encodeURIComponent(zone)}/rrsets${rrsetPath(name, type)}/actions/add_records`,
              { records, ...(ttl !== undefined && { ttl }) }
            )
          );
        if (!shiftsAuthority(name, type)) return write();

        const summary = await rrsetSummary(api, zone, name, type);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `add ${records.length} record(s) to "${name}/${type}" of zone "${zone}"`,
            consequence:
              `It ${summary}, and those stay. A ${type} record decides who ` +
              'answers for a name, so an added one can take effect without ' +
              'anything being removed — at preference or priority order, the ' +
              'new value can simply win. Check the values below.',
            details: recordDetails(records),
            resourceKey: `add_records:${zone}${rrsetPath(name, type)}:${fingerprint(records)}`,
            token: confirm_token,
            toolName: 'add_records',
            hint: 'Tick to go ahead, leave it to cancel.',
            fallbackNote: 'The token only works for exactly this record list.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult('The user declined. add_records did nothing.');
        }
        if (outcome.decision === 'pending') return outcome.result;
        return write();
      })
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
      annotations: {
        // Idempotent: removing a record that is already gone leaves the same
        // RRSet. Removing the last one deletes the RRSet.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: actionResult,
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
            details: recordDetails(records),
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
      annotations: {
        // A setting, not content. The records keep serving.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: actionResult,
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
      annotations: {
        // A state. Removing it is guarded — it is the rail in front of
        // delete_rrset and set_records — but it destroys nothing itself.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: z
        .object({ ...untrustedFields, action: document.optional() })
        .catchall(z.unknown()),
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
