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
   * Whether a client that *can* show a dialog is asked before a guarded tool
   * acts. `ELICITATION=false` turns the dialog off — the guard stays and falls
   * back to the two-call token, so there is no setting in which a guarded call
   * goes unannounced.
   */
  elicitation: boolean;

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
  // `origin + pathname`, not the string that was typed. A query or a fragment
  // in the variable used to be kept and glued in front of every path, so
  // `…/v1?debug=1` produced `…/v1?debug=1/zones`. What was dropped is named
  // rather than dropped in silence.
  const dropped = [
    url.search === '' ? '' : 'a query string',
    url.hash === '' ? '' : 'a fragment',
  ].filter((part) => part !== '');
  if (dropped.length > 0) {
    console.error(
      `hetzner-dns-mcp: HETZNER_API_BASE_URL carried ${dropped.join(' and ')}; ` +
        'only the origin and path are used.'
    );
  }
  return `${url.origin}${trimTrailingSlashes(url.pathname)}`;
}

/**
 * Removes trailing slashes without a regular expression.
 *
 * `/\/+$/` is tried from every position of a run of slashes and consumes the
 * run each time, which is quadratic whenever the run is *not* at the end:
 * measured here at 36 / 122 / 419 / 1626 ms for 10 000 / 20 000 / 40 000 /
 * 80 000 slashes followed by one more character. It runs once, on the
 * operator's own value, so this was never an attack — it is the one construct
 * this family has now found in five servers, and an index walk costs nothing.
 *
 * The walk slices once at the end rather than per slash: `while (s.endsWith('/'))
 * s = s.slice(0, -1)` copies the whole string per iteration and is the same
 * quadratic in bytes.
 */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 0x2f) end -= 1;
  return path.slice(0, end);
}

/**
 * The shape a Hetzner Cloud API token has, checked before it is ever used.
 *
 * Hetzner issues 64 visible-ASCII characters; the band is wider so a future
 * format still starts. What it is really for is the character set: a token with
 * a line break in it — a paste wrapped by a terminal, or `$(cat token)` with
 * something in the middle — reaches undici, whose refusal is
 * `Headers.append: "Bearer <the whole token>" is an invalid header value.`,
 * and `run`'s catch would answer the tool call with it. Verified on Node
 * 24.5.0: the trailing newline of a shell substitution is trimmed by the
 * Headers constructor, an inner one is not.
 */
const TOKEN_PATTERN = /^[!-~]{8,512}$/;

/**
 * Checks the token's shape and says nothing about its content.
 *
 * The message names the variable, the length and — when there is one — the
 * *position* of the offending character, which is what an operator needs to
 * find a wrapped paste. It never quotes the value: this is a credential, and
 * stderr is the MCP client's log.
 */
function checkTokenShape(token: string): void {
  if (TOKEN_PATTERN.test(token)) return;
  let position = -1;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) {
      position = index;
      break;
    }
  }
  const where =
    position === -1
      ? ''
      : ` The first character that cannot be in a token is at position ${position + 1}.`;
  console.error(
    `hetzner-dns-mcp: HETZNER_API_TOKEN is ${token.length} characters and does not look ` +
      `like a Hetzner Cloud API token (visible ASCII, 8 to 512 characters).${where} ` +
      'The value is not shown here on purpose. API calls will fail until it is fixed.'
  );
}

/**
 * Reads `ELICITATION` — deliberately unprefixed, and deliberately fatal on
 * anything it does not recognise.
 *
 * Unprefixed: environment variables are process-wide, so this is one switch for
 * every server in the same environment. That is also its risk, which is why a
 * server started with it off says so on its startup line.
 *
 * Fatal: this is the first variable of the family that defaults to *on*. The
 * others fail open on a typo, which is the safe direction for them — including
 * `HETZNER_READ_ONLY` right above, which is deliberately generous about what it
 * accepts. Here a typo would leave the dialog running while the operator
 * believes it is off, and an operator who believes that has no way to find out.
 */
export function parseElicitation(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'true') return true;
  if (value === 'false') return false;
  console.error(
    `hetzner-dns-mcp: ELICITATION must be "true" or "false" — got ${describeValue(raw)}. ` +
      'Refusing to start rather than guess.'
  );
  process.exit(1);
}

/**
 * A configuration value, for a message whose purpose is to show the operator
 * their typo.
 *
 * The purpose is real — "got x" is how somebody finds a stray quote — and so is
 * the risk: `ELICITATION` is unprefixed and sits in the same env block as
 * `HETZNER_API_TOKEN`, one line away in every compose file, and a value pasted
 * into the wrong line is exactly what fails this parse. So a *short word* is
 * quoted, and everything else is described by its length. A token is never a
 * short word.
 */
function describeValue(raw: string | undefined): string {
  if (raw === undefined) return 'nothing';
  return /^[A-Za-z0-9_-]{1,12}$/.test(raw)
    ? `"${raw}"`
    : `a ${raw.length}-character value that is neither`;
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
  // Trimmed: `HETZNER_API_TOKEN=$(cat token)` leaves the file's trailing
  // newline on the value, which is a shape check failure for a token that is
  // otherwise perfectly good.
  const token = env.HETZNER_API_TOKEN?.trim() || undefined;
  const rawBaseUrl = env.HETZNER_API_BASE_URL;
  const readOnly = /^(1|true|yes)$/i.test(env.HETZNER_READ_ONLY?.trim() ?? '');

  delete env.HETZNER_API_TOKEN;
  delete env.HETZNER_API_BASE_URL;

  // After the deletes, deliberately: this one can exit the process, and an exit
  // above would leave the token in the environment for whatever runs next.
  const elicitation = parseElicitation(env.ELICITATION);

  if (!token) {
    console.error(`hetzner-dns-mcp: ${MISSING_TOKEN_MESSAGE}`);
  } else {
    checkTokenShape(token);
  }
  if (readOnly) {
    console.error(
      'hetzner-dns-mcp: HETZNER_READ_ONLY is set — only read-only tools are registered'
    );
  }
  // Printed only when it is off, like the line above. ELICITATION is
  // unprefixed, so one `export ELICITATION=false` reaches every MCP server in
  // the environment — this line is what makes that visible in the log of each
  // one it actually reached.
  if (!elicitation) {
    console.error(
      'hetzner-dns-mcp: ELICITATION=false — guarded tools fall back to the two-call token'
    );
  }

  return {
    token,
    baseUrl:
      rawBaseUrl !== undefined
        ? normalizeBaseUrl(rawBaseUrl)
        : DEFAULT_BASE_URL,
    readOnly,
    elicitation,
    allowTools: env.HETZNER_ALLOW_TOOLS,
    denyTools: env.HETZNER_DENY_TOOLS,
  };
}
