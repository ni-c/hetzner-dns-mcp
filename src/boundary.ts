/**
 * What the API actually sent, as opposed to what it promised.
 *
 * Every tool here passes a Hetzner Cloud API document through, and until this
 * file existed every one of them did it with a TypeScript cast —
 * `(await api.get(…)) as { zone?: … }` — which is a claim, not a check. The
 * output schemas then made that claim load-bearing: `listOf('zones')` requires
 * a `zones` array and `objectOf('zone')` requires a `zone` object, and on SDK
 * 2.0 a result that breaks its own output schema is answered with
 * `isError: true` and the text `Output validation error for tool …`. No cause,
 * no partial answer — the whole call, for the model to make sense of.
 *
 * The spec does promise those keys, and Hetzner keeps its promise. The trouble
 * is everything that is not Hetzner: a reverse proxy or WAF in front of the
 * API, a 204 with an empty body (which the client maps to `null`), a
 * `HETZNER_API_BASE_URL` pointing one character off at somebody else's server,
 * or a body that is not JSON at all — for which `HetznerApi.request` falls back
 * to returning the raw text. Each of those turned a read tool into an error
 * with nothing in it.
 *
 * So: shape it here, decide per field what an unusable value means, and say so
 * in the answer. Never leave the decision to the schema.
 */

/** A JSON object, as opposed to `null`, an array, or a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Names what arrived, for the sentence that explains why an answer is thin.
 *
 * The value itself is never quoted: it is the backend's, and a tool result is
 * read by a model. The *kind* is enough to tell a proxy's HTML page from a 204
 * from a JSON document with the wrong keys.
 */
export function describeShape(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'string')
    return `a string of ${value.length} characters`;
  if (isRecord(value)) {
    const count = Object.keys(value).length;
    return count === 0 ? 'an empty object' : `an object of ${count} keys`;
  }
  return `a ${typeof value}`;
}

/** The key a thin answer explains itself under. Not a field Hetzner has. */
const NOTE_KEY = 'unexpected_response';

/** A record, or an empty one — an answer with nothing in it is still an answer. */
export function recordOr(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * A string field the schema promises, when the backend really sent one.
 *
 * Anything else is *absent*, which is what the optional field in the schema
 * already means. A number where a zone file belongs is not a short zone file.
 */
export function stringOf(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max
    ? `${value.slice(0, max).toWellFormed()}… (truncated, ${value.length} characters total)`
    : value.toWellFormed();
}

/** A count or a TTL the backend sent, when it is one a schema can carry. */
export function safeIntegerOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value + 0
    : undefined;
}

/**
 * The envelope of a list endpoint: the named array, `meta`, and whatever else
 * came with it.
 *
 * Entries that are not objects are dropped rather than passed on, because
 * `document` in the output schema is an object and one bad entry would
 * otherwise cost the whole listing — the failure mode this file exists for.
 * How many were dropped is counted and reported; a listing that quietly
 * shortens itself is worse than one that says it did.
 */
export function listEnvelope(
  body: unknown,
  key: string
): Record<string, unknown> {
  const record = recordOr(body);
  const { [key]: raw, meta, ...rest } = record;
  const out: Record<string, unknown> = { ...rest };

  if (!Array.isArray(raw)) {
    out[key] = [];
    out[NOTE_KEY] =
      `The API did not answer with a "${key}" array — it sent ${describeShape(isRecord(body) ? raw : body)}. ` +
      'The list below is empty because there was nothing to list, not because the account is.';
    if (isRecord(meta)) out.meta = meta;
    return out;
  }

  const entries = raw.filter(isRecord);
  out[key] = entries;
  if (entries.length !== raw.length) {
    out[NOTE_KEY] =
      `${raw.length - entries.length} of ${raw.length} entries were not objects and were dropped.`;
  }
  if (isRecord(meta)) out.meta = meta;
  return out;
}

/**
 * The envelope of a single-object endpoint.
 *
 * The named key is omitted when the backend did not send an object under it,
 * and the omission is explained. That is why the key is optional in the output
 * schema: absent-and-explained is an answer a model can act on, and
 * `Output validation error` is not.
 */
export function objectEnvelope(
  body: unknown,
  key: string
): Record<string, unknown> {
  const record = recordOr(body);
  const { [key]: raw, ...rest } = record;
  const out: Record<string, unknown> = { ...rest };

  if (isRecord(raw)) {
    out[key] = raw;
    return out;
  }
  out[NOTE_KEY] =
    `The API did not answer with a "${key}" object — it sent ${describeShape(isRecord(body) ? raw : body)}.`;
  return out;
}

/**
 * The `/actions/…` envelope: Hetzner replies with the queued action, and some
 * releases echo the changed resource beside it.
 *
 * Every field is optional here by design, so this only has to make sure that
 * what is present is object-shaped.
 */
export function actionEnvelope(body: unknown): Record<string, unknown> {
  const record = recordOr(body);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(record)) {
    if (name === 'action' || name === 'rrset' || name === 'zone') {
      if (isRecord(value)) out[name] = value;
      continue;
    }
    out[name] = value;
  }
  if (!isRecord(body)) {
    out[NOTE_KEY] =
      `The API did not answer with an object — it sent ${describeShape(body)}.`;
  }
  return out;
}
