import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { jsonResult } from '../src/result.js';
import { cleanText, upstreamText } from '../src/text.js';
import { rrsetName, zone } from '../src/schema.js';

/**
 * Every function here runs on text somebody else chose, at the largest size the
 * code accepts, and each one is timed against its own worst input rather than
 * against a round number.
 *
 * The rule this suite holds: a pattern that ends in `$` and starts with a
 * repetition is tried from every position of a run and consumes the run each
 * time. `/\/+$/` on the base URL was the instance here — 36 / 122 / 419 /
 * 1626 ms at 10 000 / 20 000 / 40 000 / 80 000 slashes with one character
 * behind the run — and the trigger has to be `run + a character the pattern
 * rejects`, or the run matches at position 0 in no time and the probe reads as
 * "held".
 *
 * The budget is generous on purpose. These assertions exist to catch a
 * quadratic, which is two to three orders of magnitude away, not to measure a
 * workstation.
 */

const BUDGET_MS = 250;

function timed(label: string, run: () => void): number {
  const started = process.hrtime.bigint();
  run();
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  if (elapsed > BUDGET_MS) {
    throw new Error(`${label} took ${elapsed.toFixed(0)} ms`);
  }
  return elapsed;
}

describe('the base URL walk', () => {
  /**
   * The run is followed by a character the pattern rejects, so every start
   * position is tried and fails. `'/'.repeat(n)` on its own matches at
   * position 0 and says nothing.
   */
  it('trims 80 000 slashes with a character behind them', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = `https://api.hetzner.cloud/${'/'.repeat(80_000)}v1`;

    timed('base URL normalisation', () => {
      loadConfig({
        HETZNER_API_TOKEN: 'k'.repeat(64),
        HETZNER_API_BASE_URL: raw,
      } as NodeJS.ProcessEnv);
    });

    vi.restoreAllMocks();
  });

  it('trims 80 000 trailing slashes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    timed('trailing slash walk', () => {
      loadConfig({
        HETZNER_API_TOKEN: 'k'.repeat(64),
        HETZNER_API_BASE_URL: `https://api.hetzner.cloud/v1${'/'.repeat(80_000)}`,
      } as NodeJS.ProcessEnv);
    });

    vi.restoreAllMocks();
  });
});

describe('the text cleaner', () => {
  const esc = String.fromCharCode(27);

  it.each([
    ['a run of ESC', esc.repeat(200_000)],
    ['a run of NUL', String.fromCharCode(0).repeat(200_000)],
    ['nothing to remove', 'a'.repeat(200_000)],
    ['a bidi run', String.fromCodePoint(0x202e).repeat(200_000)],
    ['alternating', (esc + 'a').repeat(100_000)],
  ])('is linear on %s', (label, input) => {
    timed(`cleanText on ${label}`, () => cleanText(input, 2000));
  });

  it('is linear on a markup-shaped body with no closing bracket', () => {
    timed('upstreamText on an open run', () =>
      upstreamText('<'.repeat(200_000))
    );
  });

  it('is linear on a doctype followed by a long run', () => {
    timed('upstreamText behind a doctype', () =>
      upstreamText(`<!doctype html>${'<'.repeat(200_000)}`)
    );
  });
});

describe('the input patterns', () => {
  /**
   * Both name patterns are anchored at both ends with a single character
   * class, so they are linear by construction — this is the test that says so
   * when somebody makes one of them cleverer.
   */
  it.each([
    ['zone on a run of dots', () => zone.safeParse('.'.repeat(80_000))],
    ['zone on a rejected tail', () => zone.safeParse(`${'a'.repeat(80_000)}!`)],
    [
      'rrsetName on a run of stars',
      () => rrsetName.safeParse('*'.repeat(80_000)),
    ],
    [
      'rrsetName on a rejected tail',
      () => rrsetName.safeParse(`${'*'.repeat(80_000)}!`),
    ],
  ])('is linear: %s', (label, run) => {
    timed(label, run);
  });
});

describe('the result walk', () => {
  /**
   * The redaction now normalises every key before matching a suffix, which is
   * one pass per key rather than one regular expression over the document.
   * A document of many small entries under one object is the shape both halves
   * of a budget usually miss, so it is the one timed here.
   */
  it('cleans a document of 20 000 keys', () => {
    const zonePayload: Record<string, unknown> = {};
    for (let index = 0; index < 20_000; index += 1) {
      zonePayload[`label_${index}`] = 'v';
    }

    timed('clean over 20 000 keys', () => {
      expect(() => jsonResult({ zone: zonePayload })).toThrow();
    });
  });

  it('cleans a deeply repeated array', () => {
    const rrsets = Array.from({ length: 20_000 }, (_, index) => ({
      name: `n${index}`,
      records: [{ value: '198.51.100.1' }],
    }));

    timed('clean over 20 000 entries', () => {
      expect(() => jsonResult({ rrsets })).toThrow();
    });
  });
});
