#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(`mcp-hetzner-dns: connected, targeting ${config.baseUrl}`);
}

main().catch((error: unknown) => {
  console.error('mcp-hetzner-dns: fatal error:', error);
  process.exit(1);
});
