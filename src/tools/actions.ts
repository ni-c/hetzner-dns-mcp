import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { jsonResult, run } from '../result.js';
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
      inputSchema: {
        zone: zone.optional(),
        status: z
          .array(z.enum(['running', 'success', 'error']))
          .optional()
          .describe('Filter actions by status'),
        page,
        per_page: perPage,
      },
      annotations: { readOnlyHint: true },
    },
    ({ zone, status, page, per_page }) =>
      run(async () => {
        const path = zone
          ? `/zones/${encodeURIComponent(zone)}/actions`
          : '/zones/actions';
        return jsonResult(await api.get(path, { status, page, per_page }));
      })
  );

  server.registerTool(
    'get_zone_action',
    {
      title: 'Get zone action',
      description:
        'Get a single zone action by ID to check its status and result.',
      inputSchema: {
        action_id: z.number().int().positive().describe('ID of the action'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ action_id }) =>
      run(async () => jsonResult(await api.get(`/zones/actions/${action_id}`)))
  );
}
