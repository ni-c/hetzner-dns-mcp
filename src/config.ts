export interface Config {
  /** Hetzner Cloud API token of the project that holds the DNS zones */
  token: string;
  /** Base URL of the Hetzner Cloud API, e.g. `https://api.hetzner.cloud/v1` */
  baseUrl: string;
}

const DEFAULT_BASE_URL = 'https://api.hetzner.cloud/v1';

/**
 * Reads the configuration from environment variables and exits the process
 * with a helpful message if a required variable is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.HETZNER_API_TOKEN;

  if (!token) {
    console.error(
      'mcp-hetzner-dns: missing required environment variable HETZNER_API_TOKEN\n' +
        'Create an API token in the Hetzner Cloud Console (https://console.hetzner.com)\n' +
        'under your project > Security > API tokens (read & write for full functionality).\n' +
        'Note: tokens from the old DNS Console (dns.hetzner.com) do not work — that API\n' +
        'was shut down in May 2026.\n' +
        'Optional: HETZNER_API_BASE_URL (default: https://api.hetzner.cloud/v1)'
    );
    process.exit(1);
  }

  return {
    token,
    baseUrl: (env.HETZNER_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
  };
}
