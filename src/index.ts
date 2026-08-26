#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { ToolFilterError } from './tool-filter.js';

async function main(): Promise<void> {
  const config = loadConfig();
  let server;
  try {
    server = createServer(config);
  } catch (error) {
    // A bad tool list is operator feedback, not a crash: print the sentence on
    // its own rather than behind "fatal error:".
    if (error instanceof ToolFilterError) {
      console.error(`hetzner-dns-mcp: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  await server.connect(new StdioServerTransport());
  console.error(`hetzner-dns-mcp: connected, targeting ${config.baseUrl}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`hetzner-dns-mcp: fatal error: ${message}`);
  process.exit(1);
});
