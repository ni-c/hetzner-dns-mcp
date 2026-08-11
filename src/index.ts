#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(`hetzner-dns-mcp: connected, targeting ${config.baseUrl}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`hetzner-dns-mcp: fatal error: ${message}`);
  process.exit(1);
});
