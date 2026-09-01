import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { buildToolFilter, installToolFilter } from 'mcp-tool-allowlist';

import { ALL_TOOLS, ESSENTIAL_TOOLS, READ_TOOLS } from './tools/catalogue.js';

import { HetznerApi } from './api.js';
import type { Config } from './config.js';
import { ConfirmationStore, createApproval } from 'mcp-approval';
import type { ToolContext } from './tools/context.js';
import { registerActionTools } from './tools/actions.js';
import { registerRrsetTools } from './tools/rrsets.js';
import { registerZoneTools } from './tools/zones.js';

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(config: Config): McpServer {
  // Before anything is built: an unusable tool list should fail on the way in,
  // not leave a server running with tools quietly missing.
  const filter = buildToolFilter({
    allowTools: config.allowTools,
    denyTools: config.denyTools,
    catalogue: {
      all: ALL_TOOLS,
      essential: ESSENTIAL_TOOLS,
      ungated: READ_TOOLS,
    },
    names: {
      allow: 'HETZNER_ALLOW_TOOLS',
      deny: 'HETZNER_DENY_TOOLS',
      server: 'hetzner-dns-mcp',
    },
    gate: {
      closed: config.readOnly,
      variable: 'HETZNER_READ_ONLY',
      noun: 'read-only mode',
    },
  });

  const ctx: ToolContext = {
    api: new HetznerApi(config),
    // One store per server: the tokens it hands out are only ever valid for
    // this process, so a restart invalidates every pending confirmation.
    confirmations: new ConfirmationStore(),
    // One approver per server: it holds the key that seals the request state
    // carried out through the client and back.
    approval: createApproval({ server: 'hetzner-dns-mcp' }),
    readOnly: config.readOnly,
  };

  const server = new McpServer({
    name: 'hetzner-dns-mcp',
    version: packageVersion(),
  });

  installToolFilter(server, filter);

  registerZoneTools(server, ctx);
  registerRrsetTools(server, ctx);
  registerActionTools(server, ctx);

  return server;
}
