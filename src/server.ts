import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { HetznerApi } from './api.js';
import type { Config } from './config.js';
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
  const api = new HetznerApi(config);

  const server = new McpServer({
    name: 'hetzner-dns-mcp',
    version: packageVersion(),
  });

  registerZoneTools(server, api);
  registerRrsetTools(server, api);
  registerActionTools(server, api);

  return server;
}
