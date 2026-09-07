import { isIP } from 'node:net';
import { z } from 'zod';

/**
 * The bounds in this file come from the API's own specification
 * (https://docs.hetzner.cloud/cloud.spec.json) wherever it states one, and from
 * the DNS protocol where it does not. They are written down as constants with
 * their source, because a ceiling nobody can trace is a ceiling the next change
 * removes.
 *
 * Why bound at all, for values the caller chooses: every one of them is
 * serialised into a request body or spliced into a URL, several are hashed into
 * a confirmation key, and one — the zone file — is split into lines and shown
 * in a dialog. None of that is dangerous at a sensible size and all of it is
 * work an unbounded input can buy on the thread that serves every other call.
 */

/** `maxLength` of a zone name in the spec. Also the longest an id can be. */
const MAX_ZONE_LENGTH = 255;
/** The longest a domain name can be on the wire (RFC 1035); the spec is silent. */
const MAX_RRSET_NAME_LENGTH = 253;
/** The longest RDATA a DNS message can carry; the spec is silent. */
const MAX_RECORD_VALUE_LENGTH = 65_535;
/** A comment is a note, not a payload. */
const MAX_COMMENT_LENGTH = 512;
/** `maxItems` on set_records / add_records / remove_records in the spec. */
const MAX_RECORDS_PER_ACTION = 50;
/** No spec maximum for create; a structural ceiling so one call stays one call. */
const MAX_RECORDS_PER_RRSET = 1000;
/** Label key: an optional DNS-subdomain prefix (253) plus `/` plus a name (63). */
const MAX_LABEL_KEY_LENGTH = 317;
/** Label value, per the "Labels" section of the spec. */
const MAX_LABEL_VALUE_LENGTH = 63;
/** Structural: labels are metadata, not storage. */
const MAX_LABELS = 64;
/** A selector is an expression over the two above. */
const MAX_LABEL_SELECTOR_LENGTH = 1024;
/** With per_page capped at 100, anything past this is not a page. */
const MAX_PAGE = 1_000_000;
/** A zone file for a zone this API will hold. */
const MAX_ZONEFILE_LENGTH = 1_000_000;

/** RRSet types supported by the Hetzner Cloud DNS API. */
export const RRSET_TYPES = [
  'A',
  'AAAA',
  'CAA',
  'CNAME',
  'DS',
  'HINFO',
  'HTTPS',
  'MX',
  'NS',
  'PTR',
  'RP',
  'SOA',
  'SRV',
  'SVCB',
  'TLSA',
  'TXT',
] as const;

// The negative lookahead rejects "." and ".." — encodeURIComponent leaves dots
// untouched, so a bare dot segment would be normalized away by the URL parser
// and escape the intended API path.
export const zone = z
  .string()
  .min(1)
  .max(MAX_ZONE_LENGTH)
  .regex(
    /^(?!\.\.?$)[A-Za-z0-9._-]+$/,
    'must be a zone ID or domain name (letters, digits, ".", "-", "_")'
  )
  .describe('ID or name of the zone, e.g. "example.com"');

export const rrsetName = z
  .string()
  .min(1)
  .max(MAX_RRSET_NAME_LENGTH)
  .regex(
    /^(?!\.\.?$)[A-Za-z0-9@*._-]+$/,
    'must be an RRSet name (letters, digits, ".", "-", "_", "*", or "@")'
  )
  .describe(
    'Name of the RRSet, relative to the zone and in lower case, e.g. "www" or "@" for the zone apex'
  );

export const rrsetType = z
  .enum(RRSET_TYPES)
  .describe('Type of the RRSet, e.g. "A" or "TXT"');

/** A name used only to filter a listing — never spliced into a path. */
export const nameFilter = z.string().min(1).max(MAX_ZONE_LENGTH);

export const labelSelector = z
  .string()
  .max(MAX_LABEL_SELECTOR_LENGTH)
  .describe('Filter by label selector, e.g. "env=prod"');

const record = z.object({
  value: z
    .string()
    .min(1)
    .max(MAX_RECORD_VALUE_LENGTH)
    .describe(
      'Value of the record in zone file syntax, e.g. "198.51.100.1" for A or "\\"v=spf1 -all\\"" for TXT'
    ),
  comment: z
    .string()
    .max(MAX_COMMENT_LENGTH)
    .optional()
    .describe('Optional comment'),
});

/** The record list a new RRSet is created with. */
export const records = z.array(record).min(1).max(MAX_RECORDS_PER_RRSET);

/**
 * The record list the three record actions accept.
 *
 * Fifty is the API's own `maxItems` for `set_records`, `add_records` and
 * `remove_records`. Refusing here rather than at Hetzner means the caller is
 * told the number, and — for the guarded ones — that no confirmation is spent
 * on a call that cannot run.
 */
export const actionRecords = z
  .array(record)
  .min(1)
  .max(
    MAX_RECORDS_PER_ACTION,
    `the Hetzner Cloud API accepts at most ${MAX_RECORDS_PER_ACTION} records per call`
  );

/**
 * One week, which is BIND's `max-cache-ttl` and the longest any resolver will
 * actually hold an answer — Unbound caps at a day.
 *
 * The protocol maximum of 2147483647 is 68 years and buys nothing: no resolver
 * honours it. What it does buy an attacker is recovery time. A record added
 * with a TTL of years is served from caches long after it has been removed at
 * the authority, so the operator's fix does not take effect on the schedule the
 * operator chose. Capping here costs nothing real and takes that away.
 */
const MAX_TTL_SECONDS = 604800;

export const ttl = z
  .number()
  .int()
  .min(60)
  .max(MAX_TTL_SECONDS)
  .describe(
    `Time To Live in seconds (60 to ${MAX_TTL_SECONDS}, one week — longer values are not honoured by resolvers)`
  );

export const labels = z
  .record(
    z.string().min(1).max(MAX_LABEL_KEY_LENGTH),
    z.string().max(MAX_LABEL_VALUE_LENGTH)
  )
  .refine((value) => Object.keys(value).length <= MAX_LABELS, {
    message: `at most ${MAX_LABELS} labels`,
  })
  .describe('User-defined labels (key/value pairs)');

export const zonefile = z
  .string()
  .min(1)
  .max(MAX_ZONEFILE_LENGTH)
  .describe('Zone file content (BIND format)');

/**
 * A primary nameserver of a secondary zone.
 *
 * `address` is checked against `net.isIP` rather than left as free text. The
 * schema always said "Public IPv4 or IPv6 address" and nothing held it to that,
 * and this value does two things that make it worth holding: it goes to the API
 * as the host an entire zone is transferred from, and it goes into the
 * confirmation dialog as the thing a person is asked to agree to. The dialog is
 * where it matters — `renderDetails` flattens and caps it, so a line break
 * cannot forge a sentence, but "1.2.3.4 (actually a hostname)" answered as an
 * address is a question nobody can answer correctly.
 */
export const primaryNameservers = z
  .array(
    z.object({
      address: z
        .string()
        .min(1)
        .max(45)
        .refine((value) => isIP(value) !== 0, {
          message: 'must be an IPv4 or IPv6 address',
        })
        .describe('Public IPv4 or IPv6 address of the primary nameserver'),
      port: z.number().int().min(1).max(65535).optional().describe('Port'),
      tsig_key: z
        .string()
        .max(512)
        .optional()
        .describe(
          'TSIG key to use for the zone transfer. Treat as a secret — it becomes part of the conversation context.'
        ),
      tsig_algorithm: z
        .enum(['hmac-md5', 'hmac-sha1', 'hmac-sha256'])
        .optional()
        .describe('TSIG algorithm'),
    })
  )
  .min(1)
  .max(10)
  .describe('Primary nameservers to transfer the zone from (secondary zones)');

export const page = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE)
  .optional()
  .describe('Page number to return (pagination)');

export const perPage = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Entries per page (1-100, default 25)');

export const confirmTokenParam = z
  .string()
  .max(128)
  .optional()
  .describe(
    'Confirmation token from the previous call of this same tool with identical arguments. Omit on the first call — the server then returns a token that is valid for a few minutes.'
  );

/**
 * Builds the URL path segment for an RRSet, e.g. `/www/A`.
 *
 * The segments are not escaped. RFC 3986 lets a path segment contain `@`, and
 * the Hetzner Cloud API does not decode a percent-escaped one: with the apex
 * RRSet present, `GET /zones/example.com/rrsets/%40/A` answers 404 while
 * `/@/A` answers 200 — so escaping the apex name made it unreachable. Every
 * other character `rrsetName` permits (letters, digits, `*`, `.`, `-`, `_`) is
 * already safe in a path segment, which makes `encodeURIComponent` a no-op
 * here in every case except the one it broke.
 *
 * That puts the whole weight on the character set, so it is re-checked here
 * rather than trusted from the call site: a `/` or `%` reaching the path would
 * let the caller do the decoding (`%2e%2e` → `..`).
 */
export function rrsetPath(name: string, type: string): string {
  if (
    !rrsetName.safeParse(name).success ||
    !rrsetType.safeParse(type).success
  ) {
    // The offending value is not quoted. This runs on input that just failed
    // its own character-set check, which is the one case where it can hold
    // anything at all, and the message goes into a tool result.
    throw new Error(
      'Refusing to build a request path from an RRSet name and type that do ' +
        'not pass their own validation.'
    );
  }
  return `/${name}/${type}`;
}
