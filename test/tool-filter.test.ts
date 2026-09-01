import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_TOOLS,
  ESSENTIAL_TOOLS,
  READ_TOOLS,
  WRITE_TOOLS,
} from '../src/tools/catalogue.js';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';
import { ToolFilterError } from 'mcp-tool-allowlist';

const base: Config = {
  token: 'test-token',
  baseUrl: 'https://api.hetzner.test/v1',
  readOnly: false,
  allowTools: undefined,
  denyTools: undefined,
};

function config(overrides: Partial<Config> = {}): Config {
  return { ...base, ...overrides };
}

/** The tools a server built with this configuration actually offers. */
async function toolNames(overrides: Partial<Config> = {}): Promise<string[]> {
  vi.stubGlobal('fetch', vi.fn());
  const server = createServer(config(overrides));
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const { tools } = await client.listTools();
  return tools.map((t) => t.name).sort();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the catalogue', () => {
  // These are what let the filter validate a name before anything is
  // registered. If they drift from the code, every error message drifts too.
  it('is exactly the set of tools the server registers', async () => {
    expect(await toolNames()).toEqual([...ALL_TOOLS].sort());
  });

  it('splits into read and write with nothing left over', async () => {
    expect([...READ_TOOLS, ...WRITE_TOOLS].sort()).toEqual(
      [...ALL_TOOLS].sort()
    );
    expect(
      READ_TOOLS.filter((t) => (WRITE_TOOLS as readonly string[]).includes(t))
    ).toEqual([]);
    expect(await toolNames({ readOnly: true })).toEqual([...READ_TOOLS].sort());
  });

  it('holds names the env-var syntax cannot misread', () => {
    // A comma or an asterisk in a name would break the separator or the
    // pattern; a tool called "essential" would be unreachable behind the preset.
    for (const tool of ALL_TOOLS) {
      expect(tool).toMatch(/^[a-z0-9_]+$/);
    }
    expect(ALL_TOOLS).not.toContain('essential');
  });

  it('has an essential preset that is a real, sensibly sized subset', () => {
    expect(new Set(ESSENTIAL_TOOLS).size).toBe(ESSENTIAL_TOOLS.length);
    expect(ESSENTIAL_TOOLS.length).toBeGreaterThanOrEqual(5);
    expect(ESSENTIAL_TOOLS.length).toBeLessThanOrEqual(8);
    for (const tool of ESSENTIAL_TOOLS) expect(ALL_TOOLS).toContain(tool);
  });
});

describe('selecting tools', () => {
  it('narrows tools/list to an allow list', async () => {
    expect(await toolNames({ allowTools: 'list_zones,get_zone' })).toEqual([
      'get_zone',
      'list_zones',
    ]);
  });

  it('removes a whole family with a prefix pattern', async () => {
    const names = await toolNames({ denyTools: 'change_*' });
    expect(names.some((n) => n.startsWith('change_'))).toBe(false);
    expect(names).toHaveLength(
      ALL_TOOLS.length - ALL_TOOLS.filter((t) => t.startsWith('change_')).length
    );
  });

  it('subtracts the deny list from the allow list', async () => {
    expect(
      await toolNames({ allowTools: 'list_*', denyTools: 'list_zone_actions' })
    ).toEqual(['list_rrsets', 'list_zones']);
  });

  it('selects the curated set for "essential"', async () => {
    expect(await toolNames({ allowTools: 'essential' })).toEqual(
      [...ESSENTIAL_TOOLS].sort()
    );
  });

  it('lets the preset compose with extra names', async () => {
    expect(await toolNames({ allowTools: 'essential,update_zone' })).toEqual(
      [...ESSENTIAL_TOOLS, 'update_zone'].sort()
    );
  });

  it('leaves an unconfigured server untouched', async () => {
    expect(await toolNames()).toEqual([...ALL_TOOLS].sort());
  });
});

describe('a filtered-out tool', () => {
  it('cannot be called either, not merely hidden', async () => {
    // This is the difference between removing the tool and disabling it: a
    // disabled tool still answers a call, which advertises a refusal.
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return new Response('{}', {
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    const server = createServer(config({ allowTools: 'list_zones' }));
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // SDK v2 reports an unknown tool as a JSON-RPC error rather than as a
    // result carrying isError. Either way the call fails and nothing reaches
    // the API, which is what this test is about.
    await expect(
      client.callTool({
        name: 'delete_zone',
        arguments: { zone: 'example.com' },
      })
    ).rejects.toThrow('Tool delete_zone not found');
    expect(calls).toHaveLength(0);
  });
});

describe('refusing an unusable list', () => {
  it('rejects a name no tool has, and says which names exist', () => {
    // A typo that was merely ignored would leave a tool missing with no trace
    // of why — nobody looks for the cause of an absence in an env var.
    expect(() => createServer(config({ allowTools: 'list_zonez' }))).toThrow(
      ToolFilterError
    );
    expect(() => createServer(config({ allowTools: 'list_zonez' }))).toThrow(
      /no tool matches "list_zonez".*list_zones/s
    );
  });

  it('applies the same rule to the deny list', () => {
    expect(() => createServer(config({ denyTools: 'delet_zone' }))).toThrow(
      /HETZNER_DENY_TOOLS: no tool matches "delet_zone"/
    );
  });

  it('rejects a list that would leave no tools at all', () => {
    expect(() => createServer(config({ denyTools: '*' }))).toThrow(
      /empty tool list/
    );
  });
});

describe('together with read-only mode', () => {
  const readOnly = { readOnly: true } as const;

  it('names read-only as the reason, rather than calling the tool unknown', () => {
    // The tool exists; it is suppressed. Reporting "unknown tool" would send
    // the reader looking for a typo that is not there.
    let thrown: unknown;
    try {
      createServer(config({ ...readOnly, allowTools: 'delete_zone' }));
    } catch (error) {
      thrown = error;
    }
    const message = (thrown as Error).message;
    expect(message).toContain('HETZNER_READ_ONLY');
    expect(message).not.toContain('no tool matches');
  });

  it('lets a pattern cover write tools without failing', async () => {
    // `get_*,create_*` is a legitimate template to hand to both kinds of
    // deployment; under read-only the write half simply contributes nothing.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      await toolNames({ ...readOnly, allowTools: 'get_*,create_*' })
    ).toEqual(['get_rrset', 'get_zone', 'get_zone_action']);
    expect(warn.mock.calls.flat().join(' ')).toContain('contributes nothing');
  });

  it('keeps the essential preset usable, narrowed to its read half', async () => {
    expect(await toolNames({ ...readOnly, allowTools: 'essential' })).toEqual(
      ESSENTIAL_TOOLS.filter((t) =>
        (READ_TOOLS as readonly string[]).includes(t)
      ).sort()
    );
  });

  it('says read-only is the reason when a pattern leaves nothing at all', async () => {
    // `create_*` is legal and merely contributes nothing — but if it was the
    // whole allow list, the resulting empty server needs the real explanation,
    // not "your lists leave no tools".
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      createServer(config({ ...readOnly, allowTools: 'create_*' }))
    ).toThrow(/read-only mode suppresses.*HETZNER_READ_ONLY is set/s);
  });

  it('does not apply the write-tool rule to the deny list', async () => {
    // Denying something already suppressed is how a defensive list is written.
    expect(await toolNames({ ...readOnly, denyTools: 'delete_zone' })).toEqual(
      [...READ_TOOLS].sort()
    );
  });
});
