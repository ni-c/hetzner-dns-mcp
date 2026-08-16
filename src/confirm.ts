import { createHash, randomBytes } from 'node:crypto';

const TOKEN_TTL_MS = 5 * 60 * 1000;
/** Bounds the map so a loop of refused calls cannot grow it without limit. */
const MAX_PENDING = 100;

/**
 * Issues short-lived confirmation tokens for irreversible DNS operations.
 *
 * A plain boolean `confirm` parameter can be set by the model on the very first
 * call — including when it was talked into it by instructions hidden in a TXT
 * record, a record comment or a zone file. A random token only ever appears in
 * a *previous* tool result, so it cannot be guessed, and it is bound to a
 * resource key so a confirmation for one zone cannot be replayed against
 * another.
 */
export class ConfirmationStore {
  private readonly pending = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly ttlMs: number = TOKEN_TTL_MS) {}

  /** Creates (or replaces) the pending token for `resource`. */
  issue(resource: string): string {
    if (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next();
      if (!oldest.done) this.pending.delete(oldest.value);
    }
    const token = randomBytes(16).toString('hex');
    this.pending.set(resource, { token, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  /**
   * Returns true and consumes the token when it matches the pending one for
   * `resource` and has not expired. Tokens are single-use.
   */
  consume(resource: string, token: string | undefined): boolean {
    const entry = this.pending.get(resource);
    if (entry === undefined || token === undefined) return false;
    if (token !== entry.token || Date.now() >= entry.expiresAt) return false;
    this.pending.delete(resource);
    return true;
  }

  /** Minutes the issued tokens stay valid, for use in messages. */
  get ttlMinutes(): number {
    return Math.round(this.ttlMs / 60_000);
  }
}

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
