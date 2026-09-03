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

const complete = { HETZNER_API_TOKEN: 'test-token' };

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { ...values } as NodeJS.ProcessEnv;
}

describe('ELICITATION', () => {
  it('defaults to on, and to on for an empty value', () => {
    // The only variable of this family that defaults to *on*. An unset switch
    // has to mean "ask", or a deployment that never heard of it would quietly
    // stop asking.
    expect(loadConfig(env({ ...complete })).elicitation).toBe(true);
    expect(loadConfig(env({ ...complete, ELICITATION: '' })).elicitation).toBe(
      true
    );
  });

  it('is switched off by "false", in any casing or padding', () => {
    for (const raw of ['false', 'FALSE', ' False ']) {
      expect(
        loadConfig(env({ ...complete, ELICITATION: raw })).elicitation,
        raw
      ).toBe(false);
    }
  });

  it('refuses to start on anything else, naming both valid values', () => {
    // Deliberately fatal rather than falling back to the default: a typo would
    // leave the dialog running while the operator believes it is off, and
    // nothing else would ever tell them.
    for (const raw of ['1', 'off', 'no']) {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      expect(() => loadConfig(env({ ...complete, ELICITATION: raw }))).toThrow(
        'exit'
      );
      expect(exit).toHaveBeenCalledWith(1);
      const message = String(error.mock.calls[0]?.[0] ?? '');
      expect(message, raw).toContain('ELICITATION');
      expect(message, raw).toContain('"true"');
      expect(message, raw).toContain('"false"');
      vi.restoreAllMocks();
    }
  });

  it('has already wiped the credential by the time it can exit', () => {
    // parseElicitation sits *after* the delete on purpose. An exit above it
    // would leave the credential in the environment for whatever a crash
    // reporter or an inspector does next — which is exactly what that delete
    // exists to prevent, and its comment says so.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const e = env({ ...complete, ELICITATION: 'nonsense' });
    expect(() => loadConfig(e)).toThrow('exit');
    expect(e.HETZNER_API_TOKEN).toBeUndefined();
    vi.restoreAllMocks();
  });
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
