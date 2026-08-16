import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';

/** Makes process.exit throw so the exit path is observable in tests. */
function stubExit(): void {
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit');
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadConfig', () => {
  it('warns but does not exit when HETZNER_API_TOKEN is missing', () => {
    // Registries and inspectors start the server without credentials and
    // expect the MCP handshake to succeed.
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const config = loadConfig({});

    expect(config.token).toBeUndefined();
    expect(config.baseUrl).toBe('https://api.hetzner.cloud/v1');
    expect(exit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('HETZNER_API_TOKEN')
    );
  });

  it('uses the default base URL when none is configured', () => {
    const config = loadConfig({ HETZNER_API_TOKEN: 'test-token' });
    expect(config.baseUrl).toBe('https://api.hetzner.cloud/v1');
  });

  it('strips trailing slashes from the base URL', () => {
    const config = loadConfig({
      HETZNER_API_TOKEN: 'test-token',
      HETZNER_API_BASE_URL: 'https://api.hetzner.cloud/v1///',
    });
    expect(config.baseUrl).toBe('https://api.hetzner.cloud/v1');
  });

  it('exits on a base URL that is not a valid URL', () => {
    stubExit();
    expect(() =>
      loadConfig({
        HETZNER_API_TOKEN: 'test-token',
        HETZNER_API_BASE_URL: 'not a url',
      })
    ).toThrow('process.exit');
  });

  it('exits on an http base URL for a non-localhost host', () => {
    stubExit();
    expect(() =>
      loadConfig({
        HETZNER_API_TOKEN: 'test-token',
        HETZNER_API_BASE_URL: 'http://api.hetzner.cloud/v1',
      })
    ).toThrow('process.exit');
  });

  it('accepts an http base URL for localhost', () => {
    const config = loadConfig({
      HETZNER_API_TOKEN: 'test-token',
      HETZNER_API_BASE_URL: 'http://localhost:8080/v1',
    });
    expect(config.baseUrl).toBe('http://localhost:8080/v1');
  });

  it('exits on a base URL containing credentials', () => {
    stubExit();
    expect(() =>
      loadConfig({
        HETZNER_API_TOKEN: 'test-token',
        HETZNER_API_BASE_URL: 'https://user:pass@api.hetzner.cloud/v1',
      })
    ).toThrow('process.exit');
  });

  it('warns on a non-default https host but accepts it', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const config = loadConfig({
      HETZNER_API_TOKEN: 'test-token',
      HETZNER_API_BASE_URL: 'https://proxy.example.com/v1',
    });
    expect(config.baseUrl).toBe('https://proxy.example.com/v1');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('proxy.example.com')
    );
  });

  it('removes the credentials from the environment after reading them', () => {
    // Anything that dumps the environment later — a crash reporter, a Node
    // diagnostic report — must not find the token there.
    const env = {
      HETZNER_API_TOKEN: 'test-token',
      HETZNER_API_BASE_URL: 'https://api.hetzner.cloud/v1',
      UNRELATED: 'kept',
    };

    const config = loadConfig(env);

    expect(config.token).toBe('test-token');
    expect(env.HETZNER_API_TOKEN).toBeUndefined();
    expect(env.HETZNER_API_BASE_URL).toBeUndefined();
    expect(env.UNRELATED).toBe('kept');
  });

  it('does not echo an unparseable base URL, which may carry credentials', () => {
    stubExit();
    const error = vi.mocked(console.error);

    expect(() =>
      loadConfig({
        HETZNER_API_TOKEN: 'test-token',
        HETZNER_API_BASE_URL: 'ht tp://user:s3cret@api.hetzner.cloud',
      })
    ).toThrow('process.exit');

    expect(error).toHaveBeenCalledWith(expect.not.stringContaining('s3cret'));
  });

  it('reads HETZNER_READ_ONLY', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(loadConfig({ HETZNER_API_TOKEN: 't' }).readOnly).toBe(false);
    expect(
      loadConfig({ HETZNER_API_TOKEN: 't', HETZNER_READ_ONLY: 'true' }).readOnly
    ).toBe(true);
    expect(
      loadConfig({ HETZNER_API_TOKEN: 't', HETZNER_READ_ONLY: '1' }).readOnly
    ).toBe(true);
    expect(
      loadConfig({ HETZNER_API_TOKEN: 't', HETZNER_READ_ONLY: 'no' }).readOnly
    ).toBe(false);
  });
});
