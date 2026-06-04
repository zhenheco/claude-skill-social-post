import { secret } from '../secret.mjs';

export const PUBLISH_PLATFORMS = Object.freeze(['facebook', 'instagram', 'threads']);

const PUBLISH_PLATFORM_SET = new Set(PUBLISH_PLATFORMS);

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) throw new Error('baseUrl required');
  return String(baseUrl).replace(/\/+$/u, '');
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

function queryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function parseJson(response) {
  return response.json();
}

export function createClient({ baseUrl, apiKeyRef, fetchImpl = globalThis.fetch, secretImpl = secret } = {}) {
  const root = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl required');

  function bearerHeaders(extra = {}) {
    return {
      ...extra,
      Authorization: ['Bearer', secretImpl(apiKeyRef)].join(' '),
    };
  }

  async function requestJson(path, init) {
    const response = await fetchImpl(`${root}${path}`, init);
    return parseJson(response);
  }

  return Object.freeze({
    async publish({ platform, content, mediaUrls = [] } = {}, { confirm } = {}) {
      if (confirm !== 'human_confirm') throw new Error('human_confirm required');
      if (!PUBLISH_PLATFORM_SET.has(platform)) throw new Error(`unsupported platform: ${platform}`);

      const response = await fetchImpl(`${root}/api/posts`, {
        method: 'POST',
        headers: bearerHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ platform, content, mediaUrls }),
      });

      if (!response.ok) throw new Error(`autopost publish failed: ${response.status}`);
      return parseJson(response);
    },

    listAccounts() {
      return requestJson('/api/social-accounts', {
        method: 'GET',
        headers: bearerHeaders(),
      });
    },

    analytics(query = {}) {
      return requestJson(`/api/analytics${queryString(query)}`, {
        method: 'GET',
        headers: bearerHeaders(),
      });
    },

    insights(postId) {
      return requestJson(`/api/posts/${encodePathSegment(postId)}/insights`, {
        method: 'GET',
        headers: bearerHeaders(),
      });
    },
  });
}

