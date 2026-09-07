import type { CallToolResult } from '@modelcontextprotocol/client';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectClient, resultText, stubFetch } from './harness.js';

/**
 * What the API actually sends, against what the output schemas promise.
 *
 * Every tool here passes a Hetzner Cloud API document through, and until
 * `src/boundary.ts` existed every one of them did it with a TypeScript cast.
 * The output schemas made that cast load-bearing: `listOf('zones')` requires a
 * `zones` array, `objectOf('zone')` required a `zone` object, and on SDK 2.0 a
 * result that breaks its own output schema comes back as `isError: true` with
 * the text `Output validation error for tool …` — no cause, no partial answer,
 * the whole call.
 *
 * The spec does promise those keys. Everything between the spec and this
 * process does not: a reverse proxy or WAF in front of the API, a 204 with an
 * empty body, a base URL one character off, a body that is not JSON at all.
 *
 * Three sentences must never appear in a tool result, whatever arrives:
 *
 * - `Output validation error` — the schema refused this server's own answer
 * - `Cannot read properties` — a field was read off `null` or `undefined`
 * - `is not a function` — a value was used as the type it was cast to
 *
 * The example cases below are the shapes that were found by hand. The property
 * test after them is the one that keeps finding: it feeds `fc.jsonValue()` and
 * shaped envelopes with random leaves to every read tool through a *connected*
 * client, which is what runs the client-side schema check as well.
 */

/** Overridable so one deep local pass is possible without slowing CI. */
const RUNS = Number(process.env.SHAPE_RUNS ?? '') || 60;

const FORBIDDEN = [
  'Output validation error',
  'Cannot read properties',
  'is not a function',
];

/** Every tool that reads, with arguments that reach the API. */
const READ_CALLS: { name: string; arguments: Record<string, unknown> }[] = [
  { name: 'list_zones', arguments: {} },
  { name: 'get_zone', arguments: { zone: 'example.com' } },
  { name: 'export_zonefile', arguments: { zone: 'example.com' } },
  {
    name: 'list_rrsets',
    arguments: { zone: 'example.com' },
  },
  {
    name: 'get_rrset',
    arguments: { zone: 'example.com', name: 'www', type: 'A' },
  },
  { name: 'list_zone_actions', arguments: {} },
  { name: 'get_zone_action', arguments: { action_id: 42 } },
];

function stubBody(body: string, status = 200): void {
  stubFetch(
    () =>
      new Response(body, {
        status,
        headers: { 'content-type': 'application/json' },
      })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The shapes found by reading, each of which used to take a whole call down.
 *
 * `1e999` is spliced into the serialised text rather than written as a value:
 * `JSON.parse` turns it into `Infinity`, which is `typeof "number"` and which
 * zod refuses even for a plain `z.number()`.
 */
const HAND_WRITTEN: [string, string][] = [
  ['an empty body', ''],
  ['null', 'null'],
  ['a bare number', '42'],
  ['a bare string', '"a proxy said something"'],
  ['an array', '[1, 2, 3]'],
  ['an empty object', '{}'],
  [
    'the key set to null',
    '{"zones": null, "zone": null, "rrsets": null, "rrset": null, "actions": null, "action": null, "zonefile": null}',
  ],
  [
    'the key set to a number',
    '{"zones": 5, "zone": 5, "rrsets": 5, "rrset": 5, "actions": 5, "action": 5, "zonefile": 5}',
  ],
  [
    'the list holding a null',
    '{"zones": [null], "rrsets": [null], "actions": [null]}',
  ],
  [
    'the list holding a number',
    '{"zones": [7], "rrsets": [7], "actions": [7]}',
  ],
  [
    'meta as a string',
    '{"zones": [], "rrsets": [], "actions": [], "meta": "soon"}',
  ],
  [
    'an infinity in a count',
    '{"zone": {"record_count": 1e999}, "zones": [{"record_count": 1e999}]}',
  ],
  [
    'a prototype key',
    '{"zone": {"__proto__": {"polluted": true}}, "zones": [{"__proto__": {"polluted": true}}]}',
  ],
  // Not JSON at all: `HetznerApi.request` falls back to returning the raw text,
  // and every tool then read that string as though it were the document.
  ['a plain-text body', 'Service Unavailable, but with a 200'],
  [
    'an action envelope of the wrong kind',
    '{"action": 7, "rrset": "x", "zone": []}',
  ],
];

describe('a read tool answers whatever the API sends', () => {
  for (const [label, body] of HAND_WRITTEN) {
    it(`survives ${label}`, async () => {
      stubBody(body);
      const client = await connectClient();
      for (const call of READ_CALLS) {
        const result = (await client.callTool(call)) as CallToolResult;
        const text = resultText(result);
        for (const sentence of FORBIDDEN) {
          expect(
            text,
            `${call.name} with ${label}: ${text.slice(0, 300)}`
          ).not.toContain(sentence);
        }
      }
    });
  }

  /**
   * The rule that holds the two channels together, over the whole catalogue.
   *
   * Nothing had ever compared them. They are built from one value here, which
   * is exactly the kind of thing that stays true until somebody adds a second
   * builder — so it is asserted rather than assumed.
   */
  it('answers the same value in both channels', async () => {
    stubBody(
      '{"zones": [{"id": 1, "name": "example.com"}], "zone": {"id": 1}, "rrsets": [{"name": "www"}], "rrset": {"name": "www"}, "actions": [{"id": 3}], "action": {"id": 3}, "zonefile": "$ORIGIN example.com.\\n", "meta": {"pagination": {"page": 1}}}'
    );
    const client = await connectClient();
    for (const call of READ_CALLS) {
      const result = (await client.callTool(call)) as CallToolResult;
      const text = resultText(result);
      const fenced =
        /<untrusted-data[^>]*>\n([\s\S]*)\n<\/untrusted-data>/.exec(text);
      expect(fenced, `${call.name} has no fence`).not.toBeNull();
      expect(JSON.parse(fenced?.[1] ?? 'null')).toEqual(
        result.structuredContent
      );
    }
  });
});

describe('a body-less response', () => {
  /**
   * A 200 with no body at all — which the reader sees as a null stream, and
   * `request` maps to `null`. It is what a proxy answers for a HEAD it decided
   * to satisfy itself, and what a 204 looks like once the status has been
   * checked.
   */
  it('is an answer, not a crash', async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const client = await connectClient();

    for (const call of READ_CALLS) {
      const result = (await client.callTool(call)) as CallToolResult;
      const text = resultText(result);
      for (const sentence of FORBIDDEN) {
        expect(text, `${call.name}: ${text.slice(0, 200)}`).not.toContain(
          sentence
        );
      }
    }
  });
});

describe('the boundary holds over generated bodies', () => {
  /** Leaves that have each cost a server in this family a whole answer. */
  const leaf = fc.oneof(
    fc.constant(null),
    fc.constant(true),
    fc.integer(),
    fc.double(),
    fc.constant(-9007199254740992),
    fc.constant(1e300),
    fc.string(),
    fc.string({ minLength: 300, maxLength: 400 }),
    fc.array(fc.string(), { maxLength: 3 }),
    fc.dictionary(fc.string(), fc.string(), { maxKeys: 3 })
  );

  /** An envelope with the right key set and the wrong values under it. */
  const envelope = fc.record({
    zones: leaf,
    zone: leaf,
    rrsets: leaf,
    rrset: leaf,
    actions: leaf,
    action: leaf,
    zonefile: leaf,
    meta: leaf,
  });

  it('never answers with a schema violation or a type error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(envelope, fc.jsonValue()),
        fc.boolean(),
        async (body, spliceInfinity) => {
          let serialised = JSON.stringify(body) ?? 'null';
          if (spliceInfinity) {
            serialised = serialised.replace(/:(\s*)0([,}])/, ':$11e999$2');
          }
          stubBody(serialised);
          const client = await connectClient();
          for (const call of READ_CALLS) {
            const result = (await client.callTool(call)) as CallToolResult;
            const text = resultText(result);
            for (const sentence of FORBIDDEN) {
              if (text.includes(sentence)) {
                throw new Error(
                  `${call.name} answered "${sentence}" for ${serialised.slice(0, 200)}`
                );
              }
            }
          }
          vi.unstubAllGlobals();
        }
      ),
      { numRuns: RUNS }
    );
  });
});
