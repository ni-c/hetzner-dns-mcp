import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { HetznerApiError } from './api.js';

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Runs a tool handler and converts thrown errors into MCP error results
 * instead of protocol-level failures.
 */
export async function run(
  fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HetznerApiError) {
      let hint = '';
      if (error.status === 401) {
        hint =
          '\nHint: check HETZNER_API_TOKEN. The token must be a Hetzner Cloud API token of the project that holds the DNS zones (Cloud Console > Security > API tokens). Tokens from the old DNS Console (dns.hetzner.com) do not work — that API was shut down in May 2026.';
      } else if (error.status === 403) {
        hint =
          '\nHint: the token may be read-only. Write operations require a token with write permission.';
      } else if (error.status === 423) {
        hint =
          '\nHint: the resource is protected. Remove the protection first (change_zone_protection / change_rrset_protection).';
      }
      return errorResult(`${error.message}\n${error.body}${hint}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`hetzner-dns-mcp: ${message}`);
  }
}
