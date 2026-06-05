import { secret as defaultSecret } from '../secret.mjs';
import { loadConfig } from '../paths.mjs';

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';
const FIRECRAWL_SECRET_KEY = 'secrets.firecrawl_api_key';
const BLOCKED_HOSTS = Object.freeze(['linkedin.com', 'threads.com']);

export class UnsupportedFirecrawlTargetError extends Error {
  constructor(hostname) {
    super(`firecrawl target is unsupported: ${hostname}`);
    this.name = 'UnsupportedFirecrawlTargetError';
  }
}

function assertAllowedTarget(targetUrl) {
  const hostname = new URL(targetUrl).hostname.replace(/^www\./u, '');
  if (BLOCKED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new UnsupportedFirecrawlTargetError(hostname);
  }
}

function firecrawlRefFromConfig(configPath) {
  const config = loadConfig(configPath);
  const ref = config.secrets?.firecrawl_api_key;
  if (!ref) throw new Error(`missing ${FIRECRAWL_SECRET_KEY} in config`);
  return ref;
}

export async function scrapeWithFirecrawl(targetUrl, { fetch = globalThis.fetch, secret = defaultSecret, configPath } = {}) {
  assertAllowedTarget(targetUrl);
  const token = secret(firecrawlRefFromConfig(configPath));
  const response = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: targetUrl, formats: ['markdown'] }),
  });
  if (!response?.ok) throw new Error(`firecrawl scrape failed: ${response?.status ?? 'unknown'}`);
  const payload = await response.json();
  return String(payload?.data?.markdown ?? payload?.data?.content ?? payload?.markdown ?? '');
}
