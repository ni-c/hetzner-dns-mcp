import { internalHostKind } from 'mcp-internal-hosts';
export interface Config {
  /**
   * Hetzner Cloud API token of the project that holds the DNS zones.
   * May be undefined: the server still starts and lists its tools, every
   * API call then fails with {@link MISSING_TOKEN_MESSAGE}.
   */
  token: string | undefined;
  /** Base URL of the Hetzner Cloud API, e.g. `https://api.hetzner.cloud/v1` */
  baseUrl: string;
  /** When true, only the read-only tools are registered at all. */
  readOnly: boolean;
  /**
   * Raw value of `HETZNER_ALLOW_TOOLS` — comma-separated tool names, `list_*`
   * prefixes, or `essential`. Kept unparsed on purpose: this file is a mirror
   * of the environment, and the names can only be checked against the tool
   * catalogue, which `buildToolFilter` does.
   */
  allowTools: string | undefined;
  /** Raw value of `HETZNER_DENY_TOOLS`, same shape, subtracted from the above. */
  denyTools: string | undefined;
}

/** Shown when HETZNER_API_TOKEN is missing — on startup and on every API call. */
export const MISSING_TOKEN_MESSAGE =
  'missing required environment variable HETZNER_API_TOKEN\n' +
  'Create an API token in the Hetzner Cloud Console (https://console.hetzner.com)\n' +
  'under your project > Security > API tokens (read & write for full functionality).\n' +
  'Note: tokens from the old DNS Console (dns.hetzner.com) do not work — that API\n' +
  'was shut down in May 2026.\n' +
  'Optional: HETZNER_API_BASE_URL (default: https://api.hetzner.cloud/v1)\n' +
  'Optional: HETZNER_READ_ONLY=true to expose only the read-only tools\n' +
  'Optional: HETZNER_ALLOW_TOOLS / HETZNER_DENY_TOOLS to narrow the tool list\n' +
  '          (comma-separated names, "list_*" prefixes, or "essential")';

const DEFAULT_BASE_URL = 'https://api.hetzner.cloud/v1';
const DEFAULT_HOST = 'api.hetzner.cloud';

/**
 * Validates HETZNER_API_BASE_URL. The API token is sent to this URL as a
 * Bearer header, so anything other than https (or http to localhost, for
 * testing) would expose the token; userinfo in the URL is rejected outright.
 */
function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // The value itself is never echoed: an unparseable URL can still contain a
    // "user:token@" part, and this message goes to stderr, which clients log.
    console.error(
      `hetzner-dns-mcp: HETZNER_API_BASE_URL is not a valid URL (${raw.length} characters)`
    );
    process.exit(1);
  }
  // The shared classifier rather than a list of three spellings: 127.0.0.2,
  // sub.localhost and http://[::ffff:127.0.0.1] are just as local, and the
  // token stays on the machine in every one of those cases.
  const isLocal = internalHostKind(url.hostname) === 'loopback';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    console.error(
      'hetzner-dns-mcp: HETZNER_API_BASE_URL must use https ' +
        '(http is only allowed for localhost). The API token is sent to this URL.'
    );
    process.exit(1);
  }
  if (url.username !== '' || url.password !== '') {
    console.error(
      'hetzner-dns-mcp: HETZNER_API_BASE_URL must not contain credentials'
    );
    process.exit(1);
  }
  if (url.host !== DEFAULT_HOST && !isLocal) {
    console.error(
      `hetzner-dns-mcp: warning: non-default API host "${url.host}" — ` +
        'the HETZNER_API_TOKEN will be sent to this host'
    );
  }
  return url.toString().replace(/\/+$/, '');
}

/**
 * Reads the configuration from environment variables.
 *
 * A missing token is only a warning, not a fatal error: the server must be
 * able to complete the MCP handshake and answer `tools/list` without
 * credentials so registries and inspectors can introspect it. A malformed
 * base URL still exits, because that one can leak the token.
 *
 * The variables are removed from `env` once they have been read. Anything that
 * dumps the environment afterwards — a dependency's crash reporter, a Node
 * diagnostic report, a future tool — then finds no token to leak.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.HETZNER_API_TOKEN;
  const rawBaseUrl = env.HETZNER_API_BASE_URL;
  const readOnly = /^(1|true|yes)$/i.test(env.HETZNER_READ_ONLY ?? '');

  delete env.HETZNER_API_TOKEN;
  delete env.HETZNER_API_BASE_URL;

  if (!token) {
    console.error(`hetzner-dns-mcp: ${MISSING_TOKEN_MESSAGE}`);
  }
  if (readOnly) {
    console.error(
      'hetzner-dns-mcp: HETZNER_READ_ONLY is set — only read-only tools are registered'
    );
  }

  return {
    token,
    baseUrl:
      rawBaseUrl !== undefined
        ? normalizeBaseUrl(rawBaseUrl)
        : DEFAULT_BASE_URL,
    readOnly,
    allowTools: env.HETZNER_ALLOW_TOOLS,
    denyTools: env.HETZNER_DENY_TOOLS,
  };
}
