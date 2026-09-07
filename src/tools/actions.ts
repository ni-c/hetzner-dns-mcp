import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { listOf, objectOf } from '../output-schema.js';

import { listEnvelope, objectEnvelope } from '../boundary.js';
import { jsonResult, run } from '../result.js';
import { READ_ONLY } from './annotations.js';
import { page, perPage, zone } from '../schema.js';
import type { ToolContext } from './context.js';

/** Both action tools are read-only, so this module ignores `readOnly`. */
export function registerActionTools(
  server: McpServer,
  { api }: ToolContext
): void {
  server.registerTool(
    'list_zone_actions',
    {
      title: 'List zone actions',
      description:
        'List actions (asynchronous operations like zone file imports) of all zones, or of a single zone if one is given.',
      inputSchema: z.object({
        zone: zone.optional(),
        status: z
          .array(z.enum(['running', 'success', 'error']))
          .max(3)
          .optional()
          .describe('Filter actions by status'),
        page,
        per_page: perPage,
      }),
      annotations: READ_ONLY,
      outputSchema: listOf('actions'),
    },
    ({ zone: zoneRef, status, page: pageNumber, per_page }) =>
      run(async () => {
        const path = zoneRef
          ? `/zones/${encodeURIComponent(zoneRef)}/actions`
          : '/zones/actions';
        return jsonResult(
          listEnvelope(
            await api.get(path, { status, page: pageNumber, per_page }),
            'actions'
          )
        );
      })
  );

  server.registerTool(
    'get_zone_action',
    {
      title: 'Get zone action',
      description:
        'Get a single zone action by ID to check its status and result.',
      inputSchema: z.object({
        // `.int()` in zod 4 already refuses anything past 2^53, so this is
        // bounded to sixteen decimal digits before it reaches the path — which
        // is what the spec says an id is (`maximum: 9007199254740991`).
        action_id: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .describe('ID of the action'),
      }),
      annotations: READ_ONLY,
      outputSchema: objectOf('action'),
    },
    ({ action_id }) =>
      run(async () =>
        jsonResult(
          objectEnvelope(await api.get(`/zones/actions/${action_id}`), 'action')
        )
      )
  );
}
