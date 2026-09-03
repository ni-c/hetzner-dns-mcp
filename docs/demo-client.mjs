/**
 * Drives one MCP session against the built server, for recording demo.gif.
 *
 * A single session is the point: confirmation tokens live in the server
 * process, so the two-step flow cannot be shown with a CLI that spawns a fresh
 * server per call. A real MCP client holds one connection, which is exactly
 * what this does.
 *
 *   node docs/demo-mock.mjs &     # fabricated API on http://localhost:8787/v1
 *   npm run build
 *   node docs/demo-client.mjs
 */
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client } from '@modelcontextprotocol/client';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function call(name, args) {
  console.log(
    `\n${CYAN}→ ${name}${RESET} ${DIM}${JSON.stringify(args)}${RESET}`
  );
}

/** Wraps only the lines that need it, so JSON keeps its indentation. */
function show(result, width = 104) {
  const text = result.content.map((c) => c.text).join('\n');
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= width) {
      console.log(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line !== '' && (line + ' ' + word).length > width) {
        console.log(line);
        line = '';
      }
      line += (line === '' ? '' : ' ') + word;
    }
    if (line !== '') console.log(line);
  }
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: {
    ...process.env,
    HETZNER_API_TOKEN: 'demo-token',
    HETZNER_API_BASE_URL: 'http://localhost:8787/v1',
  },
  stderr: 'ignore',
});

const client = new Client({ name: 'demo', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(
  `${BOLD}${tools.length} tools${RESET} — one MCP session, held open:`
);
console.log(DIM + tools.map((t) => t.name).join('  ') + RESET);
await sleep(4500);

const args = {
  zone: 'example.com',
  name: 'www',
  type: 'A',
  records: [{ value: '198.51.100.9' }],
};

call('set_records', args);
const refused = await client.callTool({ name: 'set_records', arguments: args });
show(refused);
await sleep(6500);

const token = /confirmToken: "([0-9a-f]{32})"/.exec(
  refused.content.map((c) => c.text).join('')
)[1];

call('set_records', { ...args, confirmToken: `${token.slice(0, 8)}…` });
const done = await client.callTool({
  name: 'set_records',
  arguments: { ...args, confirmToken: token },
});
show(done);
await sleep(1000);

await client.close();
