import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fingerprint } from '../src/resource-key.js';

/**
 * Properties of the payload fingerprint.
 *
 * This is the whole of what binds a confirmation to the call it was given for.
 * Its own docstring states the failure it exists to prevent: without it a token
 * issued for `set_records ["198.51.100.1"]` would also execute
 * `set_records ["198.51.100.66"]`, because the destructive part of these tools
 * is the record list and not the RRSet it points at.
 *
 * That is a claim about a hash, and a hash is exactly the kind of thing an
 * example test cannot check — it can only confirm the two values someone
 * happened to write down. What follows states it over generated payloads.
 */

const RUNS = { numRuns: 500 };

const address = fc
  .tuple(
    fc.integer({ min: 1, max: 223 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

describe('a confirmation is bound to its payload', () => {
  /** The failure the docstring names: one address changed, one token spent. */
  it('changing a single record changes the fingerprint', () => {
    fc.assert(
      fc.property(
        fc.array(address, { minLength: 1, maxLength: 6 }),
        address,
        fc.nat(),
        (records, replacement, index) => {
          const at = index % records.length;
          fc.pre(records[at] !== replacement);
          const changed = [...records];
          changed[at] = replacement;
          expect(fingerprint(records)).not.toBe(fingerprint(changed));
        }
      ),
      RUNS
    );
  });

  it('adding or removing a record changes the fingerprint', () => {
    fc.assert(
      fc.property(
        fc.array(address, { minLength: 1, maxLength: 6 }),
        address,
        (records, extra) => {
          expect(fingerprint(records)).not.toBe(
            fingerprint([...records, extra])
          );
          expect(fingerprint(records)).not.toBe(fingerprint(records.slice(1)));
        }
      ),
      RUNS
    );
  });

  /**
   * Order is part of the identity.
   *
   * A record list is presented to the operator in the order it was given, and
   * that is the order that will be written. Two orderings are two different
   * calls even where the resulting set is the same, so they must not share a
   * token.
   */
  it('reordering the records changes the fingerprint', () => {
    fc.assert(
      fc.property(address, address, (first, second) => {
        fc.pre(first !== second);
        expect(fingerprint([first, second])).not.toBe(
          fingerprint([second, first])
        );
      }),
      RUNS
    );
  });

  it('the same payload always fingerprints the same', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (payload) => {
        expect(fingerprint(payload)).toBe(fingerprint(payload));
      }),
      RUNS
    );
  });

  /**
   * An absent payload and an explicit null are the same call, and both have to
   * fingerprint rather than throw — `JSON.stringify(undefined)` is `undefined`,
   * which would otherwise reach `update` as a non-string.
   */
  it('undefined and null are the same, and neither throws', () => {
    expect(fingerprint(undefined)).toBe(fingerprint(null));
    fc.assert(
      fc.property(fc.anything(), (payload) => {
        expect(() => fingerprint(payload)).not.toThrow();
      }),
      RUNS
    );
  });

  it('is always sixteen hex characters, whatever it was given', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (payload) => {
        expect(fingerprint(payload)).toMatch(/^[0-9a-f]{16}$/);
      }),
      RUNS
    );
  });

  /**
   * A string payload cannot be confused with the one-element list holding it,
   * nor a number with its decimal spelling — the reason the value goes through
   * `JSON.stringify` rather than being concatenated.
   */
  it('distinguishes a value from the list and the string of it', () => {
    fc.assert(
      fc.property(address, (record) => {
        expect(fingerprint(record)).not.toBe(fingerprint([record]));
        expect(fingerprint([record])).not.toBe(fingerprint([[record]]));
      }),
      RUNS
    );
  });
});
