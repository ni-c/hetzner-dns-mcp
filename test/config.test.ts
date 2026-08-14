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
});
