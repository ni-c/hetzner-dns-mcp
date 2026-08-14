import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

const config: Config = {
  token: 'test-token',
  baseUrl: 'https://api.hetzner.test/v1',
};

type FetchCall = { url: string; init: RequestInit | undefined };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stubs global fetch and records all calls. */
function stubFetch(
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

async function connectClient(serverConfig: Config = config): Promise<Client> {
  const server = createServer(serverConfig);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function resultText(result: CallToolResult): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tool registration', () => {
  it('exposes all expected tools', async () => {
    stubFetch(() => jsonResponse({}));
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_records',
      'change_primary_nameservers',
      'change_rrset_protection',
      'change_rrset_ttl',
      'change_zone_protection',
      'change_zone_ttl',
      'create_rrset',
      'create_zone',
      'delete_rrset',
      'delete_zone',
      'export_zonefile',
      'get_rrset',
      'get_zone',
      'get_zone_action',
      'import_zonefile',
      'list_rrsets',
      'list_zone_actions',
      'list_zones',
      'remove_records',
      'set_records',
      'update_rrset',
      'update_zone',
    ]);
  });

  it('marks destructive and read-only tools accordingly', async () => {
    stubFetch(() => jsonResponse({}));
    const client = await connectClient();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('delete_zone')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('delete_rrset')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('import_zonefile')?.annotations?.destructiveHint).toBe(
      true
    );
    expect(byName.get('set_records')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('remove_records')?.annotations?.destructiveHint).toBe(
      true
    );
    expect(
      byName.get('change_primary_nameservers')?.annotations?.destructiveHint
    ).toBe(true);
    expect(byName.get('list_zones')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('export_zonefile')?.annotations?.readOnlyHint).toBe(true);
  });
});

describe('without a token', () => {
  const anonymous: Config = { token: undefined, baseUrl: config.baseUrl };

  it('still completes the handshake and lists all tools', async () => {
    // This is the path registries and inspectors take: no credentials.
    const client = await connectClient(anonymous);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(22);
  });

  it('fails the call itself with the setup instructions', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const client = await connectClient(anonymous);

    const result = (await client.callTool({
      name: 'list_zones',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('HETZNER_API_TOKEN');
    expect(calls).toHaveLength(0);
  });
});

describe('list_zones', () => {
  it('sends the Bearer token and returns the zone list', async () => {
    const zones = { zones: [{ id: 1, name: 'example.com' }], meta: {} };
    const calls = stubFetch(() => jsonResponse(zones));
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'list_zones',
      arguments: {},
    })) as CallToolResult;

    expect(calls[0]?.url).toBe('https://api.hetzner.test/v1/zones');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(resultText(result))).toEqual(zones);
  });

  it('passes filters and pagination as query parameters', async () => {
    const calls = stubFetch(() => jsonResponse({ zones: [], meta: {} }));
    const client = await connectClient();

    await client.callTool({
      name: 'list_zones',
      arguments: { name: 'example.com', mode: 'primary', page: 2 },
    });

    expect(calls[0]?.url).toBe(
      'https://api.hetzner.test/v1/zones?name=example.com&mode=primary&page=2'
    );
  });
});

describe('list_rrsets', () => {
  it('appends repeated type filters', async () => {
    const calls = stubFetch(() => jsonResponse({ rrsets: [], meta: {} }));
    const client = await connectClient();

    await client.callTool({
      name: 'list_rrsets',
      arguments: { zone: 'example.com', type: ['A', 'AAAA'] },
    });

    expect(calls[0]?.url).toBe(
      'https://api.hetzner.test/v1/zones/example.com/rrsets?type=A&type=AAAA'
    );
  });
});

describe('create_rrset', () => {
  it('sends name, type and records, omitting undefined fields', async () => {
    const calls = stubFetch(() => jsonResponse({ rrset: {}, action: {} }, 201));
    const client = await connectClient();

    await client.callTool({
      name: 'create_rrset',
      arguments: {
        zone: 'example.com',
        name: 'www',
        type: 'A',
        records: [{ value: '198.51.100.1' }],
      },
    });

    expect(calls[0]?.url).toBe(
      'https://api.hetzner.test/v1/zones/example.com/rrsets'
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: 'www',
      type: 'A',
      records: [{ value: '198.51.100.1' }],
    });
  });
});

describe('set_records', () => {
  it('posts to the set_records action and URL-encodes the RRSet name', async () => {
    const calls = stubFetch(() => jsonResponse({ action: {} }, 201));
    const client = await connectClient();

    await client.callTool({
      name: 'set_records',
      arguments: {
        zone: 'example.com',
        name: '@',
        type: 'TXT',
        records: [{ value: '"v=spf1 -all"' }],
        confirm: true,
      },
    });

    expect(calls[0]?.url).toBe(
      'https://api.hetzner.test/v1/zones/example.com/rrsets/%40/TXT/actions/set_records'
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      records: [{ value: '"v=spf1 -all"' }],
    });
  });

  it('refuses without confirm and reports the current contents', async () => {
    const rrset = {
      rrset: { name: 'www', type: 'A', records: [{ value: '198.51.100.1' }] },
    };
    const calls = stubFetch(() => jsonResponse(rrset));
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'set_records',
      arguments: {
        zone: 'example.com',
        name: 'www',
        type: 'A',
        records: [{ value: '198.51.100.2' }],
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('198.51.100.1');
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });
});

describe('remove_records', () => {
  it('refuses without confirm and reports the current contents', async () => {
    const rrset = {
      rrset: { name: 'www', type: 'A', records: [{ value: '198.51.100.1' }] },
    };
    const calls = stubFetch(() => jsonResponse(rrset));
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'remove_records',
      arguments: {
        zone: 'example.com',
        name: 'www',
        type: 'A',
        records: [{ value: '198.51.100.1' }],
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('198.51.100.1');
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('removes with confirm=true', async () => {
    const calls = stubFetch(() => jsonResponse({ action: {} }, 201));
    const client = await connectClient();

    await client.callTool({
      name: 'remove_records',
      arguments: {
        zone: 'example.com',
        name: 'www',
        type: 'A',
        records: [{ value: '198.51.100.1' }],
        confirm: true,
      },
    });

    expect(calls[0]?.url).toBe(
      'https://api.hetzner.test/v1/zones/example.com/rrsets/www/A/actions/remove_records'
    );
  });
});

describe('change_primary_nameservers', () => {
  it('refuses without confirm and reports the current primaries', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        zone: {
          id: 1,
          name: 'example.com',
          primary_nameservers: [{ address: '198.51.100.53', port: 53 }],
        },
      })
    );
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'change_primary_nameservers',
      arguments: {
        zone: 'example.com',
        primary_nameservers: [{ address: '198.51.100.54' }],
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('198.51.100.53:53');
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('changes with confirm=true', async () => {
    const calls = stubFetch(() => jsonResponse({ action: {} }, 201));
    const client = await connectClient();

    await client.callTool({
      name: 'change_primary_nameservers',
      arguments: {
        zone: 'example.com',
        primary_nameservers: [{ address: '198.51.100.54' }],
        confirm: true,
      },
    });

    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe(
      'https://api.hetzner.test/v1/zones/example.com/actions/change_primary_nameservers'
    );
  });
});

describe('input validation', () => {
  it('rejects ".." as zone to prevent URL path traversal', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'get_zone',
      arguments: { zone: '..' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('rejects RRSet names with characters outside the safe set', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'get_rrset',
      arguments: { zone: 'example.com', name: 'www/../..', type: 'A' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('change_rrset_ttl', () => {
  it('accepts null to fall back to the zone default TTL', async () => {
    const calls = stubFetch(() => jsonResponse({ action: {} }, 201));
    const client = await connectClient();

    await client.callTool({
      name: 'change_rrset_ttl',
      arguments: { zone: 'example.com', name: 'www', type: 'A', ttl: null },
    });

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ ttl: null });
  });
});

describe('delete_zone', () => {
  it('refuses to delete without confirm=true', async () => {
    const calls = stubFetch(() =>
      jsonResponse({ zone: { id: 1, name: 'example.com' } })
    );
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'delete_zone',
      arguments: { zone: 'example.com' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('example.com');
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
  });

  it('deletes with confirm=true', async () => {
    const calls = stubFetch((url, init) =>
      init?.method === 'DELETE'
        ? jsonResponse({ action: { id: 7, status: 'running' } }, 201)
        : jsonResponse({ zone: { id: 1, name: 'example.com' } })
    );
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'delete_zone',
      arguments: { zone: 'example.com', confirm: true },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    const del = calls.find((c) => c.init?.method === 'DELETE');
    expect(del?.url).toBe('https://api.hetzner.test/v1/zones/example.com');
  });
});

describe('delete_rrset', () => {
  it('refuses without confirm and reports the current contents', async () => {
    const rrset = {
      rrset: { name: 'www', type: 'A', records: [{ value: '198.51.100.1' }] },
    };
    const calls = stubFetch(() => jsonResponse(rrset));
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'delete_rrset',
      arguments: { zone: 'example.com', name: 'www', type: 'A' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('198.51.100.1');
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
  });
});

describe('import_zonefile', () => {
  it('refuses without confirm=true', async () => {
    const calls = stubFetch(() =>
      jsonResponse({ zone: { id: 1, name: 'example.com' } })
    );
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'import_zonefile',
      arguments: { zone: 'example.com', zonefile: '@ IN A 198.51.100.1' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('imports with confirm=true', async () => {
    const calls = stubFetch((url, init) =>
      init?.method === 'POST'
        ? jsonResponse({ action: { id: 9, status: 'running' } }, 201)
        : jsonResponse({ zone: { id: 1, name: 'example.com' } })
    );
    const client = await connectClient();

    await client.callTool({
      name: 'import_zonefile',
      arguments: {
        zone: 'example.com',
        zonefile: '@ IN A 198.51.100.1',
        confirm: true,
      },
    });

    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe(
      'https://api.hetzner.test/v1/zones/example.com/actions/import_zonefile'
    );
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      zonefile: '@ IN A 198.51.100.1',
    });
  });
});

describe('actions', () => {
  it('lists actions of a single zone when one is given', async () => {
    const calls = stubFetch(() => jsonResponse({ actions: [], meta: {} }));
    const client = await connectClient();

    await client.callTool({
      name: 'list_zone_actions',
      arguments: { zone: 'example.com', status: ['running'] },
    });

    expect(calls[0]?.url).toBe(
      'https://api.hetzner.test/v1/zones/example.com/actions?status=running'
    );
  });

  it('fetches a single action by ID', async () => {
    const calls = stubFetch(() => jsonResponse({ action: { id: 42 } }));
    const client = await connectClient();

    await client.callTool({
      name: 'get_zone_action',
      arguments: { action_id: 42 },
    });

    expect(calls[0]?.url).toBe('https://api.hetzner.test/v1/zones/actions/42');
  });
});

describe('error handling', () => {
  it('returns an error result with a token hint on 401', async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401)
    );
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'list_zones',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('HTTP 401');
    expect(resultText(result)).toContain('HETZNER_API_TOKEN');
    expect(resultText(result)).toContain('dns.hetzner.com');
  });

  it('returns an error result with a protection hint on 423', async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: 'protected', message: 'zone is protected' } },
        423
      )
    );
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'delete_zone',
      arguments: { zone: 'example.com', confirm: true },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('protected');
    expect(resultText(result)).toContain('change_zone_protection');
  });

  it('passes the API error body through on 422', async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: 'invalid_input', message: 'ttl too small' } },
        422
      )
    );
    const client = await connectClient();

    const result = (await client.callTool({
      name: 'change_zone_ttl',
      arguments: { zone: 'example.com', ttl: 60 },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('ttl too small');
  });
});
