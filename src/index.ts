#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { ToolFilterError } from 'mcp-tool-allowlist';

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

// In a container node runs as PID 1 with no default signal disposition, so
// without this handler `docker stop` waits out the grace period and SIGKILLs.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`hetzner-dns-mcp: fatal error: ${message}`);
  process.exit(1);
});
