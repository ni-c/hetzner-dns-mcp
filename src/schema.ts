import { z } from 'zod';

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
  .regex(
    /^(?!\.\.?$)[A-Za-z0-9._-]+$/,
    'must be a zone ID or domain name (letters, digits, ".", "-", "_")'
  )
  .describe('ID or name of the zone, e.g. "example.com"');

export const rrsetName = z
  .string()
  .min(1)
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

export const records = z
  .array(
    z.object({
      value: z
        .string()
        .min(1)
        .describe(
          'Value of the record in zone file syntax, e.g. "198.51.100.1" for A or "\\"v=spf1 -all\\"" for TXT'
        ),
      comment: z.string().optional().describe('Optional comment'),
    })
  )
  .min(1);

export const ttl = z
  .number()
  .int()
  .min(60)
  .max(2147483647)
  .describe('Time To Live in seconds (60 to 2147483647)');

export const labels = z
  .record(z.string(), z.string())
  .describe('User-defined labels (key/value pairs)');

export const page = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe('Page number to return (pagination)');

export const perPage = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Entries per page (1-100, default 25)');

export const confirmToken = z
  .string()
  .optional()
  .describe(
    'Confirmation token from the previous call of this same tool with identical arguments. Omit on the first call — the server then returns a token that is valid for a few minutes.'
  );

/** Builds the URL path segment for an RRSet, e.g. `/www/A`. */
export function rrsetPath(name: string, type: string): string {
  return `/${encodeURIComponent(name)}/${encodeURIComponent(type)}`;
}
