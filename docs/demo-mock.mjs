/**
 * Minimal stand-in for the Hetzner Cloud DNS API, used to record demo.gif.
 *
 * The demo must be reproducible by anyone and must not show real zones, so it
 * runs against fabricated data on loopback instead of api.hetzner.cloud —
 * HETZNER_API_BASE_URL accepts plain http for localhost exactly for this.
 *
 *   node docs/demo-mock.mjs &            # listens on 8787
 *   HETZNER_API_TOKEN=demo-token \
 *   HETZNER_API_BASE_URL=http://localhost:8787/v1 node dist/index.js
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);

const rrset = {
  id: 'www/A',
  name: 'www',
  type: 'A',
  ttl: 300,
  records: [{ value: '198.51.100.1', comment: 'old web host' }],
  protection: { change: false },
  labels: {},
};

const zones = [
  {
    id: 42,
    name: 'example.com',
    mode: 'primary',
    status: 'ok',
    ttl: 3600,
    record_count: 17,
    protection: { delete: false },
  },
];

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (path === '/v1/zones' && req.method === 'GET') {
    return send(res, 200, {
      zones,
      meta: { pagination: { total_entries: 1 } },
    });
  }
  if (path === '/v1/zones/example.com' && req.method === 'GET') {
    return send(res, 200, { zone: zones[0] });
  }
  if (path === '/v1/zones/example.com/rrsets/www/A' && req.method === 'GET') {
    return send(res, 200, { rrset });
  }
  if (
    path === '/v1/zones/example.com/rrsets/www/A/actions/set_records' &&
    req.method === 'POST'
  ) {
    return send(res, 201, {
      action: { id: 1337, command: 'set_records', status: 'success' },
    });
  }
  return send(res, 404, {
    error: { code: 'not_found', message: `no mock route for ${path}` },
  });
}).listen(PORT, '127.0.0.1', () => {
  console.error(`demo mock listening on http://localhost:${PORT}/v1`);
});
