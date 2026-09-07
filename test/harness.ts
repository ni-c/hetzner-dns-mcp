import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { vi } from 'vitest';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

/**
 * One connected client, for every suite that needs one.
 *
 * This file exists because its absence was a documented gap: the tool
 * reference's confirmation markers could not be checked against the code,
 * because the only `connect` in the repository lived inside a test file and
 * importing it would have re-registered that file's suites. `test/docs.test.ts`
 * said so in a comment for two releases.
 */

export const baseConfig: Config = {
  token: 'test-token-for-the-shared-harness',
  baseUrl: 'https://api.hetzner.test/v1',
  readOnly: false,
  elicitation: true,
  allowTools: undefined,
  denyTools: undefined,
};

export type FetchCall = { url: string; init: RequestInit | undefined };

/** Stubs global fetch and records every call. */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    })
  );
  return calls;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A client with no elicitation capability, which is what the two-call token
 * exists for — and what lets a test read a confirmation out of a tool result.
 *
 * `listTools()` runs once per connection on purpose. A client validates
 * `structuredContent` against a tool's output schema only if it has *loaded*
 * that schema, so without this call no success path in any suite ever runs the
 * client-side check, and the server ends up validating its own answers against
 * a schema it also wrote.
 */
export async function connectClient(
  config: Config = baseConfig
): Promise<Client> {
  const server = createServer(config);
  const client = new Client({ name: 'harness', version: '0.0.0' }, {});
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  await client.listTools();
  return client;
}

export function resultText(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

/** The confirmation token out of a first call's refusal. */
export function tokenFrom(result: CallToolResult): string {
  const match = /confirm_token="([0-9a-f]{32})"/.exec(resultText(result));
  if (match?.[1] === undefined) {
    throw new Error(`no token in: ${resultText(result).slice(0, 200)}`);
  }
  return match[1];
}

/** Whether a tool result is the server asking rather than the server acting. */
export function asksAPerson(result: CallToolResult): boolean {
  return resultText(result).includes('confirm_token=');
}
