import { createHash } from 'node:crypto';

/**
 * The key ingredient this server keeps for itself.
 *
 * The confirmation store comes from mcp-approval now. This does not: it binds a
 * token to the exact record list of a call, and the resource keys here are
 * built as readable strings rather than through `setResourceKey`, because a
 * zone and an RRSet path are already a stable identity.
 */

/**
 * Fingerprints the payload a confirmation was given for.
 *
 * Without this, a token issued for `set_records ["198.51.100.1"]` would also
 * execute `set_records ["198.51.100.66"]` — the destructive part of these tools
 * is the record list, not just the RRSet it points at.
 */
export function fingerprint(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(payload ?? null))
    .digest('hex')
    .slice(0, 16);
}
