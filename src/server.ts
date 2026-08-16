import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { HetznerApi } from './api.js';
import type { Config } from './config.js';
import { ConfirmationStore } from './confirm.js';
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
  const ctx: ToolContext = {
    api: new HetznerApi(config),
    // One store per server: the tokens it hands out are only ever valid for
    // this process, so a restart invalidates every pending confirmation.
    confirmations: new ConfirmationStore(),
    readOnly: config.readOnly,
  };

  const server = new McpServer({
    name: 'hetzner-dns-mcp',
    version: packageVersion(),
  });

  registerZoneTools(server, ctx);
  registerRrsetTools(server, ctx);
  registerActionTools(server, ctx);

  return server;
}
