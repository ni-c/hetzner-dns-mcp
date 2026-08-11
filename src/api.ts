import type { Config } from './config.js';

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

/** Query parameter values accepted by {@link HetznerApi.get}. Arrays are appended multiple times. */
export type QueryParams = Record<
  string,
  string | number | string[] | undefined
>;

/**
 * Minimal client for the DNS endpoints of the Hetzner Cloud API.
 *
 * Authentication uses a project-scoped API token as a Bearer token. Tokens
 * from the old DNS Console (dns.hetzner.com, shut down in May 2026) are not
 * compatible.
 */
export class HetznerApi {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: Config) {
    this.baseUrl = config.baseUrl;
    this.authHeader = `Bearer ${config.token}`;
  }

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
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
    const text = await response.text();

    if (!response.ok) {
      throw new HetznerApiError(response.status, text, method, path);
    }

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
