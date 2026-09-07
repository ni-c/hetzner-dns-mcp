import fc from 'fast-check';
import { orderedResourceKey } from 'mcp-approval';
import { describe, expect, it } from 'vitest';

/**
 * Properties of the resource key a confirmation is bound to.
 *
 * This is the whole of what binds a confirmation to the call it was given for.
 * The failure it exists to prevent: without it a token issued for
 * `set_records ["198.51.100.1"]` would also execute
 * `set_records ["198.51.100.66"]`, because the destructive part of these tools
 * is the record list and not the RRSet it points at.
 *
 * That is a claim about a hash, and a hash is exactly the kind of thing an
 * example test cannot check — it can only confirm the two values someone
 * happened to write down. What follows states it over generated payloads.
 *
 * The key builder is `orderedResourceKey` from mcp-approval, not a local hash
 * any more. Two things follow, and both are tested here rather than assumed:
 * the fleet's library has to keep the payload property this server relied on,
 * *and* it has to keep position meaningful — `setResourceKey` sorts its parts,
 * which is right for a set and wrong for the tuples every tool here builds
 * (a zone, a path, a record list, a TTL).
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

/** Exactly the shape `set_records` builds. */
function recordsKey(records: readonly string[], zone = 'example.com'): string {
  return orderedResourceKey('set_records', [
    zone,
    '/www/A',
    JSON.stringify(records.map((value) => ({ value }))),
  ]);
}

describe('a confirmation is bound to its payload', () => {
  /** The failure the docstring names: one address changed, one token spent. */
  it('changing a single record changes the key', () => {
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
          expect(recordsKey(records)).not.toBe(recordsKey(changed));
        }
      ),
      RUNS
    );
  });

  it('adding or removing a record changes the key', () => {
    fc.assert(
      fc.property(
        fc.array(address, { minLength: 1, maxLength: 6 }),
        address,
        (records, extra) => {
          expect(recordsKey(records)).not.toBe(recordsKey([...records, extra]));
          expect(recordsKey(records)).not.toBe(recordsKey(records.slice(1)));
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
  it('reordering the records changes the key', () => {
    fc.assert(
      fc.property(address, address, (first, second) => {
        fc.pre(first !== second);
        expect(recordsKey([first, second])).not.toBe(
          recordsKey([second, first])
        );
      }),
      RUNS
    );
  });

  /** A different zone is a different call, with the same records. */
  it('changing the zone changes the key', () => {
    fc.assert(
      fc.property(
        fc.array(address, { minLength: 1, maxLength: 4 }),
        (records) => {
          expect(recordsKey(records, 'example.com')).not.toBe(
            recordsKey(records, 'example.net')
          );
        }
      ),
      RUNS
    );
  });

  it('the same payload always keys the same', () => {
    fc.assert(
      fc.property(
        fc.array(address, { minLength: 1, maxLength: 6 }),
        (records) => {
          expect(recordsKey(records)).toBe(recordsKey(records));
        }
      ),
      RUNS
    );
  });

  it('is an operation and sixteen hex characters, whatever it was given', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 6 }), (parts) => {
        expect(orderedResourceKey('op', parts)).toMatch(/^op:[0-9a-f]{16}$/);
      }),
      RUNS
    );
  });
});

describe('position is part of the key', () => {
  /**
   * The property `setResourceKey` does not have, and the reason every tool here
   * moved to `orderedResourceKey`.
   *
   * Every key this server builds is a tuple — `[zone, path, records]`,
   * `[zone, path, records, ttl]`, `[name, mode, primaries, zonefile, …]` — and
   * in a tuple `["a", "b"]` and `["b", "a"]` are two different calls. A sorted
   * key makes them one, and one confirmation then executes the other.
   */
  it('swapping two parts changes the key', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (first, second) => {
        fc.pre(first !== second);
        expect(orderedResourceKey('op', [first, second])).not.toBe(
          orderedResourceKey('op', [second, first])
        );
      }),
      RUNS
    );
  });

  /**
   * A part cannot be smuggled across the boundary between two parts: the parts
   * are separated by a character none of them can contain, so `["ab", "c"]` and
   * `["a", "bc"]` are different keys. Without that, a zone name ending in what
   * the next part begins with would share a token with a different call.
   */
  it('moving characters between parts changes the key', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (first, second) => {
        fc.pre(first !== '' && second !== '');
        expect(orderedResourceKey('op', [first, second])).not.toBe(
          orderedResourceKey('op', [first + second[0], second.slice(1)])
        );
      }),
      RUNS
    );
  });

  /** The operation is part of the key: two tools never share a confirmation. */
  it('the same parts under two operations are two keys', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 4 }), (parts) => {
        expect(orderedResourceKey('set_records', parts)).not.toBe(
          orderedResourceKey('remove_records', parts)
        );
      }),
      RUNS
    );
  });
});
