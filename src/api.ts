import { MISSING_TOKEN_MESSAGE, type Config } from './config.js';
import { isHeaderValue, upstreamText } from './text.js';

export class HetznerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string
  ) {
    super(`Hetzner Cloud API ${method} ${path} failed with HTTP ${status}`);
    this.name = 'HetznerApiError';
  }
}

/**
 * Ceiling on a success body.
 *
 * `per_page` caps a listing at 100 entries, and the largest thing this API
 * answers with is a zone file — Hetzner allows a zone to hold thousands of
 * records. 16 MiB is far above any honest answer and far below what an endpoint
 * that never stops sending would cost: `await response.text()` with no ceiling
 * holds whatever arrives, and what answers on `HETZNER_API_BASE_URL` is not
 * always the API.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * Ceiling on an error body, which is a different question.
 *
 * It has to *cut* rather than refuse: a reverse proxy answering 401 with a
 * two-megabyte login page must still surface as a 401, or the hint about the
 * credential never runs and a model retries the call that failed for a reason
 * it was never told.
 */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/** Query parameter values accepted by {@link HetznerApi.get}. Arrays are appended multiple times. */
export type QueryParams = Record<
  string,
  string | number | string[] | undefined
>;

/** What `readBounded` needs of a `Response`; the global and undici's differ. */
interface BodyLike {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

/**
 * Reads a response body under a ceiling.
 *
 * A declared `content-length` above the cap is refused before a byte is read;
 * without one, the stream is read in chunks and cancelled the moment the cap is
 * passed, so an endpoint that never stops sending costs the cap and not the
 * process.
 *
 * `cut: true` shortens instead of refusing — see {@link MAX_ERROR_BODY_BYTES}.
 */
async function readBounded(
  response: BodyLike,
  max: number,
  cut: boolean
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    if (!cut) {
      throw new Error(
        `The API announced ${declared} bytes, which is more than this server reads (${max}).`
      );
    }
  }
  const stream = response.body;
  // A response with no body at all — a 204, or a proxy that answered a request
  // it decided to satisfy itself. There is nothing to read and nothing to cap.
  if (stream === null) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        if (!cut) {
          throw new Error(
            `The API answered with more than this server reads (${max} bytes).`
          );
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const joined = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return joined.subarray(0, max).toString('utf8');
}

/**
 * Minimal client for the DNS endpoints of the Hetzner Cloud API.
 *
 * Authentication uses a project-scoped API token as a Bearer token. Tokens
 * from the old DNS Console (dns.hetzner.com, shut down in May 2026) are not
 * compatible.
 */
export class HetznerApi {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(config: Config) {
    this.baseUrl = config.baseUrl;
    this.token = config.token;
  }

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    // The token is only required here, not at startup, so that the server can
    // still be started and introspected without credentials.
    if (!this.token) {
      throw new Error(MISSING_TOKEN_MESSAGE);
    }
    const authorization = `Bearer ${this.token}`;
    // Before undici gets the chance to refuse it. Its refusal is
    // `Headers.append: "<value>" is an invalid header value.` — the whole
    // value, which here is the credential, and `run`'s catch would put it in
    // the model's context. `loadConfig` checks the shape at startup; a `Config`
    // can be built without it (the tests do), so the check lives here too.
    if (!isHeaderValue(authorization)) {
      throw new Error(
        'HETZNER_API_TOKEN contains a character that cannot go in an HTTP header ' +
          '(a line break from a wrapped paste is the usual cause). ' +
          'The value is not shown here on purpose.'
      );
    }
    const headers: Record<string, string> = {
      Authorization: authorization,
      Accept: 'application/json',
    };
    const init: RequestInit = {
      method,
      headers,
      // The API never redirects; refusing keeps the Bearer header from
      // being replayed to unexpected targets.
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, init);

    // The status is decided before the body is read, and the two bodies have
    // different ceilings. Reading first made a 401 behind a proxy with a large
    // login page surface as a size complaint: no status, so no credential hint,
    // and a model retries what it was never told had failed on the credential.
    if (!response.ok) {
      const text = await readBounded(response, MAX_ERROR_BODY_BYTES, true);
      throw new HetznerApiError(
        response.status,
        upstreamText(text),
        method,
        path
      );
    }

    const text = await readBounded(response, MAX_BODY_BYTES, false);
    if (text === '') return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  get(path: string, query?: QueryParams): Promise<unknown> {
    return this.request('GET', `${path}${buildQuery(query)}`);
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  put(path: string, body?: unknown): Promise<unknown> {
    return this.request('PUT', path, body);
  }

  delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }
}

function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else {
      query.set(key, String(value));
    }
  }
  return query.size > 0 ? `?${query.toString()}` : '';
}
