/**
 * Everything that turns somebody else's bytes into a string this server is
 * willing to say.
 *
 * Three sources feed the model through this file, and none of them is the
 * server's own words:
 *
 * - an error body from whatever answered on `HETZNER_API_BASE_URL` — the API,
 *   a reverse proxy, a WAF, or a typo's worth of somebody else's server;
 * - the message of an exception raised by Node or by undici, which quotes the
 *   value it refused (a header, a certificate's subject alternative names);
 * - a record value, comment, label or zone file, written by whoever controls
 *   the zone.
 *
 * The rule is the same for all three: strip what can move a cursor or reverse a
 * line, cut to a stated length, and never let the text end mid-surrogate.
 */

/**
 * C0 controls, DEL, the C1 block, and the invisible and direction-changing
 * formatting characters.
 *
 * Built from code points at runtime rather than spelled as escapes in a regular
 * expression literal: the tools that write this file turn a backslash-u escape
 * into the raw byte it names, which would put an actual ESC into the source and
 * make every later edit of the line miss.
 *
 * Tab, line feed and carriage return survive — an error body is often several
 * lines, and losing the newlines makes it less readable, not safer. ESC is the
 * one that matters: `ESC[1A` moves the cursor up, which is a strictly stronger
 * newline than a newline.
 */
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const UNSAFE = new RegExp(
  `[${UNSAFE_RANGES.map(([from, to]) =>
    from === to
      ? escapeCodePoint(from)
      : `${escapeCodePoint(from)}-${escapeCodePoint(to)}`
  ).join('')}]`,
  'gu'
);

function escapeCodePoint(code: number): string {
  return `\\u{${code.toString(16)}}`;
}

/** Longest error body kept; the rest is cut and said to be cut. */
const MAX_UPSTREAM_LENGTH = 2000;

/**
 * Cleans one string that came from outside this process.
 *
 * `toWellFormed` runs last because a cut can split a surrogate pair, and a lone
 * surrogate is legal JSON that a client encoding to UTF-8 cannot represent.
 */
export function cleanText(value: string, max = MAX_UPSTREAM_LENGTH): string {
  const stripped = value.replace(UNSAFE, '').trim();
  if (stripped.length <= max) return stripped.toWellFormed();
  return `${stripped.slice(0, max).toWellFormed()}… (truncated, ${stripped.length} characters total)`;
}

/**
 * An error body, for the model.
 *
 * A markup-shaped body is dropped rather than cleaned: a reverse proxy's error
 * page or a WAF block page is neither useful nor trustworthy, and its length is
 * all that would survive anyway. The check is deliberately loose — an XML
 * declaration, a leading comment or a doctype followed by a newline are all the
 * same thing here.
 */
export function upstreamText(body: string): string {
  const trimmed = body.trim();
  if (/^(<!doctype|<html[\s>]|<\?xml|<!--)/i.test(trimmed)) {
    return '(HTML error page omitted)';
  }
  return cleanText(trimmed);
}

/**
 * The message of an exception this server did not raise itself.
 *
 * `run`'s catch used to pass `error.message` straight through as this server's
 * own words. Node and undici quote the value they refused: a header value —
 * which for this server is `Bearer <the API token>` — or the subject
 * alternative names of a certificate presented by whatever answered on the
 * port. Both reach the model that way, and both are somebody else's string.
 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return cleanText(message, 500);
}

/**
 * Whether a string is safe to put in an HTTP header value.
 *
 * undici refuses one that is not, and its refusal quotes the value in full. For
 * the `Authorization` header that value is the credential, so the check has to
 * happen here — before the runtime gets the chance to quote it.
 */
export function isHeaderValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // HTAB, then SP through the last visible ASCII character, then the obs-text
    // range RFC 9110 still tolerates. Everything else — CR, LF, NUL, anything
    // above Latin-1 — is what makes a header value invalid, and undici says so
    // by quoting the whole value back.
    const allowed =
      code === 0x09 ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff);
    if (!allowed) return false;
  }
  return true;
}
